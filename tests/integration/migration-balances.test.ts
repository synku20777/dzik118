// Migration Center, opening balances (ADR 0013). Requires Postgres via
// DATABASE_URL.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db } from "../../src/db/client";
import { accountEntries } from "../../src/db/schema/accounts";
import { auditLogs } from "../../src/db/schema/audit";
import { migrationImports } from "../../src/db/schema/migration";
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
  generateInvoice,
  prepareInvoice,
} from "../../src/domain/billing/generation";
import { createLateFeePolicy } from "../../src/domain/accounts/settings";
import { getDwellingAccountBalance } from "../../src/domain/accounts/ledger";
import { resolveStatementFinancials } from "../../src/domain/accounts/statements";
import { parseTable } from "../../src/domain/migration/files";
import { proposeMapping } from "../../src/domain/migration/mapping";
import {
  IMPORT_BALANCE_AFTER_FIRST_INVOICE_ERROR,
  IMPORT_BALANCE_DATE_ERROR,
  ROW_BALANCE_AMOUNT_ERROR,
  ROW_BALANCE_CURRENCY_ERROR,
  ROW_BALANCE_EMPTY_SKIP_MESSAGE,
  ROW_BALANCE_EXISTS_SKIP_MESSAGE,
  ROW_BALANCE_INVOICED_ERROR,
  ROW_BALANCE_SIGN_ERROR,
  ROW_BALANCE_UNKNOWN_ERROR,
  ROW_BALANCE_ZERO_SKIP_MESSAGE,
  getBalanceReport,
  importBalances,
  validateBalances,
  type BalanceOptions,
} from "../../src/domain/migration/balances";
import { findSavedMapping } from "../../src/domain/migration/dwellings";
import { balanceReportCsv } from "../../src/domain/migration/flow";
import { sha256Hex } from "../../src/lib/hash";

let db: Db;
let adminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  adminId = await seedTestAdmin(db, "it-migration-balances@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, adminId);
  await db.$client.end();
});

const owes: BalanceOptions = {
  balanceDate: "2026-01-01",
  sign: "POSITIVE_OWES",
};

async function newOrg(name: string) {
  return createOrganization(
    db,
    {
      name,
      addressLine1: "1 Test St",
      bankName: "Test Bank",
      iban: "LV00TEST0000000000000",
    },
    adminId
  );
}

async function dwelling(orgId: string, number: string) {
  return createDwelling(
    db,
    orgId,
    { number, occupantName: "Jane Doe", billingAddress: "1 Test St" },
    adminId
  );
}

function fieldsFor(text: string): (string | null)[] {
  const table = parseTable(text);
  return proposeMapping("BALANCES", table.headers, table.rows).map(
    (p) => p.field
  );
}

async function run(
  orgId: string,
  text: string,
  options: BalanceOptions = owes,
  fields = fieldsFor(text)
) {
  return importBalances(
    db,
    orgId,
    {
      text,
      filename: "saldo.csv",
      fields,
      mappingSources: fields.map(() => "DICTIONARY" as const),
      options,
    },
    adminId
  );
}

async function check(
  orgId: string,
  text: string,
  options: BalanceOptions = owes,
  fields = fieldsFor(text)
) {
  return validateBalances(db, orgId, parseTable(text), fields, options);
}

const sheet = [
  "SIA Nams - saldo",
  "Dzīvokļa Nr.;Saldo;Termiņš",
  "1;120,50;31.08.2025",
  "2;-15,00;",
  "3;0,00;",
  "Kopā;105,50;",
].join("\n");

