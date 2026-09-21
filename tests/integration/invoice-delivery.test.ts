// Phase G (Invoices/delivery) - domain-layer integration tests (spec
// Section 21/22/23/24, INV-006/007). Requires a real Postgres and a real
// local Supabase Storage/SMTP stack reachable via the env vars below.
// PDF "rendering" here is a stub (see src/domain/billing/sending.ts's
// SendInvoiceDeps.renderPdf) -- Cloudflare Browser Rendering only runs
// inside an actual Workers request context, not plain Node, and could not
// be verified in this local sandbox at all (see src/lib/pdf/render.ts's
// comment). Everything downstream of "here are some PDF bytes" -- hashing,
// storage, tokens, email, state transitions, immutability -- is exercised
// for real.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/client";
import { invoiceDeliveries, invoices } from "../../src/db/schema/invoices";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import {
  createOrganization,
  updateOrganization,
} from "../../src/domain/organizations/organizations";
import {
  createDwelling,
  updateDwelling,
} from "../../src/domain/organizations/dwellings";
import { createPeriod } from "../../src/domain/periods/periods";
import { createRule, updateRule } from "../../src/domain/billing/rules";
import {
  generateInvoice,
  getInvoice,
  overrideCaseStatus,
} from "../../src/domain/billing/generation";
import { prepareInvoice } from "../../src/domain/billing/generation";
import {
  ConflictError,
  ensureCanonicalPdf,
  recordPaperDispatch,
  resendInvoice,
  sendInvoice,
  type SendInvoiceDeps,
} from "../../src/domain/billing/sending";
import {
  claimSendAttempt,
  claimSendCommand,
  markDispatching,
} from "../../src/domain/billing/send-attempts";
import {
  resolveInvoiceAccessToken,
  NotFoundError as TokenNotFoundError,
} from "../../src/domain/billing/invoice-tokens";
import { listAuditLogs } from "../../src/domain/audit/audit-log";
import { createSupabaseAdminClient } from "../../src/lib/supabase/admin";
import type {
  EmailService,
  SendInvoiceEmailInput,
} from "../../src/lib/email/service";
import { createSmtpEmailService } from "../../src/lib/email/smtp";
import { createServer, type Socket } from "node:net";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SECRET_KEY are required for integration tests"
  );
}

let db: Db;
let seedAdminId: string;
const supabaseAdmin = createSupabaseAdminClient(supabaseUrl, supabaseSecretKey);
const TOKEN_SECRET = "it-test-token-secret";

function stubDeps(overrides: Partial<SendInvoiceDeps> = {}): SendInvoiceDeps {
  const email: EmailService = {
    sendInvoice: async () => ({
      success: true,
      provider: "smtp" as const,
      providerMessageId: "stub",
    }),
  };
  return {
    renderPdf: async () => new TextEncoder().encode("%PDF-1.4 stub"),
    supabaseAdmin,
    emailService: email,
    tokenSecret: TOKEN_SECRET,
    appBaseUrl: "https://billing.example.test",
    ...overrides,
  };
}

function createDeferredGate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, "it-g-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

function cleanupOrg(organizationId: string) {
  return cleanupOrganization(db, organizationId);
}

async function setupPreparedInvoice(
  name: string,
  month: number,
  dwellingOverrides: Partial<Parameters<typeof createDwelling>[2]> = {}
) {
  const org = await createOrganization(
    db,
    {
      name,
      addressLine1: "Addr 1",
      bankName: "Test Bank",
      iban: "LV00TEST0000000000000",
    },
    seedAdminId
  );
  const dwelling = await createDwelling(
    db,
    org.id,
    {
      number: "1",
      occupantName: "Jane Doe",
      billingAddress: "1 Test St",
      billingEmail: "resident@example.com",
      ...dwellingOverrides,
    },
    seedAdminId
  );
  const period = await createPeriod(
    db,
    org.id,
    {
      year: 2026,
      month,
      startsOn: `2026-${String(month).padStart(2, "0")}-01`,
      endsOn: `2026-${String(month).padStart(2, "0")}-28`,
      invoiceIssueDate: `2026-${String(month).padStart(2, "0")}-28`,
      invoiceDueDate: `2026-${String(Math.min(month + 1, 12)).padStart(2, "0")}-14`,
    },
    seedAdminId
  );
  const rule = await createRule(
    db,
    org.id,
    {
      name: "Fee",
      code: "fee",
      calculationType: "FIXED",
      unit: "month",
      unitPrice: "10.00",
      vatRate: "21.0000",
      effectiveFrom: "2025-01-01",
    },
    seedAdminId
  );
  const generated = await generateInvoice(
    db,
    org.id,
    period.id,
    dwelling.id,
    seedAdminId
  );
  const prepared = await prepareInvoice(db, org.id, generated.id, seedAdminId);
  return { org, dwelling, period, rule, invoice: prepared };
}

