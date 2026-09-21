// Phase L (Automation/audit) - domain-layer integration tests (spec
// Section 32). Requires a real Postgres and a real local Supabase
// Storage/SMTP stack reachable via the env vars below (same setup as
// invoice-delivery.test.ts, since autoSendForOrganization reuses
// bulkSendInvoices/sendInvoice for real).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/client";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import {
  ValidationError,
  createOrganization,
  updateOrganization,
} from "../../src/domain/organizations/organizations";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import { createPeriod, lockPeriod } from "../../src/domain/periods/periods";
import { createRule } from "../../src/domain/billing/rules";
import {
  generateInvoice,
  getInvoice,
  prepareInvoice,
} from "../../src/domain/billing/generation";
import {
  bulkSendInvoices,
  sendInvoice,
  type SendInvoiceDeps,
} from "../../src/domain/billing/sending";
import { createSupabaseAdminClient } from "../../src/lib/supabase/admin";
import type { EmailService } from "../../src/lib/email/service";
import {
  autoGenerateForOrganization,
  autoSendForOrganization,
  runScheduledJobs,
  scanOverdueInvoices,
} from "../../src/domain/automation/scheduler";
import { listAuditLogs } from "../../src/domain/audit/audit-log";

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
    tokenSecret: "it-l-token-secret",
    appBaseUrl: "https://billing.example.test",
    ...overrides,
  };
}

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, "it-l-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

function cleanupOrg(organizationId: string) {
  return cleanupOrganization(db, organizationId);
}

async function setupBillableOrg(name: string, month: number) {
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
      invoiceDueDate: `2026-${String(month).padStart(2, "0")}-28`,
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
      unitPrice: "50.00",
      effectiveFrom: "2025-01-01",
    },
    seedAdminId
  );
  return { org, dwelling, period };
}

describe("updateOrganization validation", () => {
  it("rejects an invalid timezone", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-L Org BadTz", addressLine1: "Addr 1" },
      seedAdminId
    );
    await expect(
      updateOrganization(
        db,
        org.id,
        { timezone: "Not/A_Real_Zone" },
        seedAdminId
      )
    ).rejects.toBeInstanceOf(ValidationError);
    await cleanupOrg(org.id);
  });

  it("rejects enabling auto-send without an auto-send day", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-L Org NoSendDay", addressLine1: "Addr 1" },
      seedAdminId
    );
    await expect(
      updateOrganization(db, org.id, { autoSendEnabled: true }, seedAdminId)
    ).rejects.toBeInstanceOf(ValidationError);

    // Setting the day first, then enabling separately, is fine.
    await updateOrganization(db, org.id, { autoSendDay: 5 }, seedAdminId);
    await expect(
      updateOrganization(db, org.id, { autoSendEnabled: true }, seedAdminId)
    ).resolves.toBeTruthy();

    await cleanupOrg(org.id);
  });
});