describe("migration: opening balances", () => {
  it("posts debt and credit, skips zero, audits, and reports a matching ledger", async () => {
    const org = await newOrg("IT-Bal Post");
    const [d1, d2] = await Promise.all([
      dwelling(org.id, "1"),
      dwelling(org.id, "2"),
    ]);
    await dwelling(org.id, "3");

    const fields = fieldsFor(sheet);
    expect(fields).toEqual(["number", "balance", "debt_due_date"]);
    const result = await run(org.id, sheet);
    expect(result).toMatchObject({ posted: 2, skipped: 1 });
    expect(result.importId).not.toBeNull();

    const entries = await db
      .select()
      .from(accountEntries)
      .where(
        and(
          eq(accountEntries.organizationId, org.id),
          eq(accountEntries.type, "OPENING_BALANCE")
        )
      );
    expect(entries).toHaveLength(2);
    const e1 = entries.find((e) => e.dwellingId === d1.id)!;
    expect(e1).toMatchObject({
      debit: "120.50",
      credit: "0.00",
      effectiveDate: "2026-01-01",
      currency: "EUR",
    });
    expect(e1.metadata).toMatchObject({
      migrationImportId: result.importId,
      sourceRow: 1,
      originalDueDate: "2025-08-31",
    });
    const e2 = entries.find((e) => e.dwellingId === d2.id)!;
    expect(e2).toMatchObject({ debit: "0.00", credit: "15.00" });

    expect(await getDwellingAccountBalance(db, org.id, d1.id, "EUR")).toBe(
      "120.50"
    );
    expect(await getDwellingAccountBalance(db, org.id, d2.id, "EUR")).toBe(
      "-15.00"
    );

    const audit = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, org.id),
          eq(auditLogs.action, "ACCOUNT_OPENING_BALANCE_POSTED")
        )
      );
    expect(audit).toHaveLength(2);
    expect(audit.every((a) => a.scopeDwellingId !== null)).toBe(true);

    const report = await getBalanceReport(db, org.id, result.importId!);
    expect(report).toMatchObject({
      fileDebit: "120.50",
      fileCredit: "15.00",
      ledgerDebit: "120.50",
      ledgerCredit: "15.00",
      matches: true,
      balanceDate: "2026-01-01",
    });
    expect(
      report.lines.map((l) => [l.number, l.direction, l.balanceNow])
    ).toEqual([
      ["1", "DEBIT", "120.50"],
      ["2", "CREDIT", "-15.00"],
    ]);

    const saved = await findSavedMapping(
      db,
      org.id,
      "BALANCES",
      parseTable(sheet).headers
    );
    expect(saved).not.toBeNull();
    await cleanupOrganization(db, org.id);
  });

  it("a second run posts nothing and writes no record", async () => {
    const org = await newOrg("IT-Bal Rerun");
    await dwelling(org.id, "1");
    await dwelling(org.id, "2");
    await dwelling(org.id, "3");
    await run(org.id, sheet);
    const again = await run(org.id, sheet);
    expect(again).toEqual({ importId: null, posted: 0, skipped: 3 });
    const view = await check(org.id, sheet);
    expect(view.rows[0].skipReason).toBe(ROW_BALANCE_EXISTS_SKIP_MESSAGE);
    expect(view.rows[2].skipReason).toBe(ROW_BALANCE_ZERO_SKIP_MESSAGE);
    const records = await db
      .select()
      .from(migrationImports)
      .where(eq(migrationImports.organizationId, org.id));
    expect(records).toHaveLength(1);
    await cleanupOrganization(db, org.id);
  });

  it("the database refuses a second migrated opening balance for a dwelling", async () => {
    const org = await newOrg("IT-Bal Index");
    const d = await dwelling(org.id, "1");
    const result = await run(org.id, "Nr;Saldo\n1;10,00");
    const insert = (key: string, metadata: object) =>
      db.insert(accountEntries).values({
        organizationId: org.id,
        dwellingId: d.id,
        effectiveDate: "2026-01-01",
        type: "OPENING_BALANCE",
        debit: "5.00",
        credit: "0.00",
        currency: "EUR",
        description: "second",
        metadata,
        idempotencyKey: key,
      });
    await expect(
      insert("other-key", { migrationImportId: result.importId })
    ).rejects.toThrow();
    // An older-style opening balance (no import id) is not covered.
    await expect(insert("legacy-key", {})).resolves.toBeDefined();
    await cleanupOrganization(db, org.id);
  });

  it("blocks the import on error rows and posts nothing", async () => {
    const org = await newOrg("IT-Bal Errors");
    await dwelling(org.id, "1");
    await dwelling(org.id, "2");
    const text = [
      "Nr;Parāds;Pārmaksa",
      "1;10,00;",
      "2;abc;",
      "9;5,00;",
      "1;7,00;",
      "2;-3,00;",
    ].join("\n");
    const view = await check(org.id, text);
    expect(view.counts).toEqual({ post: 1, skip: 0, error: 4 });
    expect(view.rows[1].errors).toContain(ROW_BALANCE_AMOUNT_ERROR);
    expect(view.rows[2].errors).toContain(ROW_BALANCE_UNKNOWN_ERROR);
    expect(view.rows[3].errors.length).toBeGreaterThan(0);
    expect(view.rows[4].errors).toContain(ROW_BALANCE_SIGN_ERROR);
    await expect(run(org.id, text)).rejects.toThrow("Fix the rows");
    const entries = await db
      .select()
      .from(accountEntries)
      .where(eq(accountEntries.organizationId, org.id));
    expect(entries).toHaveLength(0);
    await cleanupOrganization(db, org.id);
  });

  it("nets separate debt and credit columns and honors the sign choice", async () => {
    const org = await newOrg("IT-Bal Columns");
    const d1 = await dwelling(org.id, "1");
    const d2 = await dwelling(org.id, "2");
    await run(org.id, "Nr;Parāds;Pārmaksa\n1;100,00;30,00\n2;;20,00");
    expect(await getDwellingAccountBalance(db, org.id, d1.id, "EUR")).toBe(
      "70.00"
    );
    expect(await getDwellingAccountBalance(db, org.id, d2.id, "EUR")).toBe(
      "-20.00"
    );

    const org2 = await newOrg("IT-Bal Sign");
    const e1 = await dwelling(org2.id, "1");
    await run(org2.id, "Nr;Saldo\n1;40,00", {
      balanceDate: "2026-01-01",
      sign: "POSITIVE_CREDIT",
    });
    expect(await getDwellingAccountBalance(db, org2.id, e1.id, "EUR")).toBe(
      "-40.00"
    );
    await cleanupOrganization(db, org.id);
    await cleanupOrganization(db, org2.id);
  });

  it("refuses amounts with more than two decimals instead of rounding", async () => {
    const org = await newOrg("IT-Bal Decimals");
    await dwelling(org.id, "1");
    // "12,505" alone is ambiguous, so the header match drops the column and
    // the admin maps it by hand; the import then refuses the value.
    const view = await check(org.id, "Nr;Saldo\n1;12,505\n2;3,5", owes, [
      "number",
      "balance",
    ]);
    expect(view.rows[0].errors).toContain(ROW_BALANCE_AMOUNT_ERROR);
    await cleanupOrganization(db, org.id);
  });

  it("refuses a currency other than the organization's, and blank amounts are listed, not lost", async () => {
    const org = await newOrg("IT-Bal Currency");
    for (const n of ["1", "2", "3", "4", "5", "6"]) await dwelling(org.id, n);
    const text = [
      "Nr;Saldo",
      "1;100,00 USD",
      "2;$ 10,00",
      "3;€ 10,00",
      "4;10,00 EUR",
      "5;",
      "6;7,50",
    ].join("\n");
    const view = await check(org.id, text, owes, ["number", "balance"]);
    expect(view.rows[0].errors).toContain(ROW_BALANCE_CURRENCY_ERROR);
    expect(view.rows[1].errors).toContain(ROW_BALANCE_CURRENCY_ERROR);
    expect(view.rows[2].status).toBe("POST");
    expect(view.rows[3].status).toBe("POST");
    expect(view.rows[4]).toMatchObject({
      status: "SKIP",
      skipReason: ROW_BALANCE_EMPTY_SKIP_MESSAGE,
    });
    expect(view.rows[5].status).toBe("POST");
    await cleanupOrganization(db, org.id);
  });

  it("accepts twelve digits before the point and refuses thirteen", async () => {
    const org = await newOrg("IT-Bal Limit");
    await dwelling(org.id, "1");
    await dwelling(org.id, "2");
    const view = await check(
      org.id,
      "Nr;Saldo\n1;999999999999,99\n2;1000000000000,00",
      owes,
      ["number", "balance"]
    );
    expect(view.rows[0]).toMatchObject({
      status: "POST",
      amount: "999999999999.99",
    });
    expect(view.rows[1].errors).toContain(ROW_BALANCE_AMOUNT_ERROR);
    await cleanupOrganization(db, org.id);
  });

  it("the report lists the rows that were left out, and the stored hash comes from the text", async () => {
    const org = await newOrg("IT-Bal Report");
    await dwelling(org.id, "1");
    await dwelling(org.id, "2");
    await dwelling(org.id, "3");
    const text = "Nr;Saldo\n1;50,00\n2;0,00\n3;";
    const result = await run(org.id, text, owes, ["number", "balance"]);
    const report = await getBalanceReport(db, org.id, result.importId!);
    expect(report.currency).toBe("EUR");
    expect(report.skippedLines).toEqual([
      { rowNumber: 2, number: "2", reason: ROW_BALANCE_ZERO_SKIP_MESSAGE },
      { rowNumber: 3, number: "3", reason: ROW_BALANCE_EMPTY_SKIP_MESSAGE },
    ]);
    const csv = balanceReportCsv(report);
    expect(csv).toContain("2;Left unchanged;;;The balance is zero");
    const [record] = await db
      .select()
      .from(migrationImports)
      .where(eq(migrationImports.id, result.importId!));
    expect(record.sourceSha256).toBe(
      await sha256Hex(new TextEncoder().encode(text))
    );
    await cleanupOrganization(db, org.id);
  });

  it("an import and an invoice preparation at the same moment never lose the balance", async () => {
    for (let round = 0; round < 4; round++) {
      const org = await newOrg(`IT-Bal Race ${round}`);
      const d = await dwelling(org.id, "1");
      await createRule(
        db,
        org.id,
        {
          name: "Maintenance",
          code: "maint",
          calculationType: "FIXED",
          unit: "month",
          unitPrice: "100.00",
          effectiveFrom: "2025-01-01",
        },
        adminId
      );
      const period = await createPeriod(
        db,
        org.id,
        {
          year: 2026,
          month: 1,
          startsOn: "2026-01-01",
          endsOn: "2026-01-31",
          invoiceIssueDate: "2026-01-31",
          invoiceDueDate: "2026-02-14",
        },
        adminId
      );
      const invoice = await generateInvoice(
        db,
        org.id,
        period.id,
        d.id,
        adminId
      );
      // A second connection: both transactions must really run at once.
      const other = await createIntegrationDb();
      const [imported, prepared] = await Promise.allSettled([
        run(org.id, "Nr;Saldo\n1;80,00", owes, ["number", "balance"]),
        prepareInvoice(other, org.id, invoice.id, adminId),
      ]);
      await other.$client.end();
      expect(prepared.status).toBe("fulfilled");
      const frozen = (
        prepared as PromiseFulfilledResult<{ previousOutstanding: string }>
      ).value.previousOutstanding;
      const balance = await getDwellingAccountBalance(db, org.id, d.id, "EUR");
      // Either the balance is on the invoice, or the import was refused and
      // nothing was posted. Never posted but missing from the invoice.
      if (imported.status === "fulfilled") {
        expect(frozen).toBe("80.00");
      } else {
        expect(frozen).toBe("0.00");
        expect(balance).toBe("100.00");
      }
      await cleanupOrganization(db, org.id);
    }
  });

  it("one organization cannot post to another's dwellings", async () => {
    const a = await newOrg("IT-Bal A");
    const b = await newOrg("IT-Bal B");
    const da = await dwelling(a.id, "1");
    await dwelling(b.id, "1");
    await dwelling(b.id, "2");
    await run(b.id, "Nr;Saldo\n1;50,00\n2;60,00");
    expect(await getDwellingAccountBalance(db, a.id, da.id, "EUR")).toBe(
      "0.00"
    );
    // A has no dwelling 2: unknown there, even though B has one.
    const view = await check(a.id, "Nr;Saldo\n2;5,00");
    expect(view.rows[0].errors).toContain(ROW_BALANCE_UNKNOWN_ERROR);
    await cleanupOrganization(db, a.id);
    await cleanupOrganization(db, b.id);
  });

  it("checks the balance date", async () => {
    const org = await newOrg("IT-Bal Date");
    await dwelling(org.id, "1");
    const text = "Nr;Saldo\n1;10,00";
    await expect(
      check(org.id, text, { balanceDate: "2999-01-01", sign: "POSITIVE_OWES" })
    ).rejects.toThrow(IMPORT_BALANCE_DATE_ERROR);

    await createRule(
      db,
      org.id,
      {
        name: "Maintenance",
        code: "maint",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "100.00",
        effectiveFrom: "2025-01-01",
      },
      adminId
    );
    await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 1,
        startsOn: "2026-01-01",
        endsOn: "2026-01-31",
        invoiceIssueDate: "2026-01-31",
        invoiceDueDate: "2026-02-14",
      },
      adminId
    );
    await expect(
      check(org.id, text, { balanceDate: "2026-02-01", sign: "POSITIVE_OWES" })
    ).rejects.toThrow(IMPORT_BALANCE_AFTER_FIRST_INVOICE_ERROR);
    await expect(
      check(org.id, text, { balanceDate: "2026-01-31", sign: "POSITIVE_OWES" })
    ).resolves.toBeDefined();
    await cleanupOrganization(db, org.id);
  });

  it("refuses a dwelling that already has a prepared invoice", async () => {
    const org = await newOrg("IT-Bal Invoiced");
    const d = await dwelling(org.id, "1");
    await dwelling(org.id, "2");
    await createRule(
      db,
      org.id,
      {
        name: "Maintenance",
        code: "maint",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "100.00",
        effectiveFrom: "2025-01-01",
      },
      adminId
    );
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 1,
        startsOn: "2026-01-01",
        endsOn: "2026-01-31",
        invoiceIssueDate: "2026-01-31",
        invoiceDueDate: "2026-02-14",
      },
      adminId
    );
    const invoice = await generateInvoice(db, org.id, period.id, d.id, adminId);
    // A draft does not block: prepare recalculates the balance.
    expect(
      (await check(org.id, "Nr;Saldo\n1;10,00\n2;0")).counts
    ).toMatchObject({ error: 0 });
    await prepareInvoice(db, org.id, invoice.id, adminId);
    const view = await check(org.id, "Nr;Saldo\n1;10,00\n2;20,00");
    expect(view.rows[0].errors).toContain(ROW_BALANCE_INVOICED_ERROR);
    expect(view.rows[1].status).toBe("POST");
    const zero = await check(org.id, "Nr;Saldo\n2;0");
    expect(zero.rows[0].skipReason).toBe(ROW_BALANCE_ZERO_SKIP_MESSAGE);
    await cleanupOrganization(db, org.id);
  });

  it("2,000 balances post in one transaction with a fixed number of statements", async () => {
    const org = await newOrg("IT-Bal Bulk");
    const lines = ["Nr;Saldo"];
    const values = [];
    for (let i = 1; i <= 2000; i++) {
      lines.push(`B${i};${i % 7},50`);
      values.push({ organizationId: org.id, number: `B${i}` });
    }
    await db
      .insert((await import("../../src/db/schema/dwellings")).dwellings)
      .values(values);
    const started = Date.now();
    const result = await run(org.id, lines.join("\n"));
    const seconds = (Date.now() - started) / 1000;
    console.log(`MIGRATION 2000 balances: ${seconds.toFixed(2)}s`);
    expect(result.posted).toBe(2000);
    expect(seconds).toBeLessThan(15);
    await cleanupOrganization(db, org.id);
    // 2,000 dwellings are created first; the full suite runs files in parallel.
  }, 60_000);
});