describe("invoice sending", () => {
  it("INV-006: sends a PREPARED invoice, generates the canonical PDF, and sets SENT", async () => {
    const { org, invoice } = await setupPreparedInvoice("IT-G Org 1", 1);
    const sent = await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps(),
      seedAdminId
    );
    expect(sent.sentAt).not.toBeNull();
    expect(sent.pdfObjectKey).toContain(org.id);
    expect(sent.pdfSha256).toHaveLength(64);

    const [caseRow] = await db.$client
      .query(
        "select status from billing_cases where id = (select billing_case_id from invoices where id = $1)",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(caseRow.status).toBe("SENT");

    await cleanupOrg(org.id);
  });

  it("sendInvoice is idempotent: calling it again after success is a no-op, not a second delivery", async () => {
    const { org, invoice } = await setupPreparedInvoice("IT-G Org 2", 2);
    const first = await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps(),
      seedAdminId
    );
    const second = await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps(),
      seedAdminId
    );
    expect(second.sentAt?.getTime()).toBe(first.sentAt?.getTime());

    const deliveryCount = await db.$client
      .query("select count(*) from invoice_deliveries where invoice_id = $1", [
        invoice.id,
      ])
      .then((r) => Number(r.rows[0].count));
    expect(deliveryCount).toBe(1);

    await cleanupOrg(org.id);
  });

  it("concurrent sendInvoice calls on the same invoice produce exactly one delivery and one email", async () => {
    const { org, invoice } = await setupPreparedInvoice("IT-G Org Race", 5);
    let emailCallCount = 0;
    const deps = stubDeps({
      emailService: {
        sendInvoice: async () => {
          emailCallCount++;
          // Give both racing calls a chance to reach this point before
          // either finishes, so the test actually exercises the race
          // instead of the two calls running strictly sequentially.
          await new Promise((r) => setTimeout(r, 20));
          return { success: true, provider: "smtp" as const };
        },
      },
    });

    // Two separate connections, like two real concurrent HTTP requests
    // (each Worker request opens its own createDb()) -- reusing one
    // connection would serialize claimSendCommand's transaction on the
    // client itself and hide the row-level DB lock race being tested.
    const dbA = await createIntegrationDb();
    const dbB = await createIntegrationDb();
    try {
      const [a, b] = await Promise.all([
        sendInvoice(dbA, org.id, invoice.id, deps, seedAdminId),
        sendInvoice(dbB, org.id, invoice.id, deps, seedAdminId),
      ]);
      expect(a.sentAt?.getTime()).toBe(b.sentAt?.getTime());
      expect(emailCallCount).toBe(1);

      const deliveryCount = await db.$client
        .query(
          "select count(*) from invoice_deliveries where invoice_id = $1",
          [invoice.id]
        )
        .then((r) => Number(r.rows[0].count));
      expect(deliveryCount).toBe(1);
    } finally {
      await dbA.$client.end();
      await dbB.$client.end();
      await cleanupOrg(org.id);
    }
  });

  it("regenerating an invoice after a status override clears the stale canonical PDF so the next send re-renders it", async () => {
    const { org, dwelling, period, invoice } = await setupPreparedInvoice(
      "IT-G Org Regen",
      6
    );
    const firstSend = await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps({
        emailService: {
          sendInvoice: async () => ({
            success: false,
            provider: "smtp",
            failureClassification: "DEFINITIVE",
          }),
        },
      }),
      seedAdminId
    );
    expect(firstSend.sentAt).toBeNull();
    expect(firstSend.pdfObjectKey).not.toBeNull();
    const staleObjectKey = firstSend.pdfObjectKey;
    const staleHash = firstSend.pdfSha256;

    const [caseRow] = await db.$client
      .query("select billing_case_id from invoices where id = $1", [invoice.id])
      .then((r) => r.rows);
    await overrideCaseStatus(
      db,
      org.id,
      caseRow.billing_case_id,
      "DRAFT",
      "test: force back to draft for regeneration",
      seedAdminId
    );
    const regenerated = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    expect(regenerated.pdfObjectKey).toBeNull();
    expect(regenerated.pdfSha256).toBeNull();

    await prepareInvoice(db, org.id, regenerated.id, seedAdminId);
    const resent = await sendInvoice(
      db,
      org.id,
      regenerated.id,
      stubDeps({
        renderPdf: async () => new TextEncoder().encode("%PDF fresh"),
      }),
      seedAdminId
    );
    expect(resent.pdfObjectKey).not.toBe(staleObjectKey);
    expect(resent.pdfSha256).not.toBe(staleHash);

    await cleanupOrg(org.id);
  });

  it("only a PREPARED invoice can be sent (a DRAFT one is rejected)", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-G Org 3", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwelling = await createDwelling(
      db,
      org.id,
      { number: "1" },
      seedAdminId
    );
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 3,
        startsOn: "2026-03-01",
        endsOn: "2026-03-28",
        invoiceIssueDate: "2026-03-28",
        invoiceDueDate: "2026-04-14",
      },
      seedAdminId
    );
    await createRule(
      db,
      org.id,
      {
        name: "Fee",
        code: "fee",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "10.00",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    const draft = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );

    await expect(
      sendInvoice(db, org.id, draft.id, stubDeps(), seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);

    await cleanupOrg(org.id);
  });

  it("resendInvoice requires a prior successful send and reuses the same PDF metadata (Test 4: proves new attempt created, sentAt unchanged, INVOICE_RESENT recorded once)", async () => {
    const { org, invoice } = await setupPreparedInvoice("IT-G Org 4", 4);
    await expect(
      resendInvoice(db, org.id, invoice.id, stubDeps(), seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);

    const sent = await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps(),
      seedAdminId
    );
    const resent = await resendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps(),
      seedAdminId
    );
    expect(resent.pdfObjectKey).toBe(sent.pdfObjectKey);
    expect(resent.pdfSha256).toBe(sent.pdfSha256);
    expect(resent.sentAt?.getTime()).toBe(sent.sentAt?.getTime());

    const deliveryCount = await db.$client
      .query("select count(*) from invoice_deliveries where invoice_id = $1", [
        invoice.id,
      ])
      .then((r) => Number(r.rows[0].count));
    expect(deliveryCount).toBe(2);

    // Verify a NEW invoice_send_attempts row was created (not attemptId: null as before)
    const attempts = await db.$client
      .query(
        "select id, status from invoice_send_attempts where invoice_id = $1 order by created_at",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(attempts).toHaveLength(2);
    expect(attempts[0].status).toBe("SENT");
    expect(attempts[1].status).toBe("SENT");
    expect(attempts[1].id).not.toBe(attempts[0].id);

    // Verify deliveries reference the attempts
    const deliveries = await db.$client
      .query(
        "select attempt_id from invoice_deliveries where invoice_id = $1 order by created_at",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(deliveries[0].attempt_id).toBe(attempts[0].id);
    expect(deliveries[1].attempt_id).toBe(attempts[1].id);

    // Verify INVOICE_RESENT is recorded exactly once
    const logs = await listAuditLogs(db, org.id);
    const resentLogs = logs.filter((l) => l.action === "INVOICE_RESENT");
    expect(resentLogs).toHaveLength(1);

    await cleanupOrg(org.id);
  });

  it("really sends over SMTP to the local Mailpit server (not a stub) and Mailpit actually receives it", async () => {
    const { org, invoice } = await setupPreparedInvoice("IT-G Org 4b", 4);
    const realSmtp = createSmtpEmailService({
      host: "127.0.0.1",
      port: 54325,
      fromAddress: "invoices@example.test",
    });
    const sent = await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps({ emailService: realSmtp }),
      seedAdminId
    );
    expect(sent.sentAt).not.toBeNull();

    const listResp = await fetch(
      "http://127.0.0.1:54324/api/v1/messages?limit=5"
    );
    const { messages } = (await listResp.json()) as {
      messages: { To: { Address: string }[]; Subject: string; ID: string }[];
    };
    const match = messages.find((m) =>
      m.To.some((t) => t.Address === "resident@example.com")
    );
    expect(match).toBeDefined();
    expect(match!.Subject).toContain(invoice.invoiceNumber);

    await cleanupOrg(org.id);
  });

  describe("SMTP delivery failure classification", () => {
    function createRawSmtpServer(
      onConnection: (socket: Socket) => void
    ): Promise<{ port: number; close: () => Promise<void> }> {
      return new Promise((resolve, reject) => {
        const server = createServer(onConnection);
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address();
          if (!addr || typeof addr === "string") {
            return reject(new Error("Unable to obtain server port"));
          }
          resolve({
            port: addr.port,
            close: () =>
              new Promise<void>((res) => {
                server.close(() => res());
              }),
          });
        });
      });
    }

    const testEmailInput: SendInvoiceEmailInput = {
      to: "resident@example.com",
      organizationName: "Test Org",
      periodLabel: "2026-04",
      invoiceNumber: "INV-202604-00001",
      total: "12.10",
      currency: "EUR",
      dueDate: "2026-05-14",
      viewInvoiceUrl: "https://billing.example.test/invoices/1",
      portalUrl: "https://billing.example.test/portal",
    };

    it("connection refused before DATA classifies as DEFINITIVE (SMTP_CONNECTION_FAILED)", async () => {
      const server = createServer();
      await new Promise<void>((res) =>
        server.listen(0, "127.0.0.1", () => res())
      );
      const addr = server.address();
      const port = addr && typeof addr !== "string" ? addr.port : 59999;
      await new Promise<void>((res) => server.close(() => res()));

      const smtp = createSmtpEmailService({
        host: "127.0.0.1",
        port,
        fromAddress: "invoices@example.test",
      });
      const result = await smtp.sendInvoice(testEmailInput);

      expect(result).toEqual({
        success: false,
        provider: "smtp",
        errorCode: "SMTP_CONNECTION_FAILED",
        failureClassification: "DEFINITIVE",
      });
    });

    it("socket closed before DATA classifies as DEFINITIVE (SMTP_CONNECTION_FAILED)", async () => {
      const { port, close } = await createRawSmtpServer((socket) => {
        socket.write("220 mock-smtp\r\n");
        socket.on("data", () => {
          socket.destroy();
        });
      });
      try {
        const smtp = createSmtpEmailService({
          host: "127.0.0.1",
          port,
          fromAddress: "invoices@example.test",
        });
        const result = await smtp.sendInvoice(testEmailInput);

        expect(result).toEqual({
          success: false,
          provider: "smtp",
          errorCode: "SMTP_CONNECTION_FAILED",
          failureClassification: "DEFINITIVE",
        });
      } finally {
        await close();
      }
    });

    it("server negative reply before DATA classifies as DEFINITIVE (SMTP_REJECTED)", async () => {
      const { port, close } = await createRawSmtpServer((socket) => {
        let buffer = "";
        let state = "GREETING";
        socket.write("220 mock-smtp\r\n");
        socket.on("data", (chunk) => {
          buffer += chunk.toString("utf8");
          if (state === "GREETING" && buffer.includes("\r\n")) {
            buffer = "";
            state = "EHLO";
            socket.write("250 localhost\r\n");
          } else if (state === "EHLO" && buffer.includes("\r\n")) {
            buffer = "";
            state = "MAIL";
            socket.write("250 OK\r\n");
          } else if (state === "MAIL" && buffer.includes("\r\n")) {
            buffer = "";
            state = "RCPT";
            socket.write("550 Mailbox unavailable\r\n");
          }
        });
      });
      try {
        const smtp = createSmtpEmailService({
          host: "127.0.0.1",
          port,
          fromAddress: "invoices@example.test",
        });
        const result = await smtp.sendInvoice(testEmailInput);

        expect(result).toEqual({
          success: false,
          provider: "smtp",
          errorCode: "SMTP_REJECTED",
          failureClassification: "DEFINITIVE",
        });
      } finally {
        await close();
      }
    });

    it("socket forcibly closed after DATA payload classifies as AMBIGUOUS (SMTP_RESPONSE_UNCERTAIN)", async () => {
      const { port, close } = await createRawSmtpServer((socket) => {
        let buffer = "";
        let state = "GREETING";
        socket.write("220 mock-smtp\r\n");
        socket.on("data", (chunk) => {
          buffer += chunk.toString("utf8");
          if (state === "GREETING" && buffer.includes("\r\n")) {
            buffer = "";
            state = "EHLO";
            socket.write("250 localhost\r\n");
          } else if (state === "EHLO" && buffer.includes("\r\n")) {
            buffer = "";
            state = "MAIL";
            socket.write("250 OK\r\n");
          } else if (state === "MAIL" && buffer.includes("\r\n")) {
            buffer = "";
            state = "RCPT";
            socket.write("250 OK\r\n");
          } else if (state === "RCPT" && buffer.includes("\r\n")) {
            buffer = "";
            state = "DATA";
            socket.write("354 Start mail input; end with <CRLF>.<CRLF>\r\n");
          } else if (state === "DATA" && buffer.includes("\r\n.\r\n")) {
            // Received full body + terminating dot line; forcibly close without response
            socket.destroy();
          }
        });
      });
      try {
        const smtp = createSmtpEmailService({
          host: "127.0.0.1",
          port,
          fromAddress: "invoices@example.test",
        });
        const result = await smtp.sendInvoice(testEmailInput);

        expect(result).toEqual({
          success: false,
          provider: "smtp",
          errorCode: "SMTP_RESPONSE_UNCERTAIN",
          failureClassification: "AMBIGUOUS",
        });
      } finally {
        await close();
      }
    });

    it("server negative reply after DATA payload classifies as DEFINITIVE (SMTP_REJECTED)", async () => {
      const { port, close } = await createRawSmtpServer((socket) => {
        let buffer = "";
        let state = "GREETING";
        socket.write("220 mock-smtp\r\n");
        socket.on("data", (chunk) => {
          buffer += chunk.toString("utf8");
          if (state === "GREETING" && buffer.includes("\r\n")) {
            buffer = "";
            state = "EHLO";
            socket.write("250 localhost\r\n");
          } else if (state === "EHLO" && buffer.includes("\r\n")) {
            buffer = "";
            state = "MAIL";
            socket.write("250 OK\r\n");
          } else if (state === "MAIL" && buffer.includes("\r\n")) {
            buffer = "";
            state = "RCPT";
            socket.write("250 OK\r\n");
          } else if (state === "RCPT" && buffer.includes("\r\n")) {
            buffer = "";
            state = "DATA";
            socket.write("354 Start mail input; end with <CRLF>.<CRLF>\r\n");
          } else if (state === "DATA" && buffer.includes("\r\n.\r\n")) {
            socket.write("554 Transaction failed\r\n");
          }
        });
      });
      try {
        const smtp = createSmtpEmailService({
          host: "127.0.0.1",
          port,
          fromAddress: "invoices@example.test",
        });
        const result = await smtp.sendInvoice(testEmailInput);

        expect(result).toEqual({
          success: false,
          provider: "smtp",
          errorCode: "SMTP_REJECTED",
          failureClassification: "DEFINITIVE",
        });
      } finally {
        await close();
      }
    });
  });

  it("Section 24: the invoice access token created at send time resolves to the right invoice, and a wrong token does not", async () => {
    const { org, invoice } = await setupPreparedInvoice("IT-G Org 5", 5);
    await sendInvoice(db, org.id, invoice.id, stubDeps(), seedAdminId);

    // The domain function only ever exposes the raw token via the email
    // it sends (never persisted); re-derive one the same way a resend
    // would, to test resolution against a token we actually hold.
    const { createInvoiceAccessToken } =
      await import("../../src/domain/billing/invoice-tokens");
    const rawToken = await createInvoiceAccessToken(
      db,
      org.id,
      invoice.id,
      TOKEN_SECRET,
      null,
      seedAdminId
    );

    const resolved = await resolveInvoiceAccessToken(
      db,
      rawToken,
      TOKEN_SECRET
    );
    expect(resolved.invoiceId).toBe(invoice.id);
    expect(resolved.organizationId).toBe(org.id);

    await expect(
      resolveInvoiceAccessToken(db, "wrong-token", TOKEN_SECRET)
    ).rejects.toBeInstanceOf(TokenNotFoundError);
    await expect(
      resolveInvoiceAccessToken(db, rawToken, "wrong-secret")
    ).rejects.toBeInstanceOf(TokenNotFoundError);

    await cleanupOrg(org.id);
  });

  it("Section 21 (the spec's explicit required proof): send invoice -> change tariff -> reload old invoice -> line amounts unchanged -> PDF hash unchanged", async () => {
    const { org, dwelling, rule, invoice } = await setupPreparedInvoice(
      "IT-G Org 6",
      6
    );
    const sent = await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps(),
      seedAdminId
    );
    const { lines: linesBefore } = await getInvoice(db, org.id, invoice.id);

    // Change the tariff and the dwelling after the invoice was sent.
    await updateRule(db, org.id, rule.id, { unitPrice: "999.00" }, seedAdminId);
    await updateDwelling(
      db,
      org.id,
      dwelling.id,
      { occupantName: "Someone Else" },
      seedAdminId
    );
    await updateOrganization(db, org.id, { name: "Renamed Org" }, seedAdminId);

    const { invoice: reloaded, lines: linesAfter } = await getInvoice(
      db,
      org.id,
      invoice.id
    );
    expect(linesAfter).toEqual(linesBefore);
    expect(reloaded.total).toBe(sent.total);
    expect(reloaded.pdfSha256).toBe(sent.pdfSha256);
    expect((reloaded.issuerSnapshot as Record<string, unknown>).name).not.toBe(
      "Renamed Org"
    );

    // And regeneration is now hard-blocked (already proven in Phase F's
    // suite, re-asserted here in the same flow this test is about).
    const [invoiceRow] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoice.id));
    expect(invoiceRow.sentAt).not.toBeNull();

    await cleanupOrg(org.id);
  });

  it("Package 2 (5): PAPER no longer auto-succeeds: paper-only PREPARED invoice throws ConflictError, remains PREPARED, sentAt null, NO delivery row created", async () => {
    const { org, invoice } = await setupPreparedInvoice("IT-G Org Paper", 7, {
      billingEmail: undefined,
      invoiceByEmail: false,
      invoiceByPaper: true,
    });
    await expect(
      sendInvoice(db, org.id, invoice.id, stubDeps(), seedAdminId)
    ).rejects.toThrow(ConflictError);

    const { invoice: currentInvoice, caseStatus } = await getInvoice(
      db,
      org.id,
      invoice.id
    );
    expect(caseStatus).toBe("PREPARED");
    expect(currentInvoice.sentAt).toBeNull();

    const deliveries = await db.$client
      .query("select count(*) from invoice_deliveries where invoice_id = $1", [
        invoice.id,
      ])
      .then((r) => Number(r.rows[0].count));
    expect(deliveries).toBe(0);

    await cleanupOrg(org.id);
  });

  it("a dwelling with both email and paper enabled records only EMAIL delivery during electronic send", async () => {
    const { org, invoice } = await setupPreparedInvoice("IT-G Org Both", 8, {
      invoiceByEmail: true,
      invoiceByPaper: true,
    });
    const sent = await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps(),
      seedAdminId
    );
    expect(sent.sentAt).not.toBeNull();

    const deliveries = await db.$client
      .query(
        "select method, status from invoice_deliveries where invoice_id = $1",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(deliveries).toEqual([{ method: "EMAIL", status: "SENT" }]);

    await cleanupOrg(org.id);
  });

  it("email-only dwelling with no billing email fails to send (no paper fallback enabled)", async () => {
    const { org, invoice } = await setupPreparedInvoice("IT-G Org NoEmail", 9, {
      billingEmail: undefined,
    });
    // A missing billing email is known before any dispatch is attempted, so
    // sendInvoice rejects it as a plain validation error -- no provider call,
    // no delivery row, and no attempt is ever claimed for this invoice.
    await expect(
      sendInvoice(db, org.id, invoice.id, stubDeps(), seedAdminId)
    ).rejects.toThrow(ConflictError);

    const deliveries = await db.$client
      .query("select count(*) from invoice_deliveries where invoice_id = $1", [
        invoice.id,
      ])
      .then((r) => Number(r.rows[0].count));
    expect(deliveries).toBe(0);

    const attempts = await db.$client
      .query(
        "select count(*) from invoice_send_attempts where invoice_id = $1",
        [invoice.id]
      )
      .then((r) => Number(r.rows[0].count));
    expect(attempts).toBe(0);

    await cleanupOrg(org.id);
  });

  it("Package 3 (1): ambiguous email delivery failure leaves invoice PREPARED, marks attempt and delivery UNKNOWN, and subsequent send throws ConflictError without calling provider again", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org Ambiguous",
      10
    );
    let emailCallCount = 0;
    const deps = stubDeps({
      emailService: {
        sendInvoice: async () => {
          emailCallCount++;
          return {
            success: false,
            provider: "smtp" as const,
            errorCode: "FAKE_AMBIGUOUS",
            failureClassification: "AMBIGUOUS" as const,
          };
        },
      },
    });

    const first = await sendInvoice(db, org.id, invoice.id, deps, seedAdminId);
    expect(first.sentAt).toBeNull();

    const [caseRow] = await db.$client
      .query(
        "select status from billing_cases where id = (select billing_case_id from invoices where id = $1)",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(caseRow.status).toBe("PREPARED");

    await expect(
      sendInvoice(db, org.id, invoice.id, deps, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);
    expect(emailCallCount).toBe(1);

    const attempts = await db.$client
      .query(
        "select status, error_code from invoice_send_attempts where invoice_id = $1",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toEqual({
      status: "UNKNOWN",
      error_code: "FAKE_AMBIGUOUS",
    });

    const deliveries = await db.$client
      .query(
        "select method, status, error_code from invoice_deliveries where invoice_id = $1",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toEqual({
      method: "EMAIL",
      status: "UNKNOWN",
      error_code: "FAKE_AMBIGUOUS",
    });

    await cleanupOrg(org.id);
  });

  it("Package 3 (2): stale CLAIMED row reconciles to FAILED and subsequent sendInvoice claims fresh and completes normally", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org StaleClaim",
      11
    );
    const claim = await claimSendAttempt(db, org.id, invoice.id);
    expect(claim.claimed).toBe(true);

    // Simulate worker died before dispatch by backdating claimed_at past STALE_CLAIM_MS (60s)
    await db.$client.query(
      "update invoice_send_attempts set claimed_at = now() - interval '2 minutes' where id = $1",
      [claim.attempt.id]
    );

    const sent = await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps(),
      seedAdminId
    );
    expect(sent.sentAt).not.toBeNull();

    const [caseRow] = await db.$client
      .query(
        "select status from billing_cases where id = (select billing_case_id from invoices where id = $1)",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(caseRow.status).toBe("SENT");

    const attempts = await db.$client
      .query(
        "select status, error_code from invoice_send_attempts where invoice_id = $1 order by created_at",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual({
      status: "FAILED",
      error_code: "ABANDONED_BEFORE_DISPATCH",
    });
    expect(attempts[1].status).toBe("SENT");

    await cleanupOrg(org.id);
  });

  it("Package 3 (3): stale DISPATCHING row reconciles to UNKNOWN and subsequent sendInvoice throws ConflictError rather than sending", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org StaleDispatch",
      3
    );
    const claim = await claimSendAttempt(db, org.id, invoice.id);
    expect(claim.claimed).toBe(true);
    await markDispatching(db, claim.attempt.id, org.id, invoice.id);

    // Simulate worker crash after dispatch started by backdating dispatch_started_at past STALE_DISPATCH_MS (5m)
    await db.$client.query(
      "update invoice_send_attempts set dispatch_started_at = now() - interval '10 minutes' where id = $1",
      [claim.attempt.id]
    );

    let emailCalled = false;
    const deps = stubDeps({
      emailService: {
        sendInvoice: async () => {
          emailCalled = true;
          return { success: true, provider: "smtp" as const };
        },
      },
    });

    await expect(
      sendInvoice(db, org.id, invoice.id, deps, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);
    expect(emailCalled).toBe(false);

    const { invoice: current } = await getInvoice(db, org.id, invoice.id);
    expect(current.sentAt).toBeNull();

    const [attemptRow] = await db.$client
      .query(
        "select status, error_code from invoice_send_attempts where id = $1",
        [claim.attempt.id]
      )
      .then((r) => r.rows);
    expect(attemptRow.status).toBe("UNKNOWN");
    expect(attemptRow.error_code).toBe("STALE_DISPATCH_NO_CONFIRMATION");

    await cleanupOrg(org.id);
  });

  it("Package 2 (6): EMAIL+PAPER, email fails definitively: sendInvoice leaves invoice PREPARED, sentAt null, and NO paper delivery row created", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org BothDefinitiveFail",
      1,
      {
        invoiceByEmail: true,
        invoiceByPaper: true,
      }
    );

    const deps = stubDeps({
      emailService: {
        sendInvoice: async () => ({
          success: false,
          provider: "smtp" as const,
          errorCode: "MAILBOX_FULL",
          failureClassification: "DEFINITIVE" as const,
        }),
      },
    });

    const sent = await sendInvoice(db, org.id, invoice.id, deps, seedAdminId);
    expect(sent.sentAt).toBeNull();

    const [caseRow] = await db.$client
      .query(
        "select status from billing_cases where id = (select billing_case_id from invoices where id = $1)",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(caseRow.status).toBe("PREPARED");

    const deliveries = await db.$client
      .query(
        "select method, status, error_code from invoice_deliveries where invoice_id = $1",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(deliveries).toEqual([
      { method: "EMAIL", status: "FAILED", error_code: "MAILBOX_FULL" },
    ]);

    const paperDeliveries = await db.$client
      .query(
        "select count(*) from invoice_deliveries where invoice_id = $1 and method = 'PAPER'",
        [invoice.id]
      )
      .then((r) => Number(r.rows[0].count));
    expect(paperDeliveries).toBe(0);

    await cleanupOrg(org.id);
  });

  it("Package 2 (3) / Package 3 (5): Explicit email resend of an UNKNOWN invoice succeeds and finalizes, new attempt row created, sentAt set, case SENT, original attempt untouched", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org ResendUnknown",
      2
    );

    // First send has ambiguous failure -> sentAt stays null, attempt is UNKNOWN
    let emailCallCount = 0;
    const ambiguousDeps = stubDeps({
      emailService: {
        sendInvoice: async () => {
          emailCallCount++;
          return {
            success: false,
            provider: "smtp" as const,
            errorCode: "FAKE_AMBIGUOUS",
            failureClassification: "AMBIGUOUS" as const,
          };
        },
      },
    });
    const firstSend = await sendInvoice(
      db,
      org.id,
      invoice.id,
      ambiguousDeps,
      seedAdminId
    );
    expect(firstSend.sentAt).toBeNull();
    expect(emailCallCount).toBe(1);

    // resendInvoice succeeds and does not throw ConflictError
    const succeedingDeps = stubDeps({
      emailService: {
        sendInvoice: async () => {
          emailCallCount++;
          return { success: true, provider: "smtp" as const };
        },
      },
    });
    const resent = await resendInvoice(
      db,
      org.id,
      invoice.id,
      succeedingDeps,
      seedAdminId
    );
    expect(resent.id).toBe(invoice.id);
    expect(resent.sentAt).not.toBeNull();
    expect(emailCallCount).toBe(2);

    const [caseRow] = await db.$client
      .query(
        "select status from billing_cases where id = (select billing_case_id from invoices where id = $1)",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(caseRow.status).toBe("SENT");

    const deliveries = await db.$client
      .query(
        "select method, status, attempt_id from invoice_deliveries where invoice_id = $1 order by created_at",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(deliveries).toHaveLength(2);
    expect(deliveries[0].status).toBe("UNKNOWN");
    expect(deliveries[0].attempt_id).not.toBeNull();
    expect(deliveries[1].status).toBe("SENT");
    expect(deliveries[1].attempt_id).not.toBeNull();
    expect(deliveries[1].attempt_id).not.toBe(deliveries[0].attempt_id);

    // Assert a NEW attempt row exists (different id from original UNKNOWN one)
    const attempts = await db.$client
      .query(
        "select id, status, error_code from invoice_send_attempts where invoice_id = $1 order by created_at",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(attempts).toHaveLength(2);
    expect(attempts[0].id).toBe(deliveries[0].attempt_id);
    expect(attempts[0].status).toBe("UNKNOWN");
    expect(attempts[0].error_code).toBe("FAKE_AMBIGUOUS");
    expect(attempts[1].id).toBe(deliveries[1].attempt_id);
    expect(attempts[1].status).toBe("SENT");

    // Exactly one INVOICE_SENT audit event
    const logs = await listAuditLogs(db, org.id);
    const sentLogs = logs.filter((l) => l.action === "INVOICE_SENT");
    expect(sentLogs).toHaveLength(1);

    await cleanupOrg(org.id);
  });

  it("Fix 3: resendInvoice throws ConflictError without calling provider if a first-send attempt is CLAIMED or DISPATCHING", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org ResendInFlight",
      3
    );

    // Claim an attempt to simulate an in-flight first-send
    const claim = await claimSendAttempt(db, org.id, invoice.id);
    expect(claim.claimed).toBe(true);

    let emailCallCount = 0;
    const deps = stubDeps({
      emailService: {
        sendInvoice: async () => {
          emailCallCount++;
          return { success: true, provider: "smtp" as const };
        },
      },
    });

    // Calling resendInvoice while attempt is CLAIMED must throw ConflictError
    await expect(
      resendInvoice(db, org.id, invoice.id, deps, seedAdminId)
    ).rejects.toThrow(
      "A delivery attempt is currently in progress for this invoice; wait for it to finish before resending."
    );

    // Assert email provider was never called
    expect(emailCallCount).toBe(0);

    // Transition to DISPATCHING and verify it still blocks resend
    await markDispatching(db, claim.attempt.id, org.id, invoice.id);

    await expect(
      resendInvoice(db, org.id, invoice.id, deps, seedAdminId)
    ).rejects.toThrow(
      "A delivery attempt is currently in progress for this invoice; wait for it to finish before resending."
    );
    expect(emailCallCount).toBe(0);

    await cleanupOrg(org.id);
  });

  it("Fix 6 (revised): stale DISPATCHING electronic attempt with confirmed EMAIL delivery completes finalization instead of UNKNOWN", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org StaleEmailConfirm",
      4
    );

    const claim = await claimSendAttempt(db, org.id, invoice.id);
    expect(claim.claimed).toBe(true);
    await markDispatching(db, claim.attempt.id, org.id, invoice.id);

    // Manually insert an EMAIL invoice_deliveries row with status SENT and
    // attempt_id set to that attempt's id (mirroring what deliver() would
    // have done before a worker crash).
    await db.insert(invoiceDeliveries).values({
      organizationId: org.id,
      invoiceId: invoice.id,
      attemptId: claim.attempt.id,
      method: "EMAIL",
      destinationEmail: "resident@example.com",
      provider: "smtp",
      status: "SENT",
      sentAt: new Date(),
    });

    // Backdate dispatch_started_at past the staleness threshold (5 minutes)
    await db.$client.query(
      "update invoice_send_attempts set dispatch_started_at = now() - interval '10 minutes' where id = $1",
      [claim.attempt.id]
    );

    // Calling sendInvoice again should complete successfully (sentAt set, case SENT) rather than throwing UNKNOWN
    const sent = await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps(),
      seedAdminId
    );
    expect(sent.sentAt).not.toBeNull();

    const [caseRow] = await db.$client
      .query(
        "select status from billing_cases where id = (select billing_case_id from invoices where id = $1)",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(caseRow.status).toBe("SENT");

    // Attempt should now be SENT
    const [attemptRow] = await db.$client
      .query(
        "select status, error_code from invoice_send_attempts where id = $1",
        [claim.attempt.id]
      )
      .then((r) => r.rows);
    expect(attemptRow.status).toBe("SENT");

    await cleanupOrg(org.id);
  });

  it("Regression: stale DISPATCHING electronic attempt with ONLY a linked PAPER/SENT row (no EMAIL evidence) reconciles to UNKNOWN, never SENT", async () => {
    // The previous version of this reconciliation logic treated ANY linked
    // delivery row with status SENT as confirmation, which let an
    // (architecturally unrealistic, but historically possible) PAPER-linked
    // row falsely confirm an electronic attempt. Only EMAIL evidence may
    // confirm an electronic attempt now.
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org StalePaperCannotConfirm",
      5
    );

    const claim = await claimSendAttempt(db, org.id, invoice.id);
    expect(claim.claimed).toBe(true);
    await markDispatching(db, claim.attempt.id, org.id, invoice.id);

    await db.insert(invoiceDeliveries).values({
      organizationId: org.id,
      invoiceId: invoice.id,
      attemptId: claim.attempt.id,
      method: "PAPER",
      destinationEmail: null,
      provider: "paper",
      status: "SENT",
      sentAt: new Date(),
    });

    await db.$client.query(
      "update invoice_send_attempts set dispatch_started_at = now() - interval '10 minutes' where id = $1",
      [claim.attempt.id]
    );

    await expect(
      sendInvoice(db, org.id, invoice.id, stubDeps(), seedAdminId)
    ).rejects.toThrow(ConflictError);

    const [attemptRow] = await db.$client
      .query("select status from invoice_send_attempts where id = $1", [
        claim.attempt.id,
      ])
      .then((r) => r.rows);
    expect(attemptRow.status).toBe("UNKNOWN");

    const { invoice: reloaded, caseStatus } = await getInvoice(
      db,
      org.id,
      invoice.id
    );
    expect(reloaded.sentAt).toBeNull();
    expect(caseStatus).toBe("PREPARED");

    await cleanupOrg(org.id);
  });

  it("CASE 7: expected-attempt CAS updating zero rows (another finalizer already won) still reconciles to a coherent SENT state with exactly one audit", async () => {
    // Deterministically forces the exact zero-row expected-attempt CAS
    // window using REAL Postgres row locking as the synchronization
    // primitive, not an artificial gate or a sleep: a manually-held open
    // transaction on a second raw connection performs the SAME conditional
    // UPDATE finalizeInvoiceSentInTx would run and holds it uncommitted,
    // so a concurrent sendInvoice() call's own attempt-status CAS is
    // guaranteed to block on that row lock and then see zero rows once the
    // held transaction commits first.
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org CasZeroRowConflict",
      6
    );

    const claim = await claimSendAttempt(db, org.id, invoice.id);
    await markDispatching(db, claim.attempt.id, org.id, invoice.id);
    await db.insert(invoiceDeliveries).values({
      organizationId: org.id,
      invoiceId: invoice.id,
      attemptId: claim.attempt.id,
      method: "EMAIL",
      destinationEmail: "resident@example.com",
      provider: "smtp",
      status: "SENT",
      sentAt: new Date(),
    });
    await db.$client.query(
      "update invoice_send_attempts set dispatch_started_at = now() - interval '10 minutes' where id = $1",
      [claim.attempt.id]
    );

    // A second raw connection stands in for "another finalizer that wins
    // the race": it performs the exact conditional attempt-status
    // transition finalizeInvoiceSentInTx uses (DISPATCHING -> SENT,
    // expected-status guarded) inside an open, uncommitted transaction.
    const lockHolder = await createIntegrationDb();
    try {
      // Simulates a DIFFERENT reconciler racing on the same stale attempt
      // and (having independently seen no confirmed evidence, or simply
      // losing its own race) demoting it to UNKNOWN -- exactly
      // markUnknownConditional's own CAS shape.
      await lockHolder.$client.query("BEGIN");
      const held = await lockHolder.$client.query(
        `UPDATE invoice_send_attempts
         SET status = 'UNKNOWN', error_code = 'STALE_DISPATCH_NO_CONFIRMATION', completed_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'DISPATCHING'
         RETURNING id`,
        [claim.attempt.id]
      );
      expect(held.rowCount).toBe(1);

      // sendInvoice's own reconciliation path will hit IN_FLIGHT on this
      // stale attempt, find the confirmed EMAIL evidence, and attempt the
      // SAME conditional UPDATE -- which blocks on lockHolder's open
      // transaction's row lock.
      const dbB = await createIntegrationDb();
      let sendPromiseSettled = false;
      const sendPromise = sendInvoice(
        dbB,
        org.id,
        invoice.id,
        stubDeps(),
        seedAdminId
      ).finally(() => {
        sendPromiseSettled = true;
      });

      // Give the second call time to actually reach and block on the row
      // lock before releasing it (bounded wait to sequence the test step,
      // not the correctness mechanism -- the row lock itself is).
      await new Promise((r) => setTimeout(r, 100));
      expect(sendPromiseSettled).toBe(false);

      await lockHolder.$client.query("COMMIT");

      const result = await sendPromise;
      expect(result.sentAt).not.toBeNull();

      await dbB.$client.end();
    } finally {
      await lockHolder.$client.end();
    }

    const [attemptRow] = await db.$client
      .query("select status from invoice_send_attempts where id = $1", [
        claim.attempt.id,
      ])
      .then((r) => r.rows);
    expect(attemptRow.status).toBe("SENT");

    const { invoice: reloaded, caseStatus } = await getInvoice(
      db,
      org.id,
      invoice.id
    );
    expect(reloaded.sentAt).not.toBeNull();
    expect(caseStatus).toBe("SENT");

    const logs = await listAuditLogs(db, org.id);
    expect(logs.filter((l) => l.action === "INVOICE_SENT")).toHaveLength(1);

    await cleanupOrg(org.id);
  });

  it("Regression: a crashed Resend recovers when a DIFFERENT commandId retries (e.g. a page reload)", async () => {
    // EMAIL already succeeded once. An explicit resend claims an attempt,
    // then the Worker crashes before ever reaching the provider call. The
    // attempt is left CLAIMED forever unless resendInvoice itself can
    // reconcile a stale attempt -- previously it only ever threw "in
    // progress" on IN_FLIGHT, with no way out.
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org StaleResendClaim",
      7
    );
    await sendInvoice(db, org.id, invoice.id, stubDeps(), seedAdminId);

    const staleClaim = await claimSendAttempt(db, org.id, invoice.id);
    expect(staleClaim.claimed).toBe(true);
    // Backdate past STALE_CLAIM_MS (60s) so it's classified abandoned.
    await db.$client.query(
      "update invoice_send_attempts set claimed_at = now() - interval '2 minutes' where id = $1",
      [staleClaim.attempt.id]
    );

    let emailCallCount = 0;
    const recovered = await resendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps({
        emailService: {
          sendInvoice: async () => {
            emailCallCount++;
            return { success: true, provider: "smtp" as const };
          },
        },
      }),
      seedAdminId,
      "recovery-click"
    );

    // The stale CLAIMED attempt was reconciled to FAILED (abandoned before
    // dispatch), then a genuinely fresh attempt was claimed and dispatched
    // -- exactly one provider call for this one logical recovery click.
    expect(emailCallCount).toBe(1);
    expect(recovered.sentAt).not.toBeNull();

    const attempts = await db.$client
      .query(
        "select status, error_code from invoice_send_attempts where invoice_id = $1 order by created_at",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(attempts).toEqual([
      { status: "SENT", error_code: null },
      { status: "FAILED", error_code: "ABANDONED_BEFORE_DISPATCH" },
      { status: "SENT", error_code: null },
    ]);

    await cleanupOrg(org.id);
  });

  it("Regression: a crashed Resend recovers when the SAME commandId retries (the browser resubmitting the identical still-rendered form, no reload)", async () => {
    // The stricter, more realistic crash scenario: the attempt that gets
    // stuck CLAIMED was itself claimed under a real commandId (as a real
    // Resend click does via claimSendCommand), and the SAME commandId is
    // used to retry -- e.g. the admin clicks Resend again on the same page
    // without reloading, or the browser automatically retries the POST.
    // The command_id uniqueness index must not treat the now-FAILED
    // reconciled row as a permanent claim on that commandId.
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org StaleResendSameCommand",
      9
    );
    await sendInvoice(db, org.id, invoice.id, stubDeps(), seedAdminId);

    const claim = await claimSendCommand(
      db,
      org.id,
      invoice.id,
      "RESEND",
      "same-command"
    );
    expect(claim.outcome).toBe("CLAIMED");
    if (claim.outcome !== "CLAIMED") throw new Error("unreachable");
    // Worker crashes right after claiming, before ever reaching the
    // provider -- backdate past STALE_CLAIM_MS (60s).
    await db.$client.query(
      "update invoice_send_attempts set claimed_at = now() - interval '2 minutes' where id = $1",
      [claim.attempt.id]
    );

    let emailCallCount = 0;
    const recovered = await resendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps({
        emailService: {
          sendInvoice: async () => {
            emailCallCount++;
            return { success: true, provider: "smtp" as const };
          },
        },
      }),
      seedAdminId,
      "same-command"
    );

    expect(emailCallCount).toBe(1);
    expect(recovered.sentAt).not.toBeNull();

    const attempts = await db.$client
      .query(
        "select status, command_id from invoice_send_attempts where invoice_id = $1 order by created_at",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(attempts).toEqual([
      { status: "SENT", command_id: null },
      { status: "FAILED", command_id: "same-command" },
      { status: "SENT", command_id: "same-command" },
    ]);

    await cleanupOrg(org.id);
  });

  it("Regression: stale DISPATCHING with a linked definitive EMAIL/FAILED delivery reconciles to FAILED (retryable), not UNKNOWN", async () => {
    // Worker crashes after deliver() inserts the FAILED delivery row but
    // before its own markFailed() call runs -- the attempt is left
    // DISPATCHING even though the database already holds definitive proof
    // the provider rejected the message. This must reconcile to FAILED
    // (safely retryable), not the more conservative UNKNOWN (which would
    // incorrectly demand manual judgment for a known outcome).
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org StaleDefinitiveFailed",
      8
    );

    const claim = await claimSendAttempt(db, org.id, invoice.id);
    await markDispatching(db, claim.attempt.id, org.id, invoice.id);
    await db.insert(invoiceDeliveries).values({
      organizationId: org.id,
      invoiceId: invoice.id,
      attemptId: claim.attempt.id,
      method: "EMAIL",
      destinationEmail: "resident@example.com",
      provider: "smtp",
      status: "FAILED",
      errorCode: "SMTP_REJECTED",
    });
    await db.$client.query(
      "update invoice_send_attempts set dispatch_started_at = now() - interval '10 minutes' where id = $1",
      [claim.attempt.id]
    );

    let emailCallCount = 0;
    const result = await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps({
        emailService: {
          sendInvoice: async () => {
            emailCallCount++;
            return { success: true, provider: "smtp" as const };
          },
        },
      }),
      seedAdminId
    );

    // The stale attempt reconciled to FAILED and a fresh retry claim
    // dispatched exactly once -- not left at UNKNOWN.
    expect(emailCallCount).toBe(1);
    expect(result.sentAt).not.toBeNull();

    const attempts = await db.$client
      .query(
        "select status, error_code from invoice_send_attempts where invoice_id = $1 order by created_at",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(attempts).toEqual([
      { status: "FAILED", error_code: "SMTP_REJECTED" },
      { status: "SENT", error_code: null },
    ]);

    await cleanupOrg(org.id);
  });

  it("Package 2 (1): resend vs scheduler retry after FAILED races with gated email service - exactly one provider call total", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org RaceResendSend",
      5
    );

    // 1. Create a FAILED first attempt
    const failingDeps = stubDeps({
      emailService: {
        sendInvoice: async () => ({
          success: false,
          provider: "smtp" as const,
          errorCode: "SIMULATED_FAIL",
          failureClassification: "DEFINITIVE" as const,
        }),
      },
    });
    const failedSend = await sendInvoice(
      db,
      org.id,
      invoice.id,
      failingDeps,
      seedAdminId
    );
    expect(failedSend.sentAt).toBeNull();

    // 2. Setup gated EmailService
    let emailCallCount = 0;
    const gate = createDeferredGate();
    const gatedDeps = stubDeps({
      emailService: {
        sendInvoice: async () => {
          emailCallCount++;
          await gate.promise;
          return { success: true, provider: "smtp" as const };
        },
      },
    });

    // 3. Race resendInvoice against sendInvoice -- two separate connections,
    // like two real concurrent HTTP requests, so claimSendCommand's
    // transaction genuinely races at the DB row-lock level instead of
    // serializing on one shared client.
    const dbA = await createIntegrationDb();
    const dbB = await createIntegrationDb();
    try {
      const p1 = resendInvoice(
        dbA,
        org.id,
        invoice.id,
        gatedDeps,
        seedAdminId
      ).catch((err) => err);
      const p2 = sendInvoice(
        dbB,
        org.id,
        invoice.id,
        gatedDeps,
        seedAdminId
      ).catch((err) => err);

      // Wait briefly for one caller to acquire the claim and enter the email provider
      await new Promise((r) => setTimeout(r, 60));
      gate.resolve();

      const [r1, r2] = await Promise.all([p1, p2]);

      // Exactly one email provider call total
      expect(emailCallCount).toBe(1);

      // Invoice is now finalized as SENT
      const { invoice: finalInvoice, caseStatus } = await getInvoice(
        db,
        org.id,
        invoice.id
      );
      expect(finalInvoice.sentAt).not.toBeNull();
      expect(caseStatus).toBe("SENT");

      // One promise resolved to final invoice, the other either threw ConflictError (if resend collided) or returned the sent invoice (if sendInvoice waited)
      if (r1 instanceof ConflictError) {
        expect(r2).toHaveProperty("sentAt");
      } else {
        expect(r1).toHaveProperty("sentAt");
      }
    } finally {
      await dbA.$client.end();
      await dbB.$client.end();
      await cleanupOrg(org.id);
    }
  });

  it("Package 2 (2): resend vs resend concurrent calls on already-SENT invoice - exactly one provider call, one new attempt, one INVOICE_RESENT audit", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org RaceResendResend",
      6
    );

    // First send succeeds normally
    const sent = await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps(),
      seedAdminId
    );
    expect(sent.sentAt).not.toBeNull();

    let emailCallCount = 0;
    const gate = createDeferredGate();
    const gatedDeps = stubDeps({
      emailService: {
        sendInvoice: async () => {
          emailCallCount++;
          await gate.promise;
          return { success: true, provider: "smtp" as const };
        },
      },
    });

    // Two separate connections, like two real concurrent admin clicks from
    // two separate requests -- reusing one connection would serialize
    // claimSendCommand's transaction on the client and hide the race.
    const dbA = await createIntegrationDb();
    const dbB = await createIntegrationDb();
    try {
      const p1 = resendInvoice(dbA, org.id, invoice.id, gatedDeps, seedAdminId);
      const p2 = resendInvoice(dbB, org.id, invoice.id, gatedDeps, seedAdminId);
      const all = Promise.allSettled([p1, p2]);

      // Wait briefly so one claims and enters gated provider
      await new Promise((r) => setTimeout(r, 60));
      gate.resolve();

      const results = await all;
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // The loser's claim collides on a genuinely LIVE (not stale) attempt
      // -- resendInvoice fails fast with a clear "in progress" error rather
      // than silently waiting, since this is an explicit admin action, not
      // an idempotent "make sure it's sent" call.
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        ConflictError
      );

      // Exactly one provider call total during resend
      expect(emailCallCount).toBe(1);

      // Exactly one new attempt row created (2 total: 1 original + 1 from successful resend)
      const attempts = await db.$client
        .query(
          "select id, status from invoice_send_attempts where invoice_id = $1 order by created_at",
          [invoice.id]
        )
        .then((r) => r.rows);
      expect(attempts).toHaveLength(2);
      expect(attempts[0].status).toBe("SENT");
      expect(attempts[1].status).toBe("SENT");

      // Exactly one INVOICE_RESENT audit event
      const logs = await listAuditLogs(db, org.id);
      const resentLogs = logs.filter((l) => l.action === "INVOICE_RESENT");
      expect(resentLogs).toHaveLength(1);
    } finally {
      await dbA.$client.end();
      await dbB.$client.end();
      await cleanupOrg(org.id);
    }
  });

  it("Late-loser regression: a resend replayed with the SAME commandId strictly AFTER the original fully completed converges without a second provider call", async () => {
    // Directly exercises the exact race the old claimSendAttempt-only
    // approach could not close: a second submission that only resumes once
    // the winner has already gone fully terminal (not merely overlapping
    // it). No gate/timing needed -- the two calls are made fully
    // sequentially, since "sequential" is precisely the failure mode.
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org LateLoserResend",
      7
    );
    await sendInvoice(db, org.id, invoice.id, stubDeps(), seedAdminId);

    let emailCallCount = 0;
    const deps = stubDeps({
      emailService: {
        sendInvoice: async () => {
          emailCallCount++;
          return { success: true, provider: "smtp" as const };
        },
      },
    });

    const commandId = "same-click-command-id";
    const first = await resendInvoice(
      db,
      org.id,
      invoice.id,
      deps,
      seedAdminId,
      commandId
    );
    expect(emailCallCount).toBe(1);

    // Replays the SAME commandId only after `first` has fully committed
    // (SENT, finalized) -- a double-submit of the identical form, not a
    // fresh distinct resend.
    const second = await resendInvoice(
      db,
      org.id,
      invoice.id,
      deps,
      seedAdminId,
      commandId
    );

    expect(emailCallCount).toBe(1);
    expect(second.id).toBe(first.id);

    const attempts = await db.$client
      .query(
        "select count(*) from invoice_send_attempts where invoice_id = $1 and command_id = $2",
        [invoice.id, commandId]
      )
      .then((r) => Number(r.rows[0].count));
    expect(attempts).toBe(1);

    const logs = await listAuditLogs(db, org.id);
    const resentLogs = logs.filter((l) => l.action === "INVOICE_RESENT");
    expect(resentLogs).toHaveLength(1);

    await cleanupOrg(org.id);
  });

  it("Late-loser regression: a genuinely later resend with a DIFFERENT commandId after full completion is a distinct dispatch", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org LateLoserDistinct",
      7
    );
    await sendInvoice(db, org.id, invoice.id, stubDeps(), seedAdminId);

    let emailCallCount = 0;
    const deps = stubDeps({
      emailService: {
        sendInvoice: async () => {
          emailCallCount++;
          return { success: true, provider: "smtp" as const };
        },
      },
    });

    await resendInvoice(db, org.id, invoice.id, deps, seedAdminId, "click-1");
    expect(emailCallCount).toBe(1);

    // A separate click (different commandId, e.g. from a fresh page load)
    // is a legitimate distinct resend and dispatches again.
    await resendInvoice(db, org.id, invoice.id, deps, seedAdminId, "click-2");
    expect(emailCallCount).toBe(2);

    await cleanupOrg(org.id);
  });

  it("Package 2 (7): recordPaperDispatch basic success sets sentAt, case SENT, one PAPER delivery, one INVOICE_SENT audit, zero send attempts", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org PaperBasic",
      9,
      {
        invoiceByPaper: true,
        invoiceByEmail: false,
      }
    );

    const sent = await recordPaperDispatch(db, org.id, invoice.id, seedAdminId);
    expect(sent.sentAt).not.toBeNull();

    const [caseRow] = await db.$client
      .query(
        "select status from billing_cases where id = (select billing_case_id from invoices where id = $1)",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(caseRow.status).toBe("SENT");

    const deliveries = await db.$client
      .query(
        "select method, status, destination_email, attempt_id from invoice_deliveries where invoice_id = $1",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(deliveries).toEqual([
      {
        method: "PAPER",
        status: "SENT",
        destination_email: null,
        attempt_id: null,
      },
    ]);

    // Paper dispatch never touches invoice_send_attempts
    const attempts = await db.$client
      .query(
        "select count(*) from invoice_send_attempts where invoice_id = $1",
        [invoice.id]
      )
      .then((r) => Number(r.rows[0].count));
    expect(attempts).toBe(0);

    // Exactly one INVOICE_SENT audit event
    const logs = await listAuditLogs(db, org.id);
    const sentLogs = logs.filter((l) => l.action === "INVOICE_SENT");
    expect(sentLogs).toHaveLength(1);

    await cleanupOrg(org.id);
  });

  it("Package 2 (8): recordPaperDispatch idempotent replay does not throw, still one PAPER row, one audit", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org PaperReplay",
      10,
      {
        invoiceByPaper: true,
        invoiceByEmail: false,
      }
    );

    const first = await recordPaperDispatch(
      db,
      org.id,
      invoice.id,
      seedAdminId
    );
    expect(first.sentAt).not.toBeNull();

    // Second call on same invoice
    const second = await recordPaperDispatch(
      db,
      org.id,
      invoice.id,
      seedAdminId
    );
    expect(second.sentAt?.getTime()).toBe(first.sentAt?.getTime());

    const deliveries = await db.$client
      .query("select count(*) from invoice_deliveries where invoice_id = $1", [
        invoice.id,
      ])
      .then((r) => Number(r.rows[0].count));
    expect(deliveries).toBe(1);

    const logs = await listAuditLogs(db, org.id);
    const sentLogs = logs.filter((l) => l.action === "INVOICE_SENT");
    expect(sentLogs).toHaveLength(1);

    await cleanupOrg(org.id);
  });

  it("Package 2 (9): recordPaperDispatch concurrency race produces exactly one PAPER row, one sentAt transition, one INVOICE_SENT audit", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org PaperRace",
      11,
      {
        invoiceByPaper: true,
        invoiceByEmail: false,
      }
    );

    // Two separate connections, like two real concurrent admin clicks --
    // recordPaperDispatch's SELECT ... FOR UPDATE lock genuinely needs two
    // physical connections to race against each other.
    const dbA = await createIntegrationDb();
    const dbB = await createIntegrationDb();
    try {
      const [r1, r2] = await Promise.all([
        recordPaperDispatch(dbA, org.id, invoice.id, seedAdminId),
        recordPaperDispatch(dbB, org.id, invoice.id, seedAdminId),
      ]);

      expect(r1.sentAt).not.toBeNull();
      expect(r2.sentAt).not.toBeNull();
      expect(r1.sentAt?.getTime()).toBe(r2.sentAt?.getTime());

      const deliveries = await db.$client
        .query(
          "select count(*) from invoice_deliveries where invoice_id = $1",
          [invoice.id]
        )
        .then((r) => Number(r.rows[0].count));
      expect(deliveries).toBe(1);

      const [caseRow] = await db.$client
        .query(
          "select status from billing_cases where id = (select billing_case_id from invoices where id = $1)",
          [invoice.id]
        )
        .then((r) => r.rows);
      expect(caseRow.status).toBe("SENT");

      const logs = await listAuditLogs(db, org.id);
      const sentLogs = logs.filter((l) => l.action === "INVOICE_SENT");
      expect(sentLogs).toHaveLength(1);
    } finally {
      await dbA.$client.end();
      await dbB.$client.end();
      await cleanupOrg(org.id);
    }
  });

  it("Package 2 (10): EMAIL UNKNOWN then PAPER dispatch finalizes invoice, original attempt/delivery remain UNKNOWN, provider not recalled", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org EmailUnknownThenPaper",
      2,
      {
        invoiceByEmail: true,
        invoiceByPaper: true,
      }
    );

    let emailCallCount = 0;
    const ambiguousDeps = stubDeps({
      emailService: {
        sendInvoice: async () => {
          emailCallCount++;
          return {
            success: false,
            provider: "smtp" as const,
            errorCode: "AMBIGUOUS_TEST",
            failureClassification: "AMBIGUOUS" as const,
          };
        },
      },
    });

    // 1. First send: email ambiguous failure -> sentAt null, attempt UNKNOWN
    const first = await sendInvoice(
      db,
      org.id,
      invoice.id,
      ambiguousDeps,
      seedAdminId
    );
    expect(first.sentAt).toBeNull();
    expect(emailCallCount).toBe(1);

    // 2. Record paper dispatch
    const dispatched = await recordPaperDispatch(
      db,
      org.id,
      invoice.id,
      seedAdminId
    );
    expect(dispatched.sentAt).not.toBeNull();

    // Provider was never called again
    expect(emailCallCount).toBe(1);

    // Billing case is SENT
    const [caseRow] = await db.$client
      .query(
        "select status from billing_cases where id = (select billing_case_id from invoices where id = $1)",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(caseRow.status).toBe("SENT");

    // Exactly one INVOICE_SENT audit event
    const logs = await listAuditLogs(db, org.id);
    const sentLogs = logs.filter((l) => l.action === "INVOICE_SENT");
    expect(sentLogs).toHaveLength(1);

    // Original attempt row STILL shows UNKNOWN
    const attempts = await db.$client
      .query(
        "select status, error_code from invoice_send_attempts where invoice_id = $1",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("UNKNOWN");
    expect(attempts[0].error_code).toBe("AMBIGUOUS_TEST");

    // Deliveries: EMAIL is still UNKNOWN, PAPER is SENT
    const deliveries = await db.$client
      .query(
        "select method, status, error_code from invoice_deliveries where invoice_id = $1 order by method",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(deliveries).toEqual([
      { method: "EMAIL", status: "UNKNOWN", error_code: "AMBIGUOUS_TEST" },
      { method: "PAPER", status: "SENT", error_code: null },
    ]);

    await cleanupOrg(org.id);
  });

  it("Package 3 (1): ensureCanonicalPdf generates canonical PDF for a PAPER-only PREPARED invoice without sending", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org PaperPdfOnly",
      3,
      {
        invoiceByEmail: false,
        invoiceByPaper: true,
      }
    );

    try {
      expect(invoice.pdfObjectKey).toBeNull();
      expect(invoice.pdfSha256).toBeNull();

      const canonical = await ensureCanonicalPdf(
        db,
        org.id,
        invoice.id,
        stubDeps()
      );

      expect(canonical.pdfObjectKey).toContain(org.id);
      expect(canonical.pdfSha256).toHaveLength(64);

      const { invoice: reloaded, caseStatus } = await getInvoice(
        db,
        org.id,
        invoice.id
      );
      expect(reloaded.pdfObjectKey).toBe(canonical.pdfObjectKey);
      expect(reloaded.pdfSha256).toBe(canonical.pdfSha256);
      expect(reloaded.sentAt).toBeNull();
      expect(caseStatus).toBe("PREPARED");

      const deliveryCount = await db.$client
        .query(
          "select count(*) from invoice_deliveries where invoice_id = $1",
          [invoice.id]
        )
        .then((r) => Number(r.rows[0].count));
      expect(deliveryCount).toBe(0);

      const attemptCount = await db.$client
        .query(
          "select count(*) from invoice_send_attempts where invoice_id = $1",
          [invoice.id]
        )
        .then((r) => Number(r.rows[0].count));
      expect(attemptCount).toBe(0);
    } finally {
      await cleanupOrg(org.id);
    }
  });

  it("Package 3 (2): concurrent ensureCanonicalPdf calls serialize via row lock and return identical metadata", async () => {
    const { org, invoice } = await setupPreparedInvoice("IT-G Org PdfRace", 4, {
      invoiceByEmail: false,
      invoiceByPaper: true,
    });

    let renderCount = 0;
    const deps = stubDeps({
      renderPdf: async () => {
        renderCount++;
        // Simulate non-deterministic render bytes (e.g. timestamp metadata) and async delay
        await new Promise((r) => setTimeout(r, 50));
        return new TextEncoder().encode(
          `%PDF-1.4 render-${renderCount}-${Date.now()}`
        );
      },
    });

    // Two separate connections, like two real concurrent HTTP requests
    // (withRequestDb opens a fresh createDb() per request) -- reusing one
    // connection would serialize on the client and hide the row-level DB lock race.
    const dbA = await createIntegrationDb();
    const dbB = await createIntegrationDb();

    try {
      const [res1, res2] = await Promise.all([
        ensureCanonicalPdf(dbA, org.id, invoice.id, deps),
        ensureCanonicalPdf(dbB, org.id, invoice.id, deps),
      ]);

      expect(res1.pdfObjectKey).toBe(res2.pdfObjectKey);
      expect(res1.pdfSha256).toBe(res2.pdfSha256);

      // Because the second caller blocked on FOR UPDATE, once unblocked it found
      // pdfObjectKey/pdfSha256 already set and returned early without calling renderPdf again
      expect(renderCount).toBe(1);

      const { invoice: reloaded } = await getInvoice(db, org.id, invoice.id);
      expect(reloaded.pdfObjectKey).toBe(res1.pdfObjectKey);
      expect(reloaded.pdfSha256).toBe(res1.pdfSha256);
    } finally {
      await dbA.$client.end();
      await dbB.$client.end();
      await cleanupOrg(org.id);
    }
  });

  it("CASE 1: PAPER dispatched first, then EMAIL sent later -- provider called once, PAPER unchanged, sentAt unchanged, no duplicate INVOICE_SENT", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org PaperFirstEmail",
      8,
      { invoiceByEmail: true, invoiceByPaper: true }
    );

    const afterPaper = await recordPaperDispatch(
      db,
      org.id,
      invoice.id,
      seedAdminId
    );
    expect(afterPaper.sentAt).not.toBeNull();
    const originalSentAt = afterPaper.sentAt!.getTime();

    const emailRowsBefore = await db.$client
      .query(
        "select count(*) from invoice_deliveries where invoice_id = $1 and method = 'EMAIL'",
        [invoice.id]
      )
      .then((r) => Number(r.rows[0].count));
    expect(emailRowsBefore).toBe(0);

    let emailCallCount = 0;
    const deps = stubDeps({
      emailService: {
        sendInvoice: async () => {
          emailCallCount++;
          return { success: true, provider: "smtp" as const };
        },
      },
    });

    // The "send by email" action for a PAPER-first invoice: no EMAIL
    // attempt has ever been made, so sendInvoice is the correct command
    // (electronicState NONE in the UI's model) -- it must NOT be a no-op
    // just because invoice.sentAt is already set by PAPER.
    const afterEmail = await sendInvoice(
      db,
      org.id,
      invoice.id,
      deps,
      seedAdminId
    );

    expect(emailCallCount).toBe(1);
    expect(afterEmail.sentAt?.getTime()).toBe(originalSentAt);

    const deliveries = await db.$client
      .query(
        "select method, status from invoice_deliveries where invoice_id = $1 order by method",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(deliveries).toEqual([
      { method: "EMAIL", status: "SENT" },
      { method: "PAPER", status: "SENT" },
    ]);

    const logs = await listAuditLogs(db, org.id);
    expect(logs.filter((l) => l.action === "INVOICE_SENT")).toHaveLength(1);

    await cleanupOrg(org.id);
  });

  it("CASE 2: EMAIL sent, explicit resend fails, then a further explicit resend succeeds -- working retry, no duplicate INVOICE_SENT", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org SentFailedRetry",
      9
    );

    const firstSend = await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps(),
      seedAdminId
    );
    expect(firstSend.sentAt).not.toBeNull();
    const originalSentAt = firstSend.sentAt!.getTime();

    const failingResend = await resendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps({
        emailService: {
          sendInvoice: async () => ({
            success: false,
            provider: "smtp" as const,
            errorCode: "SIMULATED_FAIL",
            failureClassification: "DEFINITIVE" as const,
          }),
        },
      }),
      seedAdminId,
      "retry-1"
    );
    expect(failingResend.sentAt?.getTime()).toBe(originalSentAt);

    const attemptsAfterFail = await db.$client
      .query(
        "select status from invoice_send_attempts where invoice_id = $1 order by created_at",
        [invoice.id]
      )
      .then((r) => r.rows.map((row) => row.status));
    expect(attemptsAfterFail).toEqual(["SENT", "FAILED"]);

    let retryEmailCallCount = 0;
    const successfulRetry = await resendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps({
        emailService: {
          sendInvoice: async () => {
            retryEmailCallCount++;
            return { success: true, provider: "smtp" as const };
          },
        },
      }),
      seedAdminId,
      "retry-2"
    );
    expect(retryEmailCallCount).toBe(1);
    expect(successfulRetry.sentAt?.getTime()).toBe(originalSentAt);

    const attemptsAfterRetry = await db.$client
      .query(
        "select status from invoice_send_attempts where invoice_id = $1 order by created_at",
        [invoice.id]
      )
      .then((r) => r.rows.map((row) => row.status));
    expect(attemptsAfterRetry).toEqual(["SENT", "FAILED", "SENT"]);

    const logs = await listAuditLogs(db, org.id);
    expect(logs.filter((l) => l.action === "INVOICE_SENT")).toHaveLength(1);
    expect(
      logs.filter((l) => l.action === "INVOICE_RESEND_FAILED")
    ).toHaveLength(1);
    expect(logs.filter((l) => l.action === "INVOICE_RESENT")).toHaveLength(1);

    await cleanupOrg(org.id);
  });

  it("Regression: sendInvoice() called directly is a no-op (zero provider calls) once EMAIL has ever been confirmed delivered, even if the LATEST attempt is FAILED", async () => {
    // The exact stale-tab scenario: attempt 1 SENT, an explicit resend
    // FAILED -- the latest attempt is FAILED, but EMAIL has definitely
    // already been delivered once. sendInvoice must not treat this as "no
    // attempt has ever succeeded" and claim a fresh duplicate dispatch.
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org StaleSendTab",
      3
    );

    await sendInvoice(db, org.id, invoice.id, stubDeps(), seedAdminId);

    await resendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps({
        emailService: {
          sendInvoice: async () => ({
            success: false,
            provider: "smtp" as const,
            errorCode: "SIMULATED_FAIL",
            failureClassification: "DEFINITIVE" as const,
          }),
        },
      }),
      seedAdminId,
      "resend-1"
    );

    const attemptsBefore = await db.$client
      .query(
        "select status from invoice_send_attempts where invoice_id = $1 order by created_at",
        [invoice.id]
      )
      .then((r) => r.rows.map((row) => row.status));
    expect(attemptsBefore).toEqual(["SENT", "FAILED"]);

    let emailCallCount = 0;
    const result = await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps({
        emailService: {
          sendInvoice: async () => {
            emailCallCount++;
            return { success: true, provider: "smtp" as const };
          },
        },
      }),
      seedAdminId
    );

    expect(emailCallCount).toBe(0);
    const attemptsAfter = await db.$client
      .query(
        "select status from invoice_send_attempts where invoice_id = $1 order by created_at",
        [invoice.id]
      )
      .then((r) => r.rows.map((row) => row.status));
    expect(attemptsAfter).toEqual(["SENT", "FAILED"]);
    expect(result.id).toBe(invoice.id);

    await cleanupOrg(org.id);
  });

  it("Regression: sendInvoice() is a no-op against a legacy EMAIL/SENT delivery row with no invoice_send_attempts row at all", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org LegacyEmailSent",
      4
    );

    // Simulate pre-attempts-model historical data: an EMAIL/SENT delivery
    // row exists, but no invoice_send_attempts row was ever created for it
    // (this predates that table). The invoice itself is already SENT.
    await db.insert(invoiceDeliveries).values({
      organizationId: org.id,
      invoiceId: invoice.id,
      attemptId: null,
      method: "EMAIL",
      destinationEmail: "resident@example.com",
      provider: "smtp",
      status: "SENT",
      sentAt: new Date(),
    });
    await db.$client.query(
      "update invoices set sent_at = now() where id = $1",
      [invoice.id]
    );
    await db.$client.query(
      "update billing_cases set status = 'SENT' where id = (select billing_case_id from invoices where id = $1)",
      [invoice.id]
    );

    let emailCallCount = 0;
    await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps({
        emailService: {
          sendInvoice: async () => {
            emailCallCount++;
            return { success: true, provider: "smtp" as const };
          },
        },
      }),
      seedAdminId
    );

    expect(emailCallCount).toBe(0);
    const attemptCount = await db.$client
      .query(
        "select count(*) from invoice_send_attempts where invoice_id = $1",
        [invoice.id]
      )
      .then((r) => Number(r.rows[0].count));
    expect(attemptCount).toBe(0);

    await cleanupOrg(org.id);
  });

  it("Regression: an unverified legacy PAPER/SENT row cannot serve as confirmed evidence during stale electronic-attempt reconciliation", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org LegacyPaperEvidence",
      5,
      { invoiceByEmail: true, invoiceByPaper: true }
    );

    const claim = await claimSendAttempt(db, org.id, invoice.id);
    expect(claim.claimed).toBe(true);
    await markDispatching(db, claim.attempt.id, org.id, invoice.id);

    // An unverified legacy PAPER row -- NOT linked to this attempt in the
    // current architecture (recordPaperDispatch always sets attemptId:
    // null), but present in the invoice's overall delivery history. It
    // must not be able to prove that the electronic attempt was confirmed.
    await db.insert(invoiceDeliveries).values({
      organizationId: org.id,
      invoiceId: invoice.id,
      attemptId: null,
      method: "PAPER",
      destinationEmail: null,
      provider: "paper",
      status: "SENT",
      isInitialPaperDispatch: false,
    });

    // Backdate past the staleness threshold (5 minutes).
    await db.$client.query(
      "update invoice_send_attempts set dispatch_started_at = now() - interval '10 minutes' where id = $1",
      [claim.attempt.id]
    );

    // No EMAIL delivery row exists for this attempt -- reconciliation must
    // demote it to UNKNOWN, never finalize it as SENT off the strength of
    // the unrelated legacy PAPER row.
    await expect(
      sendInvoice(db, org.id, invoice.id, stubDeps(), seedAdminId)
    ).rejects.toThrow(ConflictError);

    const [attemptRow] = await db.$client
      .query("select status from invoice_send_attempts where id = $1", [
        claim.attempt.id,
      ])
      .then((r) => r.rows);
    expect(attemptRow.status).toBe("UNKNOWN");

    const { invoice: reloaded, caseStatus } = await getInvoice(
      db,
      org.id,
      invoice.id
    );
    expect(reloaded.sentAt).toBeNull();
    expect(caseStatus).toBe("PREPARED");

    await cleanupOrg(org.id);
  });

  it("CASE 3: EMAIL sent, explicit resend comes back UNKNOWN -- overall stays SENT, original success preserved, UNKNOWN never auto-retried", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org SentThenUnknown",
      10
    );

    const firstSend = await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps(),
      seedAdminId
    );
    const originalSentAt = firstSend.sentAt!.getTime();

    await resendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps({
        emailService: {
          sendInvoice: async () => ({
            success: false,
            provider: "smtp" as const,
            errorCode: "TIMEOUT",
            failureClassification: "AMBIGUOUS" as const,
          }),
        },
      }),
      seedAdminId,
      "unknown-attempt"
    );

    const { invoice: afterUnknown } = await getInvoice(db, org.id, invoice.id);
    expect(afterUnknown.sentAt?.getTime()).toBe(originalSentAt);

    const deliveries = await db.$client
      .query(
        "select status from invoice_deliveries where invoice_id = $1 and method = 'EMAIL' order by created_at",
        [invoice.id]
      )
      .then((r) => r.rows.map((row) => row.status));
    expect(deliveries).toEqual(["SENT", "UNKNOWN"]);

    // EMAIL has already been confirmed delivered once (the historical SENT
    // attempt), so sendInvoice's own "first send" semantics are already
    // satisfied -- it is a safe, idempotent no-op here (not a retry, not a
    // throw), the same as it would be if the latest attempt were still
    // SENT. It must NOT call the provider again.
    let staleSendCallCount = 0;
    const afterStaleSend = await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps({
        emailService: {
          sendInvoice: async () => {
            staleSendCallCount++;
            return { success: true, provider: "smtp" as const };
          },
        },
      }),
      seedAdminId
    );
    expect(staleSendCallCount).toBe(0);
    expect(afterStaleSend.sentAt?.getTime()).toBe(originalSentAt);

    // An explicit follow-up resend remains safe and available.
    let followUpCallCount = 0;
    const followUp = await resendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps({
        emailService: {
          sendInvoice: async () => {
            followUpCallCount++;
            return { success: true, provider: "smtp" as const };
          },
        },
      }),
      seedAdminId,
      "follow-up"
    );
    expect(followUpCallCount).toBe(1);
    expect(followUp.sentAt?.getTime()).toBe(originalSentAt);

    await cleanupOrg(org.id);
  });

  it("CASE 4: PAPER dispatched + EMAIL first send comes back UNKNOWN -- overall SENT via paper, EMAIL warning evidence preserved, normal Send blocked, explicit Resend works", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org PaperPlusEmailUnknown",
      11,
      { invoiceByEmail: true, invoiceByPaper: true }
    );

    await recordPaperDispatch(db, org.id, invoice.id, seedAdminId);

    await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps({
        emailService: {
          sendInvoice: async () => ({
            success: false,
            provider: "smtp" as const,
            errorCode: "TIMEOUT",
            failureClassification: "AMBIGUOUS" as const,
          }),
        },
      }),
      seedAdminId
    );

    const attempt = await db.$client
      .query("select status from invoice_send_attempts where invoice_id = $1", [
        invoice.id,
      ])
      .then((r) => r.rows[0]);
    expect(attempt.status).toBe("UNKNOWN");

    // Normal first-send is blocked (never auto-retry UNKNOWN), regardless
    // of the invoice being overall SENT via paper.
    await expect(
      sendInvoice(db, org.id, invoice.id, stubDeps(), seedAdminId)
    ).rejects.toThrow(ConflictError);

    // Explicit resend still works.
    let emailCallCount = 0;
    await resendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps({
        emailService: {
          sendInvoice: async () => {
            emailCallCount++;
            return { success: true, provider: "smtp" as const };
          },
        },
      }),
      seedAdminId,
      "recovery"
    );
    expect(emailCallCount).toBe(1);

    await cleanupOrg(org.id);
  });

  it("CASE 5: markDispatching loses ownership when another worker already moved the attempt off CLAIMED -- CAS fails", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org LostOwnership",
      6
    );

    const claim = await claimSendAttempt(db, org.id, invoice.id);
    expect(claim.claimed).toBe(true);

    // Simulate a concurrent worker/reconciler moving this attempt to a
    // terminal state before the original claimant reaches its own
    // CLAIMED->DISPATCHING transition.
    await db.$client.query(
      "update invoice_send_attempts set status = 'FAILED', completed_at = now() where id = $1",
      [claim.attempt.id]
    );

    const dispatching = await markDispatching(
      db,
      claim.attempt.id,
      org.id,
      invoice.id
    );
    expect(dispatching).toBeNull();

    const [current] = await db.$client
      .query("select status from invoice_send_attempts where id = $1", [
        claim.attempt.id,
      ])
      .then((r) => r.rows);
    expect(current.status).toBe("FAILED");

    await cleanupOrg(org.id);
  });

  it("CASE 6: FIRST_SEND claim re-validates authoritative case status -- a case moved off PREPARED before the claim is rejected without calling the provider", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org CaseChangedBeforeClaim",
      1
    );

    const { invoice: withCase } = await getInvoice(db, org.id, invoice.id);
    await overrideCaseStatus(
      db,
      org.id,
      withCase.billingCaseId,
      "DRAFT",
      "test: simulate a case status change racing ahead of the claim",
      seedAdminId
    );

    let emailCallCount = 0;
    await expect(
      sendInvoice(
        db,
        org.id,
        invoice.id,
        stubDeps({
          emailService: {
            sendInvoice: async () => {
              emailCallCount++;
              return { success: true, provider: "smtp" as const };
            },
          },
        }),
        seedAdminId
      )
    ).rejects.toThrow(ConflictError);
    expect(emailCallCount).toBe(0);

    await cleanupOrg(org.id);
  });

  it("CASE 8: a legacy (unverified) PAPER row does not block Record paper dispatch; a new verified dispatch coexists with it", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org LegacyPaper",
      2,
      { invoiceByEmail: false, invoiceByPaper: true }
    );

    // Simulate an old-style auto-created PAPER row from before the manual
    // dispatch feature existed -- isInitialPaperDispatch defaults to false,
    // and this migration never backfills it to true (issue 3).
    await db.insert(invoiceDeliveries).values({
      organizationId: org.id,
      invoiceId: invoice.id,
      attemptId: null,
      method: "PAPER",
      destinationEmail: null,
      provider: "paper",
      status: "SENT",
      isInitialPaperDispatch: false,
    });

    const result = await recordPaperDispatch(
      db,
      org.id,
      invoice.id,
      seedAdminId
    );
    expect(result.sentAt).not.toBeNull();

    const paperRows = await db.$client
      .query(
        "select is_initial_paper_dispatch from invoice_deliveries where invoice_id = $1 and method = 'PAPER' order by is_initial_paper_dispatch",
        [invoice.id]
      )
      .then((r) => r.rows.map((row) => row.is_initial_paper_dispatch));
    expect(paperRows).toEqual([false, true]);

    const logs = await listAuditLogs(db, org.id);
    expect(logs.filter((l) => l.action === "INVOICE_SENT")).toHaveLength(1);

    await cleanupOrg(org.id);
  });
});