describe("scanOverdueInvoices", () => {
  it("marks a SENT, unpaid, past-due case OVERDUE; leaves a not-yet-due one SENT", async () => {
    const { org, dwelling, period } = await setupBillableOrg(
      "IT-L Org Overdue",
      1
    );
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    await prepareInvoice(db, org.id, invoice.id, seedAdminId);
    await sendInvoice(db, org.id, invoice.id, stubDeps(), seedAdminId);

    const notYetDue = await scanOverdueInvoices(db, org.id, "2020-01-01");
    expect(notYetDue.overdue).toBe(0);
    expect((await getInvoice(db, org.id, invoice.id)).caseStatus).toBe("SENT");

    const pastDue = await scanOverdueInvoices(db, org.id, "2099-01-01");
    expect(pastDue.overdue).toBe(1);
    expect((await getInvoice(db, org.id, invoice.id)).caseStatus).toBe(
      "OVERDUE"
    );

    // Idempotent: already-OVERDUE cases aren't SENT anymore, so a rerun
    // finds nothing left to flag.
    const rerun = await scanOverdueInvoices(db, org.id, "2099-01-01");
    expect(rerun.overdue).toBe(0);

    await cleanupOrg(org.id);
  });

  it("does not flag a paid invoice even if its due date has passed", async () => {
    const { org, dwelling, period } = await setupBillableOrg(
      "IT-L Org OverduePaid",
      2
    );
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    await prepareInvoice(db, org.id, invoice.id, seedAdminId);
    await sendInvoice(db, org.id, invoice.id, stubDeps(), seedAdminId);
    await db.$client.query(
      "update invoices set paid_at = now() where id = $1",
      [invoice.id]
    );

    const result = await scanOverdueInvoices(db, org.id, "2099-01-01");
    expect(result.overdue).toBe(0);

    await cleanupOrg(org.id);
  });

  it("does not overwrite a case a concurrent payment already moved off SENT", async () => {
    const { org, dwelling, period } = await setupBillableOrg(
      "IT-L Org OverdueRace",
      9
    );
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    await prepareInvoice(db, org.id, invoice.id, seedAdminId);
    await sendInvoice(db, org.id, invoice.id, stubDeps(), seedAdminId);
    // Simulate a payment confirmation racing the scan: the case moves to
    // PAID (as Phase J's confirmMatch does) without paid_at happening to be
    // set yet, the narrow inconsistent window the update-time guard exists
    // to cover.
    await db.$client.query(
      "update billing_cases set status = 'PAID' where id = (select billing_case_id from invoices where id = $1)",
      [invoice.id]
    );

    const result = await scanOverdueInvoices(db, org.id, "2099-01-01");
    expect(result.overdue).toBe(0);
    expect((await getInvoice(db, org.id, invoice.id)).caseStatus).toBe("PAID");

    await cleanupOrg(org.id);
  });
});

describe("autoGenerateForOrganization", () => {
  it("generates and prepares every eligible case in the current open period", async () => {
    const { org } = await setupBillableOrg("IT-L Org AutoGenerate", 3);

    const result = await autoGenerateForOrganization(db, org.id, seedAdminId);
    expect(result).toEqual({ generated: 1, prepared: 1 });

    const rerun = await autoGenerateForOrganization(db, org.id, seedAdminId);
    expect(rerun).toEqual({ generated: 0, prepared: 0 });

    await cleanupOrg(org.id);
  });

  it("is a no-op when there is no open period", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-L Org NoPeriod", addressLine1: "Addr 1" },
      seedAdminId
    );
    const result = await autoGenerateForOrganization(db, org.id, seedAdminId);
    expect(result).toEqual({ generated: 0, prepared: 0 });
    await cleanupOrg(org.id);
  });
});

