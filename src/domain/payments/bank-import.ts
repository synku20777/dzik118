// Phase J (Payments) - bank CSV import (spec Section 25, PAY-001). Mirrors
// src/domain/organizations/csv-import.ts's two-function shape: validate
// (read-only preview) and import (re-validates from raw text, then
// writes) -- "never write immediately on file selection".
import Papa from "papaparse";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import {
  bankImports,
  bankTransactions,
  paymentMatches,
} from "../../db/schema/payments";
import { sha256Hex } from "../../lib/hash";
import { recordAuditEvent } from "../../lib/logging/audit";
import { isUniqueViolation } from "../../lib/db-errors";
import { NotFoundError } from "../errors";
import { proposeExactMatches } from "./matching";

export { NotFoundError };

// The only error importBankCsv/validateBankCsv throw with a message safe
// to show an admin verbatim (no SQL/PII); anything else must be shown as
// a generic message instead.
export class ImportHeaderError extends Error {}

const REQUIRED_HEADERS = ["booking_date", "amount", "currency"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_PATTERN = /^-?\d{1,12}(\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;
export const MAX_CSV_BYTES = 2_000_000;

// DATE_PATTERN only checks shape -- "2026-02-31" would otherwise pass
// preview as OK and then fail Postgres's date parser at insert time,
// rolling back every other, genuinely valid row in the same file.
function isValidCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export type BankTransactionRowStatus = "OK" | "ERROR";

export interface BankTransactionRow {
  rowNumber: number;
  externalTransactionId: string;
  bookingDate: string;
  amount: string;
  currency: string;
  payerName: string;
  payerAccount: string;
  reference: string;
  rawData: Record<string, unknown>;
  status: BankTransactionRowStatus;
  errors: string[];
}

function cell(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value.trim() : "";
}

export interface ValidateBankCsvResult {
  rows: BankTransactionRow[];
  headerError: string | null;
  fileSha256: string;
  isDuplicateFile: boolean;
}

// Parses and validates in one pass; returns rows classified OK/ERROR
// without writing anything (spec Section 25: "never write immediately on
// file selection").
export async function validateBankCsv(
  db: Db,
  organizationId: string,
  csvText: string
): Promise<ValidateBankCsvResult> {
  const csvBytes = new TextEncoder().encode(csvText);
  if (csvBytes.length > MAX_CSV_BYTES) {
    return {
      rows: [],
      fileSha256: "",
      isDuplicateFile: false,
      headerError: `File is too large (max ${MAX_CSV_BYTES / 1_000_000}MB).`,
    };
  }
  const fileSha256 = await sha256Hex(csvBytes);

  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const headers = parsed.meta.fields ?? [];
  const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missingHeaders.length > 0) {
    return {
      rows: [],
      fileSha256,
      isDuplicateFile: false,
      headerError: `Missing required column(s): ${missingHeaders.join(", ")}`,
    };
  }
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    return {
      rows: [],
      fileSha256,
      isDuplicateFile: false,
      headerError: `Could not parse the file (row ${(first.row ?? 0) + 1}: ${first.message}). Check the file is a valid CSV and try again.`,
    };
  }

  const [existingImport] = await db
    .select({ id: bankImports.id })
    .from(bankImports)
    .where(
      and(
        eq(bankImports.organizationId, organizationId),
        eq(bankImports.fileSha256, fileSha256)
      )
    )
    .limit(1);

  const rows: BankTransactionRow[] = parsed.data.map((raw, index) => {
    const errors: string[] = [];
    const bookingDate = cell(raw, "booking_date");
    const amount = cell(raw, "amount");
    const currency = cell(raw, "currency").toUpperCase();

    if (!bookingDate) {
      errors.push("booking_date is required");
    } else if (!DATE_PATTERN.test(bookingDate)) {
      errors.push("booking_date must be YYYY-MM-DD");
    } else if (!isValidCalendarDate(bookingDate)) {
      errors.push("booking_date is not a valid calendar date");
    }
    if (!amount) {
      errors.push("amount is required");
    } else if (!AMOUNT_PATTERN.test(amount)) {
      errors.push("amount must be a plain number with at most 2 decimals");
    }
    if (!currency) {
      errors.push("currency is required");
    } else if (!CURRENCY_PATTERN.test(currency)) {
      errors.push("currency must be a 3-letter code");
    }

    const externalTransactionId = cell(raw, "external_transaction_id");
    const payerName = cell(raw, "payer_name");
    const payerAccount = cell(raw, "payer_account");
    const reference = cell(raw, "reference");

    if (externalTransactionId.length > 100) {
      errors.push("external_transaction_id exceeds 100 characters");
    }
    if (payerName.length > 200) {
      errors.push("payer_name exceeds 200 characters");
    }
    if (payerAccount.length > 50) {
      errors.push("payer_account exceeds 50 characters");
    }
    if (reference.length > 500) {
      errors.push("reference exceeds 500 characters");
    }

    return {
      rowNumber: index + 1,
      externalTransactionId,
      bookingDate,
      amount,
      currency,
      payerName,
      payerAccount,
      reference,
      rawData: raw,
      status: errors.length > 0 ? "ERROR" : "OK",
      errors,
    };
  });

  return {
    rows,
    fileSha256,
    isDuplicateFile: !!existingImport,
    headerError: null,
  };
}

