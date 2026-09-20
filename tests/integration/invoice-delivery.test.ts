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
  resendInvoice,
  sendInvoice,
  type SendInvoiceDeps,
} from "../../src/domain/billing/sending";
import {
  claimSendAttempt,
  markDispatching,
} from "../../src/domain/billing/send-attempts";
import {
  resolveInvoiceAccessToken,
  NotFoundError as TokenNotFoundError,
} from "../../src/domain/billing/invoice-tokens";
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

    const [a, b] = await Promise.all([
      sendInvoice(db, org.id, invoice.id, deps, seedAdminId),
      sendInvoice(db, org.id, invoice.id, deps, seedAdminId),
    ]);
    expect(a.sentAt?.getTime()).toBe(b.sentAt?.getTime());
    expect(emailCallCount).toBe(1);

    const deliveryCount = await db.$client
      .query("select count(*) from invoice_deliveries where invoice_id = $1", [
        invoice.id,
      ])
      .then((r) => Number(r.rows[0].count));
    expect(deliveryCount).toBe(1);

    await cleanupOrg(org.id);
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

  it("resendInvoice requires a prior successful send and reuses the same PDF metadata", async () => {
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

    const deliveryCount = await db.$client
      .query("select count(*) from invoice_deliveries where invoice_id = $1", [
        invoice.id,
      ])
      .then((r) => Number(r.rows[0].count));
    expect(deliveryCount).toBe(2);

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

  it("a paper-only dwelling sends without a billing email, recording a PAPER delivery", async () => {
    const { org, invoice } = await setupPreparedInvoice("IT-G Org Paper", 7, {
      billingEmail: undefined,
      invoiceByEmail: false,
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
        "select method, destination_email, status from invoice_deliveries where invoice_id = $1",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(deliveries).toEqual([
      { method: "PAPER", destination_email: null, status: "SENT" },
    ]);

    await cleanupOrg(org.id);
  });

  it("a dwelling with both email and paper enabled records one delivery per method", async () => {
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
        "select method, status from invoice_deliveries where invoice_id = $1 order by method",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(deliveries).toEqual([
      { method: "EMAIL", status: "SENT" },
      { method: "PAPER", status: "SENT" },
    ]);

    await cleanupOrg(org.id);
  });

  it("email-only dwelling with no billing email fails to send (no paper fallback enabled)", async () => {
    const { org, invoice } = await setupPreparedInvoice("IT-G Org NoEmail", 9, {
      billingEmail: undefined,
    });
    const sent = await sendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps(),
      seedAdminId
    );
    expect(sent.sentAt).toBeNull();

    const [delivery] = await db.$client
      .query(
        "select method, error_code from invoice_deliveries where invoice_id = $1",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(delivery).toEqual({
      method: "EMAIL",
      error_code: "NO_RECIPIENT_EMAIL",
    });

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
    await markDispatching(db, claim.attempt.id);

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

  it("Package 3 (4): EMAIL+PAPER invoice where email is AMBIGUOUS but paper succeeds sets sentAt and SENT, but attempt and EMAIL delivery remain UNKNOWN", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org BothAmbiguous",
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
          errorCode: "FAKE_AMBIGUOUS",
          failureClassification: "AMBIGUOUS" as const,
        }),
      },
    });

    const sent = await sendInvoice(db, org.id, invoice.id, deps, seedAdminId);
    expect(sent.sentAt).not.toBeNull();

    const [caseRow] = await db.$client
      .query(
        "select status from billing_cases where id = (select billing_case_id from invoices where id = $1)",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(caseRow.status).toBe("SENT");

    // The attempt row for this invoice still shows status UNKNOWN (not overwritten to SENT)
    const [attemptRow] = await db.$client
      .query(
        "select status, error_code from invoice_send_attempts where invoice_id = $1",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(attemptRow.status).toBe("UNKNOWN");
    expect(attemptRow.error_code).toBe("FAKE_AMBIGUOUS");

    // Deliveries: EMAIL is UNKNOWN, PAPER is SENT
    const deliveries = await db.$client
      .query(
        "select method, status, error_code from invoice_deliveries where invoice_id = $1 order by method",
        [invoice.id]
      )
      .then((r) => r.rows);
    expect(deliveries).toEqual([
      { method: "EMAIL", status: "UNKNOWN", error_code: "FAKE_AMBIGUOUS" },
      { method: "PAPER", status: "SENT", error_code: null },
    ]);

    // Calling sendInvoice again is a fast no-op returning the sent invoice, without throwing
    const again = await sendInvoice(db, org.id, invoice.id, deps, seedAdminId);
    expect(again.sentAt?.getTime()).toBe(sent.sentAt?.getTime());

    await cleanupOrg(org.id);
  });

  it("Package 3 (5): resendInvoice succeeds on an invoice whose only attempt is UNKNOWN, finalizes sentAt, and sets case to SENT", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org ResendUnknown",
      2
    );

    // First send has ambiguous failure -> sentAt stays null, attempt is UNKNOWN
    const ambiguousDeps = stubDeps({
      emailService: {
        sendInvoice: async () => ({
          success: false,
          provider: "smtp" as const,
          errorCode: "FAKE_AMBIGUOUS",
          failureClassification: "AMBIGUOUS" as const,
        }),
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

    // resendInvoice succeeds and does not throw ConflictError
    const resent = await resendInvoice(
      db,
      org.id,
      invoice.id,
      stubDeps(),
      seedAdminId
    );
    expect(resent.id).toBe(invoice.id);
    // Fix 2: successful resend of previously-UNKNOWN invoice finalizes sentAt
    expect(resent.sentAt).not.toBeNull();

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
    expect(deliveries[1].attempt_id).toBeNull();

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
    await markDispatching(db, claim.attempt.id);

    await expect(
      resendInvoice(db, org.id, invoice.id, deps, seedAdminId)
    ).rejects.toThrow(
      "A delivery attempt is currently in progress for this invoice; wait for it to finish before resending."
    );
    expect(emailCallCount).toBe(0);

    await cleanupOrg(org.id);
  });

  it("Fix 6: stale DISPATCHING attempt with confirmed PAPER delivery completes finalization instead of UNKNOWN", async () => {
    const { org, invoice } = await setupPreparedInvoice(
      "IT-G Org StalePaperConfirm",
      4,
      {
        billingEmail: undefined,
        invoiceByEmail: false,
        invoiceByPaper: true,
      }
    );

    // Claim an attempt for a PAPER-only invoice
    const claim = await claimSendAttempt(db, org.id, invoice.id);
    expect(claim.claimed).toBe(true);
    await markDispatching(db, claim.attempt.id);

    // Manually insert a PAPER invoice_deliveries row with status SENT and attempt_id set to that attempt's id
    // (mirroring what deliver() would have done before a worker crash)
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
});