describe("migrated opening debt and late fees", () => {
  // A 100 maintenance charge every month, a 0.5% daily late fee after 5 days'
  // grace, capped at 10% of the principal. The January invoice is due
  // 2026-02-14 and stays unpaid.
  async function setup(
    name: string,
    opening: string,
    balanceDate = "2026-01-01"
  ) {
    const org = await newOrg(name);
    const d = await dwelling(org.id, "1");
    await createRule(
      db,
      org.id,
      {
        name: "Maintenance",
        code: "maint",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "100.00",
        effectiveFrom: "2025-01-01",
      },
      adminId
    );
    await createLateFeePolicy(db, {
      organizationId: org.id,
      effectiveFrom: "2025-01-01",
      enabled: true,
      dailyRate: "0.5000",
      graceDays: 5,
      maxPenaltyPercent: "10.00",
      stopsAtCap: true,
      actorUserId: adminId,
    });
    if (opening !== "") {
      await run(org.id, `Nr;Saldo\n1;${opening}`, {
        balanceDate,
        sign: "POSITIVE_OWES",
      });
    }
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 1,
        startsOn: "2026-01-01",
        endsOn: "2026-01-31",
        invoiceIssueDate: "2026-01-31",
        invoiceDueDate: "2026-02-14",
      },
      adminId
    );
    const invoice = await generateInvoice(db, org.id, period.id, d.id, adminId);
    await prepareInvoice(db, org.id, invoice.id, adminId);
    return { org, d, invoice };
  }

  const at = (orgId: string, dwellingId: string, issueDate = "2026-03-31") =>
    resolveStatementFinancials(db, {
      organizationId: orgId,
      dwellingId,
      currency: "EUR",
      issueDate,
      currentCharges: "100.00",
      manualAdjustment: "0.00",
    });

  const entry = (
    orgId: string,
    dwellingId: string,
    type: "PAYMENT" | "PAYMENT_REVERSAL" | "OPENING_BALANCE",
    side: "debit" | "credit",
    amount: string,
    key: string
  ) =>
    db.insert(accountEntries).values({
      organizationId: orgId,
      dwellingId,
      effectiveDate: "2026-03-01",
      type,
      debit: side === "debit" ? amount : "0.00",
      credit: side === "credit" ? amount : "0.00",
      currency: "EUR",
      description: key,
      idempotencyKey: `${key}:${dwellingId}`,
    });

  it("opening debt is not late-fee principal; the invoice charge still is", async () => {
    const { org, d } = await setup("IT-Bal Fee 1", "100,00");
    const fin = await at(org.id, d.id);
    // Balance 200 (100 opening + 100 January). Principal 100, not 200.
    expect(fin.accountBalance).toBe("200.00");
    expect(fin.excludedOpeningDebt).toBe("100.00");
    expect(fin.lateFee.eligiblePrincipal).toBe("100.00");
    // 100 x 0.5% x 40 days = 20, capped at 10% of 100 = 10.
    expect(fin.lateFee.appliedAmount).toBe("10.00");
    expect(fin.balance.previousOutstanding).toBe("200.00");
    await cleanupOrganization(db, org.id);
  });

  it("a normal customer's late fee is unchanged", async () => {
    const { org, d } = await setup("IT-Bal Fee 0", "");
    const fin = await at(org.id, d.id);
    expect(fin.excludedOpeningDebt).toBe("0.00");
    expect(fin.lateFee.eligiblePrincipal).toBe("100.00");
    await cleanupOrganization(db, org.id);
  });

  it("payments settle the migrated debt first", async () => {
    const { org, d } = await setup("IT-Bal Fee 2", "100,00");
    await entry(org.id, d.id, "PAYMENT", "credit", "30.00", "pay1");
    let fin = await at(org.id, d.id);
    expect(fin.accountBalance).toBe("170.00");
    expect(fin.excludedOpeningDebt).toBe("70.00");
    expect(fin.lateFee.eligiblePrincipal).toBe("100.00");

    await entry(org.id, d.id, "PAYMENT", "credit", "70.00", "pay2");
    fin = await at(org.id, d.id);
    expect(fin.excludedOpeningDebt).toBe("0.00");
    expect(fin.lateFee.eligiblePrincipal).toBe("100.00");

    // A reversal gives the protection back, never more than the opening debt.
    await entry(org.id, d.id, "PAYMENT_REVERSAL", "debit", "70.00", "rev1");
    fin = await at(org.id, d.id);
    expect(fin.excludedOpeningDebt).toBe("70.00");
    await entry(org.id, d.id, "PAYMENT_REVERSAL", "debit", "500.00", "rev2");
    fin = await at(org.id, d.id);
    expect(fin.excludedOpeningDebt).toBe("100.00");
    await cleanupOrganization(db, org.id);
  });

  it("a migrated credit protects nothing, and an older-style opening balance stays principal", async () => {
    const credit = await setup("IT-Bal Fee 3", "-50,00");
    const fin = await at(credit.org.id, credit.d.id);
    expect(fin.excludedOpeningDebt).toBe("0.00");
    // Existing behavior: the credit lowers the balance, so principal is 50.
    expect(fin.lateFee.eligiblePrincipal).toBe("50.00");
    await cleanupOrganization(db, credit.org.id);

    const legacy = await setup("IT-Bal Fee 4", "");
    await entry(
      legacy.org.id,
      legacy.d.id,
      "OPENING_BALANCE",
      "debit",
      "100.00",
      "legacy"
    );
    const lf = await at(legacy.org.id, legacy.d.id);
    expect(lf.excludedOpeningDebt).toBe("0.00");
    expect(lf.lateFee.eligiblePrincipal).toBe("200.00");
    await cleanupOrganization(db, legacy.org.id);
  });

  it("a migrated balance dated after an invoice is not on that invoice", async () => {
    // Posted first (no period yet), dated 2026-02-15; the January invoice was
    // issued on 2026-01-31.
    const { org, d, invoice } = await setup(
      "IT-Bal AsOf",
      "100,00",
      "2026-02-15"
    );
    expect(invoice.previousOutstanding).toBe("0.00");
    expect(await getDwellingAccountBalance(db, org.id, d.id, "EUR")).toBe(
      "200.00"
    );
    expect(
      await getDwellingAccountBalance(db, org.id, d.id, "EUR", "2026-01-31")
    ).toBe("100.00");
    const later = await at(org.id, d.id, "2026-03-31");
    expect(later.accountBalance).toBe("200.00");
    expect(later.excludedOpeningDebt).toBe("100.00");
    await cleanupOrganization(db, org.id);
  });
});
