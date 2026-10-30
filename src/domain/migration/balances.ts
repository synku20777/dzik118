// Opening debt and credit from a mapped spreadsheet (ADR 0013). One audited,
// append-only ledger entry per dwelling, in the organization's currency.
// Validation is read-only; the import re-parses the raw file text and
// re-validates everything inside its own transaction. The database allows one
// migrated opening balance per dwelling (partial unique index), so a second
// run, or two admins at once, cannot post it twice. Corrections are manual
// adjustments, never a second import.
// Callers must call requireActiveOrganization() first.
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import { accountEntries } from "../../db/schema/accounts";
import { billingPeriods } from "../../db/schema/billing";
import { dwellings } from "../../db/schema/dwellings";
import { invoices } from "../../db/schema/invoices";
import { migrationImports, migrationMappings } from "../../db/schema/migration";
import { organizations } from "../../db/schema/organizations";
import {
  compareExact,
  negateExact,
  subtractExact,
  sumExact,
} from "../../lib/decimal2";
import { recordAuditEvent, recordAuditEvents } from "../../lib/logging/audit";
import { sha256Hex } from "../../lib/hash";
import { orgLocalDateString } from "../../lib/org-time";
import { isMigratedOpening } from "../accounts/ledger";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import {
  IMPORT_FIX_ROWS_ERROR,
  ROW_NUMBER_DUPLICATE_ERROR,
  ROW_NUMBER_LENGTH_ERROR,
  ROW_NUMBER_REQUIRED_ERROR,
} from "./dwellings";
import { parseTable } from "./files";
import { cell } from "./limits";
import {
  fingerprintHeaders,
  toSavedMapping,
  validateMapping,
  type MappingSource,
} from "./mapping";
import { detectDecimalSeparator, parseDate, parseDecimal } from "./values";

export const ROW_BALANCE_UNKNOWN_ERROR =
  "This dwelling number does not exist. Import the dwellings first";
export const ROW_BALANCE_ARCHIVED_ERROR = "This dwelling is archived";
export const ROW_BALANCE_AMOUNT_ERROR =
  "The amount must be a number with at most 2 decimals";
export const ROW_BALANCE_SIGN_ERROR =
  "Debt and credit amounts cannot be negative";
export const ROW_BALANCE_DUE_DATE_ERROR =
  "The debt due date is not a valid date";
export const ROW_BALANCE_INVOICED_ERROR =
  "An invoice was already prepared for this dwelling. Fix the balance with an adjustment";
export const ROW_BALANCE_EXISTS_SKIP_MESSAGE =
  "Opening balance already posted. Correct it with an adjustment";
export const ROW_BALANCE_ZERO_SKIP_MESSAGE =
  "The balance is zero. Nothing to post";
export const ROW_BALANCE_EMPTY_SKIP_MESSAGE =
  "The amount is empty. Nothing to post";
export const ROW_BALANCE_CURRENCY_ERROR =
  "The amount is in another currency than the organization's";
export const BALANCE_NO_PERIOD_NOTICE =
  "No billing period exists yet. An invoice issued before the balance date will not show these balances";
export const IMPORT_BALANCE_MAPPING_ERROR =
  "Map the dwelling number and one amount: a balance, or debt and credit";
export const IMPORT_BALANCE_DATE_ERROR =
  "Enter the balance date as a date that is not in the future";
export const IMPORT_BALANCE_AFTER_FIRST_INVOICE_ERROR =
  "The balance date is after the first invoice date. Choose a date on or before it";
export const IMPORT_BALANCE_RACE_ERROR =
  "Some balances were posted by someone else while importing. Check the file again";

// "Positive means the resident owes" is the usual export. Some systems show
// overpayment as positive; the admin picks, and the review shows the result.
export type BalanceSign = "POSITIVE_OWES" | "POSITIVE_CREDIT";

export interface BalanceOptions {
  // YYYY-MM-DD, the day the old system's balances were struck.
  balanceDate: string;
  sign: BalanceSign;
}