describe("autoSendForOrganization", () => {
  it("sends every PREPARED invoice in the current open period", async () => {
    const { org, dwelling, period } = await setupBillableOrg(
      "IT-L Org AutoSend",
      4
    );
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    await prepareInvoice(db, org.id, invoice.id, seedAdminId);

    const result = await autoSendForOrganization(
      db,
      org.id,
      stubDeps(),
      seedAdminId
    );
    expect(result.sent).toBe(1);
    expect(
      (await getInvoice(db, org.id, invoice.id)).invoice.sentAt
    ).not.toBeNull();

    await cleanupOrg(org.id);
  });

  it("sends a PREPARED invoice even in a locked (not the current open) period", async () => {
    const { org, dwelling, period } = await setupBillableOrg(
      "IT-L Org AutoSendLocked",
      7
    );
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    await prepareInvoice(db, org.id, invoice.id, seedAdminId);
    await lockPeriod(db, org.id, period.id, seedAdminId);

    const result = await autoSendForOrganization(
      db,
      org.id,
      stubDeps(),
      seedAdminId
    );
    expect(result.sent).toBe(1);

    await cleanupOrg(org.id);
  });

  it("sends nothing when no invoice is PREPARED", async () => {
    const { org } = await setupBillableOrg("IT-L Org AutoSendNone", 5);
    const result = await autoSendForOrganization(
      db,
      org.id,
      stubDeps(),
      seedAdminId
    );
    expect(result.sent).toBe(0);
    await cleanupOrg(org.id);
  });

  it("Package 4 (2a): running autoSendForOrganization twice against the same PREPARED invoice sends it once and calls email service once", async () => {
    const { org, dwelling, period } = await setupBillableOrg(
      "IT-L Org AutoSendTwice",
      8
    );
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    await prepareInvoice(db, org.id, invoice.id, seedAdminId);

    let emailCallCount = 0;
    const deps = stubDeps({
      emailService: {
        sendInvoice: async () => {
          emailCallCount++;
          return {
            success: true,
            provider: "smtp" as const,
            providerMessageId: "stub-msg-id",
          };
        },
      },
    });

    // First run sends the invoice
    const firstResult = await autoSendForOrganization(
      db,
      org.id,
      deps,
      seedAdminId
    );
    expect(firstResult.sent).toBe(1);
    expect(emailCallCount).toBe(1);

    const invoiceAfterFirst = await getInvoice(db, org.id, invoice.id);
    expect(invoiceAfterFirst.invoice.sentAt).not.toBeNull();
    expect(invoiceAfterFirst.caseStatus).toBe("SENT");

    const attempts = await db.$client
      .query("select status from invoice_send_attempts where invoice_id = $1", [
        invoice.id,
      ])
      .then((r) => r.rows);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("SENT");

    // Second run: case is no longer PREPARED, nothing to send
    const secondResult = await autoSendForOrganization(
      db,
      org.id,
      deps,
      seedAdminId
    );
    expect(secondResult.sent).toBe(0);
    expect(emailCallCount).toBe(1);

    // Furthermore, bulkSendInvoices directly against the already-sent invoice skips it
    // via before.sentAt, maintaining the non-duplicating guarantee under the attempt-table model
    const bulkResult = await bulkSendInvoices(
      db,
      org.id,
      [invoice.id],
      deps,
      seedAdminId
    );
    expect(bulkResult.sent).toHaveLength(0);
    expect(bulkResult.skipped).toEqual([
      { invoiceId: invoice.id, reason: "Already sent" },
    ]);
    expect(emailCallCount).toBe(1);

    await cleanupOrg(org.id);
  });

  it("Package 4 (2b): ambiguous failure leaves invoice PREPARED with UNKNOWN attempt, and second scheduler run skips without recalling provider", async () => {
    const { org, dwelling, period } = await setupBillableOrg(
      "IT-L Org AmbiguousScheduler",
      9
    );
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    await prepareInvoice(db, org.id, invoice.id, seedAdminId);

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

    // First run encounters AMBIGUOUS delivery failure
    const firstResult = await autoSendForOrganization(
      db,
      org.id,
      ambiguousDeps,
      seedAdminId
    );
    expect(firstResult.sent).toBe(0);
    expect(emailCallCount).toBe(1);

    // Invoice remains PREPARED, sentAt is null, attempt recorded as UNKNOWN
    const invoiceAfterFirst = await getInvoice(db, org.id, invoice.id);
    expect(invoiceAfterFirst.caseStatus).toBe("PREPARED");
    expect(invoiceAfterFirst.invoice.sentAt).toBeNull();

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

    // Second run: the invoice is still PREPARED, but the scheduler detects the UNKNOWN attempt
    // and skips it rather than auto-retrying, without calling the email provider again
    const secondResult = await autoSendForOrganization(
      db,
      org.id,
      ambiguousDeps,
      seedAdminId
    );
    expect(secondResult.sent).toBe(0);
    expect(emailCallCount).toBe(1);

    // bulkSendInvoices surfaces the exact safe ConflictError skip reason
    const bulkResult = await bulkSendInvoices(
      db,
      org.id,
      [invoice.id],
      ambiguousDeps,
      seedAdminId
    );
    expect(bulkResult.sent).toHaveLength(0);
    expect(bulkResult.skipped).toHaveLength(1);
    expect(bulkResult.skipped[0].invoiceId).toBe(invoice.id);
    expect(bulkResult.skipped[0].reason).toContain(
      "The previous delivery attempt's outcome could not be confirmed"
    );
    expect(emailCallCount).toBe(1);

    await cleanupOrg(org.id);
  });

  it("Package 2 (11): Scheduler PAPER-only autoSend skips safely with zero provider calls, zero PAPER delivery rows, zero sentAt transitions", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT-L Org PaperOnlySched",
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
        billingEmail: undefined,
        invoiceByEmail: false,
        invoiceByPaper: true,
      },
      seedAdminId
    );
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 7,
        startsOn: "2026-07-01",
        endsOn: "2026-07-28",
        invoiceIssueDate: "2026-07-28",
        invoiceDueDate: "2026-08-14",
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
        vatRate: "21",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    await prepareInvoice(db, org.id, invoice.id, seedAdminId);

    let emailCallCount = 0;
    const deps = stubDeps({
      emailService: {
        sendInvoice: async () => {
          emailCallCount++;
          return { success: true, provider: "smtp" as const };
        },
      },
    });

    const sendResult = await autoSendForOrganization(
      db,
      org.id,
      deps,
      seedAdminId
    );
    expect(sendResult.sent).toBe(0);
    expect(emailCallCount).toBe(0);

    // Zero PAPER delivery rows created
    const deliveries = await db.$client
      .query("select count(*) from invoice_deliveries where invoice_id = $1", [
        invoice.id,
      ])
      .then((r) => Number(r.rows[0].count));
    expect(deliveries).toBe(0);

    // Zero sentAt transitions
    const invoiceAfter = await getInvoice(db, org.id, invoice.id);
    expect(invoiceAfter.invoice.sentAt).toBeNull();
    expect(invoiceAfter.caseStatus).toBe("PREPARED");

    // Surfaces safely in bulkSendInvoices skipped list
    const bulkResult = await bulkSendInvoices(
      db,
      org.id,
      [invoice.id],
      deps,
      seedAdminId
    );
    expect(bulkResult.sent).toHaveLength(0);
    expect(bulkResult.skipped).toHaveLength(1);
    expect(bulkResult.skipped[0].invoiceId).toBe(invoice.id);
    expect(bulkResult.skipped[0].reason).toContain(
      "This dwelling has no electronic delivery method enabled; use Record paper dispatch instead."
    );

    await cleanupOrg(org.id);
  });

  it("Package 2 (12): Scheduler EMAIL+PAPER with no usable email skips safely without paper fabrication", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT-L Org NoEmailSched",
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
        billingEmail: undefined,
        invoiceByEmail: true,
        invoiceByPaper: true,
      },
      seedAdminId
    );
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 8,
        startsOn: "2026-08-01",
        endsOn: "2026-08-28",
        invoiceIssueDate: "2026-08-28",
        invoiceDueDate: "2026-09-14",
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
        vatRate: "21",
        effectiveFrom: "2025-01-01",
      },
      seedAdminId
    );
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    await prepareInvoice(db, org.id, invoice.id, seedAdminId);

    let emailCallCount = 0;
    const deps = stubDeps({
      emailService: {
        sendInvoice: async () => {
          emailCallCount++;
          return { success: true, provider: "smtp" as const };
        },
      },
    });

    const sendResult = await autoSendForOrganization(
      db,
      org.id,
      deps,
      seedAdminId
    );
    expect(sendResult.sent).toBe(0);
    expect(emailCallCount).toBe(0);

    // Zero PAPER delivery rows created
    const paperDeliveries = await db.$client
      .query(
        "select count(*) from invoice_deliveries where invoice_id = $1 and method = 'PAPER'",
        [invoice.id]
      )
      .then((r) => Number(r.rows[0].count));
    expect(paperDeliveries).toBe(0);

    // Zero sentAt transitions
    const invoiceAfter = await getInvoice(db, org.id, invoice.id);
    expect(invoiceAfter.invoice.sentAt).toBeNull();
    expect(invoiceAfter.caseStatus).toBe("PREPARED");

    // Surfaces in bulkSendInvoices skipped list
    const bulkResult = await bulkSendInvoices(
      db,
      org.id,
      [invoice.id],
      deps,
      seedAdminId
    );
    expect(bulkResult.sent).toHaveLength(0);
    expect(bulkResult.skipped).toHaveLength(1);
    expect(bulkResult.skipped[0].invoiceId).toBe(invoice.id);
    // A missing billing email is known before dispatch, so this is now a
    // clean, specific skip reason -- not a generic "Delivery failed" implying
    // the provider was actually contacted.
    expect(bulkResult.skipped[0].reason).toBe(
      "Invoice email is missing. Add a billing email before sending."
    );

    await cleanupOrg(org.id);
  });
});

