import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
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
import { dwellings } from "./dwellings";
import { invoices } from "./invoices";
import { organizations } from "./organizations";
import { bankTransactions } from "./payments";

export const accountEntryTypeEnum = pgEnum("account_entry_type", [
  "OPENING_BALANCE",
  "INVOICE_CHARGE",
  "PAYMENT",
  "LATE_FEE",
  "LATE_FEE_ADJUSTMENT",
  "MANUAL_ADJUSTMENT",
  "CREDIT_CARRY_FORWARD",
  "DEBT_CARRY_FORWARD",
]);

export const paymentAllocationMethodEnum = pgEnum("payment_allocation_method", [
  "EXACT",
  "PARTIAL",
  "OVERPAYMENT",
  "MANUAL",
]);

export const lateFeeStartRuleEnum = pgEnum("late_fee_start_rule", [
  "DAY_AFTER_DUE_DATE",
]);

export const lateFeeAdjustmentReasonEnum = pgEnum(
  "late_fee_adjustment_reason",
  [
    "BANK_PROCESSING_DELAY",
    "BILLING_DISPUTE",
    "METER_ISSUE",
    "AGREEMENT_WITH_RESIDENT",
    "ADMIN_WAIVER",
    "OTHER",
  ]
);

// Append-only journal. UPDATE/DELETE are rejected by a migration trigger;
// corrections are compensating entries with a new idempotency key.
export const accountEntries = pgTable(
  "account_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    dwellingId: uuid("dwelling_id")
      .notNull()
      .references(() => dwellings.id),
    effectiveDate: date("effective_date").notNull(),
    type: accountEntryTypeEnum("type").notNull(),
    debit: numeric("debit", { precision: 14, scale: 2 }).notNull().default("0"),
    credit: numeric("credit", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    currency: char("currency", { length: 3 }).notNull(),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    bankTransactionId: uuid("bank_transaction_id").references(
      () => bankTransactions.id
    ),
    reason: text("reason"),
    description: text("description").notNull(),
    actorUserId: uuid("actor_user_id").references(() => appUsers.id),
    metadata: jsonb("metadata").notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("account_entries_org_dwelling_date_idx").on(
      table.organizationId,
      table.dwellingId,
      table.effectiveDate,
      table.createdAt
    ),
    index("account_entries_invoice_id_idx").on(table.invoiceId),
    index("account_entries_bank_transaction_id_idx").on(
      table.bankTransactionId
    ),
    check(
      "account_entries_single_sided_check",
      sql`(${table.debit} > 0 and ${table.credit} = 0) or (${table.credit} > 0 and ${table.debit} = 0)`
    ),
  ]
);

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    dwellingId: uuid("dwelling_id")
      .notNull()
      .references(() => dwellings.id),
    bankTransactionId: uuid("bank_transaction_id")
      .notNull()
      .references(() => bankTransactions.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    allocatedAmount: numeric("allocated_amount", {
      precision: 14,
      scale: 2,
    }).notNull(),
    allocationDate: timestamp("allocation_date", { withTimezone: true })
      .notNull()
      .defaultNow(),
    method: paymentAllocationMethodEnum("method").notNull(),
    actorUserId: uuid("actor_user_id").references(() => appUsers.id),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("payment_allocations_transaction_invoice_key").on(
      table.bankTransactionId,
      table.invoiceId
    ),
    index("payment_allocations_org_invoice_idx").on(
      table.organizationId,
      table.invoiceId
    ),
    check(
      "payment_allocations_amount_positive_check",
      sql`${table.allocatedAmount} > 0`
    ),
  ]
);

export const lateFeePolicies = pgTable(
  "late_fee_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    effectiveFrom: date("effective_from").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    dailyRate: numeric("daily_rate", { precision: 9, scale: 6 })
      .notNull()
      .default("0"),
    graceDays: integer("grace_days").notNull().default(0),
    startRule: lateFeeStartRuleEnum("start_rule")
      .notNull()
      .default("DAY_AFTER_DUE_DATE"),
    maxPenaltyPercent: numeric("max_penalty_percent", {
      precision: 7,
      scale: 4,
    })
      .notNull()
      .default("0"),
    stopsAtCap: boolean("stops_at_cap").notNull().default(true),
    actorUserId: uuid("actor_user_id").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("late_fee_policies_org_effective_from_key").on(
      table.organizationId,
      table.effectiveFrom
    ),
    index("late_fee_policies_org_effective_from_idx").on(
      table.organizationId,
      table.effectiveFrom.desc()
    ),
    check(
      "late_fee_policies_values_check",
      sql`${table.dailyRate} >= 0 and ${table.graceDays} >= 0 and ${table.maxPenaltyPercent} >= 0`
    ),
  ]
);

export const lateFeeAdjustments = pgTable(
  "late_fee_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    calculatedAmount: numeric("calculated_amount", {
      precision: 14,
      scale: 2,
    }).notNull(),
    priorAppliedAmount: numeric("prior_applied_amount", {
      precision: 14,
      scale: 2,
    }).notNull(),
    newAppliedAmount: numeric("new_applied_amount", {
      precision: 14,
      scale: 2,
    }).notNull(),
    adjustmentAmount: numeric("adjustment_amount", {
      precision: 14,
      scale: 2,
    }).notNull(),
    reason: lateFeeAdjustmentReasonEnum("reason").notNull(),
    note: text("note"),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("late_fee_adjustments_org_invoice_idx").on(
      table.organizationId,
      table.invoiceId,
      table.createdAt.desc()
    ),
    check(
      "late_fee_adjustments_values_check",
      sql`${table.calculatedAmount} >= 0 and ${table.priorAppliedAmount} >= 0 and ${table.newAppliedAmount} >= 0 and ${table.adjustmentAmount} = ${table.newAppliedAmount} - ${table.priorAppliedAmount}`
    ),
    check(
      "late_fee_adjustments_other_note_check",
      sql`${table.reason} <> 'OTHER' or length(trim(coalesce(${table.note}, ''))) > 0`
    ),
  ]
);