export interface MigrationBalanceRow {
  rowNumber: number;
  number: string;
  dwellingId?: string;
  direction: "DEBIT" | "CREDIT" | null;
  // Absolute amount, two decimals. "0.00" for zero rows.
  amount: string;
  dueDate?: string;
  status: "POST" | "SKIP" | "ERROR";
  errors: string[];
  warnings: string[];
  skipReason?: string;
}

export interface BalanceValidation {
  rows: MigrationBalanceRow[];
  counts: { post: number; skip: number; error: number };
  // Sums of the rows that will be posted.
  totals: { debit: string; credit: string };
  // Things to read before importing; they do not block.
  notices: string[];
}

// One signed balance column, or debt and credit columns; not both kinds.
export function hasValidAmountMapping(fields: (string | null)[]): boolean {
  const has = (key: string) => fields.includes(key);
  return has("balance")
    ? !has("debt") && !has("credit")
    : has("debt") || has("credit");
}

// Exactly two decimals, or null: "12", "12.5" and "12.50" are fine, "12.505"
// is not. The ledger column is numeric(14,2): twelve digits before the point.
// Rounding would hide a typo.
function canonicalAmount(value: string): string | null {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  const trimmed = fraction.replace(/0+$/, "");
  if (trimmed.length > 2 || whole.length > 12) return null;
  const cents = trimmed.padEnd(2, "0");
  return `${negative ? "-" : ""}${whole}.${cents}`;
}

// A currency sign or code in the cell must be the organization's currency:
// parseDecimal drops "$" and "£" without a word, and the entry would be posted
// in the organization currency. Bare numbers pass.
const SYMBOL_CURRENCY: Record<string, string> = {
  "€": "EUR",
  $: "USD",
  "£": "GBP",
};
function wrongCurrency(raw: string, currency: string): boolean {
  const symbol = /[€$£]/.exec(raw)?.[0];
  if (symbol && SYMBOL_CURRENCY[symbol] !== currency) return true;
  // A code next to a number ("100 USD"); a word with no digits is just a bad
  // amount and gets that message instead.
  if (!/\d/.test(raw)) return false;
  const code = /\b[A-Za-z]{3,5}\b/.exec(raw)?.[0].toUpperCase();
  if (!code) return false;
  return !(code === currency || (currency === "EUR" && /^EUROS?$/.test(code)));
}

export function parseBalanceDate(input: string): string {
  const parsed = parseDate(input);
  if (!parsed.ok) throw new ValidationError(IMPORT_BALANCE_DATE_ERROR);
  return parsed.value;
}

// The date must be real, not in the future, and not after the invoices that
// should carry the balance: a balance dated after the first billing period's
// issue date would not appear on that invoice.
async function checkBalanceDate(
  db: DbOrTx,
  organizationId: string,
  balanceDate: string,
  timezone: string
): Promise<{ hasFirstPeriod: boolean }> {
  if (balanceDate > orgLocalDateString(new Date(), timezone)) {
    throw new ValidationError(IMPORT_BALANCE_DATE_ERROR);
  }
  const [first] = await db
    .select({ issueDate: billingPeriods.invoiceIssueDate })
    .from(billingPeriods)
    .where(
      and(
        eq(billingPeriods.organizationId, organizationId),
        eq(billingPeriods.openingReadings, false)
      )
    )
    .orderBy(asc(billingPeriods.startsOn))
    .limit(1);
  if (first && balanceDate > first.issueDate) {
    throw new ValidationError(IMPORT_BALANCE_AFTER_FIRST_INVOICE_ERROR);
  }
  return { hasFirstPeriod: Boolean(first) };
}

