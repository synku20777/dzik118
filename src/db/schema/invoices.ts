// Phase B (Database) - Invoices, lines, access tokens, deliveries, and the
// per-organization invoice template (spec Section 13.11-13.15).
// Sent invoices are immutable (spec Section 21): financial fields and lines
// are never mutated after sent_at is set, only status/payment/delivery
// metadata may still change. That rule is enforced in the domain layer
// (later phase), not by a DB constraint, since Postgres cannot easily express
// "immutable after column X is set" without triggers this spec doesn't ask for.
import {
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  billingCalculationTypeEnum,
  billingCases,
  billingPeriods,
  billingRules,
} from "./billing";
import { dwellings } from "./dwellings";
import { organizations } from "./organizations";

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    billingCaseId: uuid("billing_case_id")
      .notNull()
      .unique()
      .references(() => billingCases.id),
    dwellingId: uuid("dwelling_id")
      .notNull()
      .references(() => dwellings.id),
    periodId: uuid("period_id")
      .notNull()
      .references(() => billingPeriods.id),
    invoiceNumber: text("invoice_number").notNull(),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull(),
    vatTotal: numeric("vat_total", { precision: 14, scale: 2 }).notNull(),
    total: numeric("total", { precision: 14, scale: 2 }).notNull(),
    issuerSnapshot: jsonb("issuer_snapshot").notNull(),
    recipientSnapshot: jsonb("recipient_snapshot").notNull(),
    paymentSnapshot: jsonb("payment_snapshot").notNull(),
    templateSnapshot: jsonb("template_snapshot").notNull(),
    version: integer("version").notNull().default(1),
    preparedAt: timestamp("prepared_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    pdfObjectKey: text("pdf_object_key"),
    pdfSha256: text("pdf_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("invoices_organization_id_invoice_number_key").on(
      table.organizationId,
      table.invoiceNumber
    ),
    index("invoices_organization_id_idx").on(table.organizationId),
    index("invoices_dwelling_id_idx").on(table.dwellingId),
    index("invoices_period_id_idx").on(table.periodId),
  ]
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    billingRuleId: uuid("billing_rule_id").references(() => billingRules.id),
    sortOrder: integer("sort_order").notNull(),
    description: text("description").notNull(),
    calculationType: billingCalculationTypeEnum("calculation_type").notNull(),
    sourceSnapshot: jsonb("source_snapshot").notNull(),
    unit: text("unit"),
    quantity: numeric("quantity", { precision: 14, scale: 4 }),
    unitPrice: numeric("unit_price", { precision: 14, scale: 4 }),
    vatRate: numeric("vat_rate", { precision: 7, scale: 4 }).notNull(),
    netAmount: numeric("net_amount", { precision: 14, scale: 2 }).notNull(),
    vatAmount: numeric("vat_amount", { precision: 14, scale: 2 }).notNull(),
    grossAmount: numeric("gross_amount", { precision: 14, scale: 2 }).notNull(),
  },
  (table) => [index("invoice_lines_invoice_id_idx").on(table.invoiceId)]
);

// Raw token is never stored, only its hash (spec Section 24).
export const invoiceAccessTokens = pgTable(
  "invoice_access_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("invoice_access_tokens_invoice_id_idx").on(table.invoiceId)]
);

export const invoiceDeliveries = pgTable(
  "invoice_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    destinationEmail: text("destination_email").notNull(),
    provider: text("provider").notNull(),
    providerMessageId: text("provider_message_id"),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("invoice_deliveries_invoice_id_idx").on(table.invoiceId)]
);

export const invoiceTemplates = pgTable("invoice_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .unique()
    .references(() => organizations.id),
  logoObjectKey: text("logo_object_key"),
  headerText: text("header_text"),
  footerText: text("footer_text"),
  paymentInstructions: text("payment_instructions"),
  defaultNote: text("default_note"),
  config: jsonb("config").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
