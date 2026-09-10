// Phase B (Database) - Bank CSV imports, transactions, and payment matches
// (spec Section 13.16-13.18). Partial payments are out of scope (Section 25).
import {
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { appUsers } from "./auth";
import { invoices } from "./invoices";
import { organizations } from "./organizations";

export const paymentMatchStatusEnum = pgEnum("payment_match_status", [
  "PROPOSED",
  "CONFIRMED",
  "REJECTED",
]);

export const paymentMatchTypeEnum = pgEnum("payment_match_type", [
  "AUTO_EXACT",
  "AUTO_PROBABLE",
  "MANUAL",
]);

export const bankImports = pgTable(
  "bank_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    originalFilename: text("original_filename").notNull(),
    fileSha256: text("file_sha256").notNull(),
    importedByUserId: uuid("imported_by_user_id")
      .notNull()
      .references(() => appUsers.id),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    rowCount: integer("row_count").notNull(),
  },
  (table) => [
    unique("bank_imports_organization_id_file_sha256_key").on(
      table.organizationId,
      table.fileSha256
    ),
    index("bank_imports_organization_id_idx").on(table.organizationId),
  ]
);

export const bankTransactions = pgTable(
  "bank_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    bankImportId: uuid("bank_import_id")
      .notNull()
      .references(() => bankImports.id),
    externalTransactionId: text("external_transaction_id"),
    bookingDate: date("booking_date").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    payerName: text("payer_name"),
    payerAccount: text("payer_account"),
    reference: text("reference"),
    rawData: jsonb("raw_data").notNull(),
    rowNumber: integer("row_number").notNull(),
  },
  (table) => [
    index("bank_transactions_organization_id_idx").on(table.organizationId),
    index("bank_transactions_bank_import_id_idx").on(table.bankImportId),
  ]
);

export const paymentMatches = pgTable(
  "payment_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    bankTransactionId: uuid("bank_transaction_id")
      .notNull()
      .references(() => bankTransactions.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    matchType: paymentMatchTypeEnum("match_type").notNull(),
    status: paymentMatchStatusEnum("status").notNull().default("PROPOSED"),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    confirmedByUserId: uuid("confirmed_by_user_id").references(
      () => appUsers.id
    ),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("payment_matches_bank_transaction_id_invoice_id_key").on(
      table.bankTransactionId,
      table.invoiceId
    ),
    index("payment_matches_organization_id_idx").on(table.organizationId),
    index("payment_matches_invoice_id_idx").on(table.invoiceId),
  ]
);