export async function validateBalances(
  db: DbOrTx,
  organizationId: string,
  table: { headers: string[]; rows: string[][]; delimiter?: string },
  fields: (string | null)[],
  options: BalanceOptions
): Promise<BalanceValidation> {
  const [org] = await db
    .select({
      timezone: organizations.timezone,
      currency: organizations.currency,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) throw new NotFoundError("Organization not found");
  const { hasFirstPeriod } = await checkBalanceDate(
    db,
    organizationId,
    options.balanceDate,
    org.timezone
  );

  const index = new Map<string, number>();
  fields.forEach((f, i) => {
    if (f) index.set(f, i);
  });
  const separators = new Map<string, "," | "." | null>();
  for (const key of ["balance", "debt", "credit"]) {
    if (!index.has(key)) continue;
    separators.set(
      key,
      detectDecimalSeparator(
        table.rows.map((r) => r[index.get(key)!] ?? "").filter(Boolean),
        table.delimiter
      )
    );
  }

  const dwellingRows = await db
    .select({
      id: dwellings.id,
      number: dwellings.number,
      archivedAt: dwellings.archivedAt,
    })
    .from(dwellings)
    .where(eq(dwellings.organizationId, organizationId));
  const byNumber = new Map(dwellingRows.map((d) => [d.number, d]));
  const migrated = new Set(
    (
      await db
        .select({ dwellingId: accountEntries.dwellingId })
        .from(accountEntries)
        .where(
          and(
            eq(accountEntries.organizationId, organizationId),
            sql`${isMigratedOpening}`
          )
        )
    ).map((r) => r.dwellingId)
  );
  const invoiced = new Set(
    (
      await db
        .selectDistinct({ dwellingId: invoices.dwellingId })
        .from(invoices)
        .where(
          and(
            eq(invoices.organizationId, organizationId),
            isNotNull(invoices.preparedAt)
          )
        )
    ).map((r) => r.dwellingId)
  );

  const seen = new Set<string>();
  const rows: MigrationBalanceRow[] = table.rows.map((raw, i) => {
    const get = (key: string) =>
      index.has(key) ? cell({ v: raw[index.get(key)!] }, "v") : "";
    const errors: string[] = [];
    const number = get("number");
    if (number === "") errors.push(ROW_NUMBER_REQUIRED_ERROR);
    else if (number.length > 50) errors.push(ROW_NUMBER_LENGTH_ERROR);
    else if (seen.has(number)) errors.push(ROW_NUMBER_DUPLICATE_ERROR);
    if (number !== "") seen.add(number);

    // A blank cell is no amount, not zero: the row is skipped and listed, so a
    // dwelling is never left out without the admin seeing it.
    let blank = true;
    const amountOf = (key: string): string | null => {
      const raw = get(key);
      if (raw === "") return "0.00";
      blank = false;
      if (wrongCurrency(raw, org.currency)) {
        errors.push(ROW_BALANCE_CURRENCY_ERROR);
        return "0.00";
      }
      const parsed = parseDecimal(raw, separators.get(key) ?? null);
      return parsed.ok ? canonicalAmount(parsed.value) : null;
    };
    // Net amount, positive = the resident owes.
    let net = "0.00";
    if (index.has("balance")) {
      const amount = amountOf("balance");
      if (amount === null) errors.push(ROW_BALANCE_AMOUNT_ERROR);
      else
        net = options.sign === "POSITIVE_CREDIT" ? negateExact(amount) : amount;
    } else {
      const debt = amountOf("debt");
      const credit = amountOf("credit");
      if (debt === null || credit === null) {
        errors.push(ROW_BALANCE_AMOUNT_ERROR);
      } else if (
        compareExact(debt, "0.00") < 0 ||
        compareExact(credit, "0.00") < 0
      ) {
        errors.push(ROW_BALANCE_SIGN_ERROR);
      } else {
        net = subtractExact(debt, credit);
      }
    }

    let dueDate: string | undefined;
    const dueRaw = get("debt_due_date");
    if (dueRaw !== "") {
      const parsed = parseDate(dueRaw);
      if (parsed.ok) dueDate = parsed.value;
      else errors.push(ROW_BALANCE_DUE_DATE_ERROR);
    }

    const dwelling = number !== "" ? byNumber.get(number) : undefined;
    if (number !== "" && !dwelling) errors.push(ROW_BALANCE_UNKNOWN_ERROR);
    if (dwelling?.archivedAt) errors.push(ROW_BALANCE_ARCHIVED_ERROR);

    const sign = compareExact(net, "0.00");
    const direction = sign > 0 ? "DEBIT" : sign < 0 ? "CREDIT" : null;
    const amount = sign < 0 ? negateExact(net) : net;
    let status: MigrationBalanceRow["status"] = "POST";
    let skipReason: string | undefined;
    if (errors.length > 0) {
      status = "ERROR";
    } else if (dwelling && migrated.has(dwelling.id)) {
      status = "SKIP";
      skipReason = ROW_BALANCE_EXISTS_SKIP_MESSAGE;
    } else if (direction === null) {
      status = "SKIP";
      skipReason = blank
        ? ROW_BALANCE_EMPTY_SKIP_MESSAGE
        : ROW_BALANCE_ZERO_SKIP_MESSAGE;
    } else if (dwelling && invoiced.has(dwelling.id)) {
      status = "ERROR";
      errors.push(ROW_BALANCE_INVOICED_ERROR);
    }
    return {
      rowNumber: i + 1,
      number,
      dwellingId: dwelling?.id,
      direction,
      amount,
      dueDate,
      status,
      errors,
      warnings: [],
      skipReason,
    };
  });

  const posting = rows.filter((r) => r.status === "POST");
  const count = (s: MigrationBalanceRow["status"]) =>
    rows.filter((r) => r.status === s).length;
  return {
    rows,
    counts: { post: count("POST"), skip: count("SKIP"), error: count("ERROR") },
    totals: {
      debit: sumExact(
        posting.filter((r) => r.direction === "DEBIT").map((r) => r.amount)
      ),
      credit: sumExact(
        posting.filter((r) => r.direction === "CREDIT").map((r) => r.amount)
      ),
    },
    notices: hasFirstPeriod ? [] : [BALANCE_NO_PERIOD_NOTICE],
  };
}

export interface BalanceImportInput {
  // The raw file text; everything is re-derived from it here, including the
  // hash that is stored with the import.
  text: string;
  filename: string;
  fields: (string | null)[];
  mappingSources: MappingSource[];
  options: BalanceOptions;
}

export interface BalanceImportResult {
  importId: string | null;
  posted: number;
  skipped: number;
}

export async function importBalances(
  db: Db,
  organizationId: string,
  input: BalanceImportInput,
  actorUserId: string
): Promise<BalanceImportResult> {
  const table = parseTable(input.text);
  if (
    validateMapping("BALANCES", table.headers.length, input.fields).length >
      0 ||
    !hasValidAmountMapping(input.fields)
  ) {
    throw new ValidationError(IMPORT_BALANCE_MAPPING_ERROR);
  }
  const fingerprint = await fingerprintHeaders(table.headers);

  const sourceSha256 = await sha256Hex(new TextEncoder().encode(input.text));
  const numberColumn = input.fields.indexOf("number");
  const numbers = [
    ...new Set(
      table.rows
        .map((r) => cell({ v: r[numberColumn] }, "v"))
        .filter((n) => n !== "")
    ),
  ];

  return db.transaction(async (tx) => {
    // prepareInvoice takes the same lock on the dwelling, so an invoice cannot
    // be prepared (and freeze its balance) between the check below and the
    // insert: one of the two waits for the other and then sees its result.
    for (let i = 0; i < numbers.length; i += 500) {
      await tx
        .select({ id: dwellings.id })
        .from(dwellings)
        .where(
          and(
            eq(dwellings.organizationId, organizationId),
            inArray(dwellings.number, numbers.slice(i, i + 500))
          )
        )
        .orderBy(asc(dwellings.id))
        .for("no key update");
    }
    const { rows, counts, totals } = await validateBalances(
      tx,
      organizationId,
      table,
      input.fields,
      input.options
    );
    if (counts.error > 0) throw new ValidationError(IMPORT_FIX_ROWS_ERROR);
    if (counts.post === 0)
      return { importId: null, posted: 0, skipped: counts.skip };

    const [org] = await tx
      .select({ currency: organizations.currency })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    const posting = rows.filter((r) => r.status === "POST");

    const [importRow] = await tx
      .insert(migrationImports)
      .values({
        organizationId,
        kind: "BALANCES",
        sourceFilename: input.filename.slice(0, 200),
        sourceSha256,
        mapping: input.fields,
        mappingSources: input.mappingSources,
        fingerprint,
        balanceDate: input.options.balanceDate,
        rowCount: rows.length,
        createdCount: posting.length,
        updatedCount: 0,
        skippedCount: counts.skip,
        // What the report needs later: the file's totals, the currency they
        // are in, and the rows that were left out and why.
        totals: {
          fileDebit: totals.debit,
          fileCredit: totals.credit,
          sign: input.options.sign,
          currency: org.currency,
          skipped: rows
            .filter((r) => r.status === "SKIP")
            .map((r) => ({
              rowNumber: r.rowNumber,
              number: r.number,
              reason: r.skipReason,
            })),
        },
        importedByUserId: actorUserId,
      })
      .returning({ id: migrationImports.id });

    const entryValues = posting.map((r) => ({
      organizationId,
      dwellingId: r.dwellingId!,
      effectiveDate: input.options.balanceDate,
      type: "OPENING_BALANCE" as const,
      debit: r.direction === "DEBIT" ? r.amount : "0.00",
      credit: r.direction === "CREDIT" ? r.amount : "0.00",
      currency: org.currency,
      description: "Opening balance (migrated)",
      actorUserId,
      metadata: {
        migrationImportId: importRow.id,
        sourceRow: r.rowNumber,
        ...(r.dueDate ? { originalDueDate: r.dueDate } : {}),
      },
      idempotencyKey: `opening-balance:${organizationId}:${r.dwellingId}`,
    }));
    const posted: { id: string; dwellingId: string }[] = [];
    for (let i = 0; i < entryValues.length; i += 500) {
      // Any unique conflict (the key or the one-per-dwelling index) skips the
      // row; a short result means someone posted first, and the whole import
      // rolls back.
      const inserted = await tx
        .insert(accountEntries)
        .values(entryValues.slice(i, i + 500))
        .onConflictDoNothing()
        .returning({
          id: accountEntries.id,
          dwellingId: accountEntries.dwellingId,
        });
      posted.push(...inserted);
    }
    if (posted.length !== posting.length) {
      throw new ConflictError(IMPORT_BALANCE_RACE_ERROR);
    }

    const rowByDwelling = new Map(posting.map((r) => [r.dwellingId!, r]));
    await recordAuditEvents(
      tx,
      posted.map((entry) => {
        const row = rowByDwelling.get(entry.dwellingId)!;
        return {
          organizationId,
          scopeDwellingId: entry.dwellingId,
          actorUserId,
          action: "ACCOUNT_OPENING_BALANCE_POSTED",
          entityType: "account_entry",
          entityId: entry.id,
          afterData: {
            direction: row.direction,
            amount: row.amount,
            balanceDate: input.options.balanceDate,
            migrationImportId: importRow.id,
          },
        };
      })
    );
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "MIGRATION_IMPORT_COMPLETED",
      entityType: "migration_import",
      entityId: importRow.id,
      afterData: {
        kind: "BALANCES",
        posted: posting.length,
        skipped: counts.skip,
        debit: totals.debit,
        credit: totals.credit,
        balanceDate: input.options.balanceDate,
      },
    });

    const saved = toSavedMapping(table.headers, input.fields);
    await tx
      .insert(migrationMappings)
      .values({ organizationId, kind: "BALANCES", fingerprint, mapping: saved })
      .onConflictDoUpdate({
        target: [
          migrationMappings.organizationId,
          migrationMappings.kind,
          migrationMappings.fingerprint,
        ],
        set: { mapping: saved, lastUsedAt: new Date() },
      });

    return {
      importId: importRow.id,
      posted: posting.length,
      skipped: counts.skip,
    };
  });
}

