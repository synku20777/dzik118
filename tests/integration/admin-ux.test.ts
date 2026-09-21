// Phase H (Admin UX) - domain-layer integration tests for the workbench's
// read model (sort/search/filter) and bulk actions, and the dashboard
// summary (spec Section 27). Requires a real Postgres reachable via
// DATABASE_URL, and Supabase reachable via SUPABASE_URL/SUPABASE_SECRET_KEY
// for the bulk-send test (same real-infra pattern as
// tests/integration/invoice-delivery.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/client";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import { createOrganization } from "../../src/domain/organizations/organizations";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import { createPeriod } from "../../src/domain/periods/periods";
import { createRule } from "../../src/domain/billing/rules";
import {
  bulkPrepareInvoices,
  generateInvoice,
  prepareInvoice,
} from "../../src/domain/billing/generation";
import {
  bulkSendInvoices,
  type SendInvoiceDeps,
} from "../../src/domain/billing/sending";
import { listCasesForPeriod } from "../../src/domain/periods/cases";
import { getDashboardSummary } from "../../src/domain/periods/dashboard";
import { createSupabaseAdminClient } from "../../src/lib/supabase/admin";
import type { EmailService } from "../../src/lib/email/service";

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

function stubDeps(): SendInvoiceDeps {
  const email: EmailService = {
    sendInvoice: async () => ({ success: true, provider: "smtp" as const }),
  };
  return {
    renderPdf: async () => new TextEncoder().encode("%PDF stub"),
    supabaseAdmin,
    emailService: email,
    tokenSecret: "it-h-token-secret",
    appBaseUrl: "https://billing.example.test",
  };
}

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, "it-h-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

function cleanupOrg(organizationId: string) {
  return cleanupOrganization(db, organizationId);
}

describe("workbench read model", () => {
  it("sorts by status priority then natural dwelling number, and search/statusFilter narrow the list", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-H Org Sort", addressLine1: "Addr 1" },
      seedAdminId
    );
    // Dwelling number -> desired fixture status. "2" and "10" are both
    // DRAFT to prove dwelling-number ordering is numeric, not lexical
    // ("10" sorting before "2" would be the bug this guards against).
    const fixture: Record<string, string> = {
      "1": "MISSING_DATA",
      "2": "DRAFT",
      "10": "DRAFT",
      "3": "PREPARED",
      "4": "OVERDUE",
      "5": "SENT",
      "6": "PAID",
    };
    // Dwellings must exist before the period is created: createPeriod only
    // snapshots a billing_case for dwellings that already exist at that
    // moment.
    const dwellingsByNumber = new Map<
      string,
      Awaited<ReturnType<typeof createDwelling>>
    >();
    for (const number of Object.keys(fixture)) {
      dwellingsByNumber.set(
        number,
        await createDwelling(db, org.id, { number }, seedAdminId)
      );
    }
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 1,
        startsOn: "2026-01-01",
        endsOn: "2026-01-28",
        invoiceIssueDate: "2026-01-28",
        invoiceDueDate: "2026-02-14",
      },
      seedAdminId
    );
    for (const [number, status] of Object.entries(fixture)) {
      const dwelling = dwellingsByNumber.get(number)!;
      await db.$client.query(
        "update billing_cases set status = $1 where organization_id = $2 and period_id = $3 and dwelling_id = $4",
        [status, org.id, period.id, dwelling.id]
      );
    }

    const all = await listCasesForPeriod(db, org.id, period.id);
    expect(all.map((c) => c.dwellingNumber)).toEqual([
      "1",
      "2",
      "10",
      "3",
      "4",
      "5",
      "6",
    ]);

    const filtered = await listCasesForPeriod(db, org.id, period.id, {
      statusFilter: "DRAFT",
    });
    expect(filtered.map((c) => c.dwellingNumber)).toEqual(["2", "10"]);

    const searched = await listCasesForPeriod(db, org.id, period.id, {
      search: "10",
    });
    expect(searched.map((c) => c.dwellingNumber)).toEqual(["10"]);

    await cleanupOrg(org.id);
  });
});