export interface ImportBankCsvResult {
  bankImport: typeof bankImports.$inferSelect;
  imported: number;
  errored: number;
  proposed: number;
  rows: BankTransactionRow[];
}

export async function importBankCsv(
  db: Db,
  organizationId: string,
  originalFilename: string,
  csvText: string,
  actorUserId: string
): Promise<ImportBankCsvResult> {
  const { rows, headerError, fileSha256, isDuplicateFile } =
    await validateBankCsv(db, organizationId, csvText);
  if (headerError) {
    throw new ImportHeaderError(headerError);
  }
  if (isDuplicateFile) {
    throw new ImportHeaderError(
      "This file has already been imported for this organization."
    );
  }

  const okRows = rows.filter((r) => r.status === "OK");

  let bankImport: typeof bankImports.$inferSelect;
  let proposed: number;
  try {
    ({ bankImport, proposed } = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(bankImports)
        .values({
          organizationId,
          originalFilename,
          fileSha256,
          importedByUserId: actorUserId,
          rowCount: okRows.length,
        })
        .returning();

      if (okRows.length > 0) {
        await tx.insert(bankTransactions).values(
          okRows.map((row) => ({
            organizationId,
            bankImportId: inserted.id,
            externalTransactionId: row.externalTransactionId || null,
            bookingDate: row.bookingDate,
            amount: row.amount,
            currency: row.currency,
            payerName: row.payerName || null,
            payerAccount: row.payerAccount || null,
            reference: row.reference || null,
            rawData: row.rawData,
            rowNumber: row.rowNumber,
          }))
        );
      }

      await recordAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: "BANK_IMPORT_CREATED",
        entityType: "bank_import",
        entityId: inserted.id,
        afterData: { originalFilename, rowCount: okRows.length },
      });

      // Matching runs in the same transaction as the persist step -- spec
      // Section 25's "persist -> propose matches" is one action, and a
      // matching failure must roll back the import too, or the file would
      // be permanently stuck "already imported" with no way to retry.
      const { proposed: proposedCount } = await proposeExactMatches(
        tx,
        organizationId,
        inserted.id,
        actorUserId
      );

      return { bankImport: inserted, proposed: proposedCount };
    }));
  } catch (err) {
    // A concurrent import of the exact same file racing past the
    // pre-check above still hits the DB's own UNIQUE (organization_id,
    // file_sha256) constraint (spec Section 25) -- same safe-message
    // conversion as the pre-check.
    if (isUniqueViolation(err)) {
      throw new ImportHeaderError(
        "This file has already been imported for this organization."
      );
    }
    throw err;
  }

  return {
    bankImport,
    imported: okRows.length,
    errored: rows.length - okRows.length,
    proposed,
    rows,
  };
}

export async function listBankImports(db: Db, organizationId: string) {
  return db
    .select()
    .from(bankImports)
    .where(eq(bankImports.organizationId, organizationId))
    .orderBy(bankImports.importedAt);
}

export async function getBankImport(
  db: Db,
  organizationId: string,
  bankImportId: string
) {
  const [bankImport] = await db
    .select()
    .from(bankImports)
    .where(
      and(
        eq(bankImports.id, bankImportId),
        eq(bankImports.organizationId, organizationId)
      )
    )
    .limit(1);
  if (!bankImport) throw new NotFoundError("Bank import not found");
  return bankImport;
}

export async function listTransactionsForImport(
  db: Db,
  organizationId: string,
  bankImportId: string
) {
  return db
    .select({
      id: bankTransactions.id,
      rowNumber: bankTransactions.rowNumber,
      bookingDate: bankTransactions.bookingDate,
      amount: bankTransactions.amount,
      currency: bankTransactions.currency,
      payerName: bankTransactions.payerName,
      payerAccount: bankTransactions.payerAccount,
      reference: bankTransactions.reference,
      matchStatus: paymentMatches.status,
    })
    .from(bankTransactions)
    .leftJoin(
      paymentMatches,
      eq(paymentMatches.bankTransactionId, bankTransactions.id)
    )
    .where(
      and(
        eq(bankTransactions.organizationId, organizationId),
        eq(bankTransactions.bankImportId, bankImportId)
      )
    )
    .orderBy(bankTransactions.rowNumber);
}