describe("runScheduledJobs", () => {
  it("only auto-sends on the organization's configured day, and processes organizations independently", async () => {
    const { org: orgA } = await setupBillableOrg("IT-L Org SchedA", 6);
    await updateOrganization(
      db,
      orgA.id,
      { autoGenerateEnabled: true, autoSendEnabled: true, autoSendDay: 15 },
      seedAdminId
    );

    const { org: orgB } = await setupBillableOrg("IT-L Org SchedB", 6);
    // orgB has automation disabled entirely (default flags).

    const notFifteenth = await runScheduledJobs(
      db,
      stubDeps(),
      new Date("2026-06-10T10:00:00Z")
    );
    const orgAResultEarly = notFifteenth.find(
      (r) => r.organizationId === orgA.id
    )!;
    expect(orgAResultEarly.generated).toBe(1);
    expect(orgAResultEarly.prepared).toBe(1);
    expect(orgAResultEarly.sent).toBe(0);
    const orgBResultEarly = notFifteenth.find(
      (r) => r.organizationId === orgB.id
    )!;
    expect(orgBResultEarly.generated).toBe(0);
    expect(orgBResultEarly.sent).toBe(0);

    const onTheDay = await runScheduledJobs(
      db,
      stubDeps(),
      new Date("2026-06-15T10:00:00Z")
    );
    const orgAResultOnDay = onTheDay.find((r) => r.organizationId === orgA.id)!;
    expect(orgAResultOnDay.sent).toBe(1);

    // Scheduled mutations record a null actor (no fabricated system
    // identity -- audit_logs.actor_user_id is nullable for exactly this).
    const logs = await listAuditLogs(db, orgA.id);
    expect(
      logs.some(
        (l) => l.action === "INVOICE_GENERATED" && l.actorEmail === null
      )
    ).toBe(true);

    await cleanupOrg(orgA.id);
    await cleanupOrg(orgB.id);
  });

  it("Package 4 (2b end-to-end): runScheduledJobs gracefully skips UNKNOWN attempt invoice without throwing or recalling provider", async () => {
    const { org, dwelling, period } = await setupBillableOrg(
      "IT-L Org SchedAmbiguous",
      10
    );
    await updateOrganization(
      db,
      org.id,
      { autoSendEnabled: true, autoSendDay: 20 },
      seedAdminId
    );
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    await prepareInvoice(db, org.id, invoice.id, seedAdminId);

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

    // First cron run: encounters ambiguous failure
    const runDate = new Date("2026-10-20T10:00:00Z");
    const firstRun = await runScheduledJobs(db, ambiguousDeps, runDate);
    const orgResult1 = firstRun.find((r) => r.organizationId === org.id)!;
    expect(orgResult1.sent).toBe(0);
    expect(orgResult1.error).toBeUndefined();
    expect(emailCallCount).toBe(1);

    // Second cron run: skips the UNKNOWN attempt without error or calling email provider
    const secondRun = await runScheduledJobs(db, ambiguousDeps, runDate);
    const orgResult2 = secondRun.find((r) => r.organizationId === org.id)!;
    expect(orgResult2.sent).toBe(0);
    expect(orgResult2.error).toBeUndefined();
    expect(emailCallCount).toBe(1);

    await cleanupOrg(org.id);
  });
});