export interface BalanceReport {
  importId: string;
  filename: string;
  balanceDate: string;
  createdAt: Date;
  rowCount: number;
  skipped: number;
  // The currency of the import (the organization's then).
  currency: string;
  // Rows left out, with the reason (an English message).
  skippedLines: { rowNumber: number; number: string; reason: string }[];
  // From the file, taken when the import ran.
  fileDebit: string;
  fileCredit: string;
  // Rebuilt from the ledger entries that carry this import's id.
  ledgerDebit: string;
  ledgerCredit: string;
  matches: boolean;
  lines: {
    number: string;
    direction: "DEBIT" | "CREDIT";
    amount: string;
    // The dwelling's whole ledger balance now (positive = owes).
    balanceNow: string;
  }[];
}

export async function getBalanceReport(
  db: DbOrTx,
  organizationId: string,
  importId: string
): Promise<BalanceReport> {
  const [imp] = await db
    .select()
    .from(migrationImports)
    .where(
      and(
        eq(migrationImports.id, importId),
        eq(migrationImports.organizationId, organizationId),
        eq(migrationImports.kind, "BALANCES")
      )
    )
    .limit(1);
  if (!imp) throw new NotFoundError("Import not found");

  const totals = (imp.totals ?? {}) as {
    fileDebit?: string;
    fileCredit?: string;
    currency?: string;
    skipped?: { rowNumber: number; number: string; reason?: string }[];
  };
  const entries = await db
    .select({
      dwellingId: accountEntries.dwellingId,
      number: dwellings.number,
      debit: accountEntries.debit,
      credit: accountEntries.credit,
      currency: accountEntries.currency,
    })
    .from(accountEntries)
    .innerJoin(dwellings, eq(dwellings.id, accountEntries.dwellingId))
    .where(
      and(
        eq(accountEntries.organizationId, organizationId),
        eq(accountEntries.type, "OPENING_BALANCE"),
        sql`${accountEntries.metadata} ->> 'migrationImportId' = ${importId}`
      )
    )
    .orderBy(asc(dwellings.number));

  // The currency of this import, not whatever the organization uses now.
  const currency = totals.currency ?? entries[0]?.currency ?? "";
  const balances = new Map<string, string>();
  const ids = entries.map((e) => e.dwellingId);
  for (let i = 0; i < ids.length; i += 500) {
    const all = await db
      .select({
        dwellingId: accountEntries.dwellingId,
        debit: accountEntries.debit,
        credit: accountEntries.credit,
      })
      .from(accountEntries)
      .where(
        and(
          eq(accountEntries.organizationId, organizationId),
          eq(accountEntries.currency, currency),
          inArray(accountEntries.dwellingId, ids.slice(i, i + 500))
        )
      );
    for (const row of all) {
      balances.set(
        row.dwellingId,
        sumExact([
          balances.get(row.dwellingId) ?? "0.00",
          subtractExact(row.debit, row.credit),
        ])
      );
    }
  }

  const ledgerDebit = sumExact(entries.map((e) => e.debit));
  const ledgerCredit = sumExact(entries.map((e) => e.credit));
  const fileDebit = totals.fileDebit ?? "0.00";
  const fileCredit = totals.fileCredit ?? "0.00";
  return {
    importId,
    filename: imp.sourceFilename,
    balanceDate: imp.balanceDate ?? "",
    createdAt: imp.createdAt,
    rowCount: imp.rowCount,
    skipped: imp.skippedCount,
    currency,
    skippedLines: (totals.skipped ?? []).map((s) => ({
      rowNumber: s.rowNumber,
      number: s.number,
      reason: s.reason ?? "",
    })),
    fileDebit,
    fileCredit,
    ledgerDebit,
    ledgerCredit,
    matches:
      compareExact(ledgerDebit, fileDebit) === 0 &&
      compareExact(ledgerCredit, fileCredit) === 0,
    lines: entries.map((e) => ({
      number: e.number,
      direction: compareExact(e.debit, "0.00") > 0 ? "DEBIT" : "CREDIT",
      amount: compareExact(e.debit, "0.00") > 0 ? e.debit : e.credit,
      balanceNow: balances.get(e.dwellingId) ?? "0.00",
    })),
  };
}