describe("workbench bulk actions", () => {
  it("bulkPrepareInvoices prepares eligible DRAFT invoices and reports why the rest were skipped", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT-H Org BulkPrepare",
        addressLine1: "Addr 1",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000000",
      },
      seedAdminId
    );
    const dwellingA = await createDwelling(
      db,
      org.id,
      { number: "1", occupantName: "Tenant A", billingAddress: "1 Test St" },
      seedAdminId
    );
    const dwellingB = await createDwelling(
      db,
      org.id,
      { number: "2", occupantName: "Tenant B", billingAddress: "2 Test St" },
      seedAdminId
    );
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 2,
        startsOn: "2026-02-01",
        endsOn: "2026-02-28",
        invoiceIssueDate: "2026-02-28",
        invoiceDueDate: "2026-03-14",
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
    const draftInvoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwellingA.id,
      seedAdminId
    );
    const alreadyPreparedInvoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwellingB.id,
      seedAdminId
    );
    await prepareInvoice(db, org.id, alreadyPreparedInvoice.id, seedAdminId);

    const result = await bulkPrepareInvoices(
      db,
      org.id,
      [draftInvoice.id, alreadyPreparedInvoice.id],
      seedAdminId
    );
    expect(result.prepared).toEqual([draftInvoice.id]);
    expect(result.skipped).toEqual([
      {
        invoiceId: alreadyPreparedInvoice.id,
        reason: "Only a DRAFT invoice can be prepared",
      },
    ]);

    await cleanupOrg(org.id);
  });

  it("bulkSendInvoices sends eligible PREPARED invoices and reports why a DRAFT one was skipped", async () => {
    const org = await createOrganization(
      db,
      {
        name: "IT-H Org BulkSend",
        addressLine1: "Addr 1",
        bankName: "Test Bank",
        iban: "LV00TEST0000000000000",
      },
      seedAdminId
    );
    const dwellingA = await createDwelling(
      db,
      org.id,
      {
        number: "1",
        occupantName: "Tenant A",
        billingAddress: "1 Test St",
        billingEmail: "resident@example.com",
      },
      seedAdminId
    );
    const dwellingB = await createDwelling(
      db,
      org.id,
      { number: "2", billingEmail: "resident2@example.com" },
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
    const preparedInvoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwellingA.id,
      seedAdminId
    );
    await prepareInvoice(db, org.id, preparedInvoice.id, seedAdminId);
    const draftInvoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwellingB.id,
      seedAdminId
    );

    const result = await bulkSendInvoices(
      db,
      org.id,
      [preparedInvoice.id, draftInvoice.id],
      stubDeps(),
      seedAdminId
    );
    expect(result.sent).toEqual([preparedInvoice.id]);
    expect(result.skipped).toEqual([
      {
        invoiceId: draftInvoice.id,
        reason: "Cannot send an invoice in DRAFT status",
      },
    ]);

    // Re-running with the now-already-sent invoice included must not
    // double-count it as a fresh send (sendInvoice is idempotent).
    const second = await bulkSendInvoices(
      db,
      org.id,
      [preparedInvoice.id],
      stubDeps(),
      seedAdminId
    );
    expect(second.sent).toEqual([]);
    expect(second.skipped).toEqual([
      { invoiceId: preparedInvoice.id, reason: "Already sent" },
    ]);

    await cleanupOrg(org.id);
  });
});

describe("dashboard summary", () => {
  it("totals financials, sums consumption by meter type, counts case statuses, and lists items needing attention", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-H Org Dashboard", addressLine1: "Addr 1" },
      seedAdminId
    );
    const dwellingA = await createDwelling(
      db,
      org.id,
      { number: "1" },
      seedAdminId
    );
    const dwellingB = await createDwelling(
      db,
      org.id,
      { number: "2" },
      seedAdminId
    );
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 4,
        startsOn: "2026-04-01",
        endsOn: "2026-04-28",
        invoiceIssueDate: "2026-04-28",
        invoiceDueDate: "2026-05-14",
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
    const invoiceA = await generateInvoice(
      db,
      org.id,
      period.id,
      dwellingA.id,
      seedAdminId
    );
    await generateInvoice(db, org.id, period.id, dwellingB.id, seedAdminId);
    await db.$client.query(
      "update invoices set paid_at = now() where id = $1",
      [invoiceA.id]
    );
    await db.$client.query(
      "update billing_cases set status = 'OVERDUE' where organization_id = $1 and period_id = $2 and dwelling_id = $3",
      [org.id, period.id, dwellingB.id]
    );

    const summary = await getDashboardSummary(db, org.id, period.id);
    expect(summary.totalInvoiced).toBe((Number(invoiceA.total) * 2).toFixed(2));
    expect(summary.totalPaid).toBe(invoiceA.total);
    expect(summary.totalOutstanding).toBe(invoiceA.total);
    expect(summary.caseStatusCounts.OVERDUE).toBe(1);
    expect(
      summary.needsAttention.some(
        (a) => a.dwellingId === dwellingB.id && a.status === "OVERDUE"
      )
    ).toBe(true);

    await cleanupOrg(org.id);
  });

  it("excludes invoices whose currency no longer matches the organization's current currency", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-H Org Currency", addressLine1: "Addr 1" },
      seedAdminId
    );
    expect(org.currency).toBe("EUR");
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
        month: 5,
        startsOn: "2026-05-01",
        endsOn: "2026-05-28",
        invoiceIssueDate: "2026-05-28",
        invoiceDueDate: "2026-06-14",
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
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      seedAdminId
    );
    // Simulates an org that changed its currency after this invoice was
    // generated (ORG-002: the live org row can change; already-generated
    // invoices keep the currency they were snapshotted with).
    await db.$client.query(
      "update invoices set currency = 'USD' where id = $1",
      [invoice.id]
    );

    const summary = await getDashboardSummary(db, org.id, period.id);
    expect(summary.totalInvoiced).toBe("0.00");

    await cleanupOrg(org.id);
  });
});
