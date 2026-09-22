// Phase B (Database) - Periods, readings, tariffs, and the monthly billing_case
// workflow state (spec Section 13.7-13.10). billing_case owns workflow status;
// it is NOT put on invoices, since an invoice does not exist for MISSING_DATA.
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { appUsers } from "./auth";
import { dwellings, meterTypeEnum, meters } from "./dwellings";
import { organizations } from "./organizations";

export const periodStatusEnum = pgEnum("period_status", ["OPEN", "LOCKED"]);
export const readingSourceEnum = pgEnum("reading_source", [
  "ADMIN",
  "RESIDENT",
  "IMPORT",
]);

export const billingCaseStatusEnum = pgEnum("billing_case_status", [
  "MISSING_DATA",
  "READY",
  "DRAFT",
  "PREPARED",
  "SENT",
  "PAID",
  "OVERDUE",
]);

export const billingCalculationTypeEnum = pgEnum("billing_calculation_type", [
  "FIXED",
  "AREA",
  "RESIDENT_COUNT",
  "METER_CONSUMPTION",
  "MANUAL_QUANTITY",
  "MANUAL_AMOUNT",
]);

// ONE_TO_ALL: implicit for every current and future dwelling in the
// organization, no billing_rule_assignments rows involved at all.
// ONE_TO_MANY: applies only to dwellings with a billing_rule_assignments
// row; a dwelling created after the rule is never auto-included.
// ONE_TO_ONE: exactly one billing_rule_assignments row must exist at all
// times -- enforced in the domain layer (updateRule's transaction), not by
// a DB constraint, matching this codebase's existing convention of
// enforcing cross-row invariants in the domain layer (see invoices.ts).
export const billingRuleScopeEnum = pgEnum("billing_rule_scope", [
  "ONE_TO_ALL",
  "ONE_TO_MANY",
  "ONE_TO_ONE",
]);

export const billingPeriods = pgTable(
  "billing_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    year: integer("year").notNull(),
    month: smallint("month").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    readingDeadline: date("reading_deadline"),
    invoiceIssueDate: date("invoice_issue_date").notNull(),
    invoiceDueDate: date("invoice_due_date").notNull(),
    status: periodStatusEnum("status").notNull().default("OPEN"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("billing_periods_organization_id_year_month_key").on(
      table.organizationId,
      table.year,
      table.month
    ),
    index("billing_periods_organization_id_idx").on(table.organizationId),
  ]
);

export const meterReadings = pgTable(
  "meter_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    periodId: uuid("period_id")
      .notNull()
      .references(() => billingPeriods.id),
    meterId: uuid("meter_id")
      .notNull()
      .references(() => meters.id),
    previousValue: numeric("previous_value", { precision: 14, scale: 3 }),
    currentValue: numeric("current_value", {
      precision: 14,
      scale: 3,
    }).notNull(),
    consumption: numeric("consumption", { precision: 14, scale: 3 }).notNull(),
    source: readingSourceEnum("source").notNull(),
    submittedByUserId: uuid("submitted_by_user_id").references(
      () => appUsers.id
    ),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    note: text("note"),
  },
  (table) => [
    unique("meter_readings_period_id_meter_id_key").on(
      table.periodId,
      table.meterId
    ),
    index("meter_readings_organization_id_idx").on(table.organizationId),
    index("meter_readings_period_id_idx").on(table.periodId),
  ]
);

export const billingRules = pgTable(
  "billing_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    // "name" is the Latvian canonical tariff label (required); nameEn/nameRu are optional translated invoice labels, nullable meaning "no translation yet, fall back to the Latvian name at render time."
    nameEn: text("name_en"),
    nameRu: text("name_ru"),
    code: text("code").notNull(),
    description: text("description"),
    calculationType: billingCalculationTypeEnum("calculation_type").notNull(),
    meterType: meterTypeEnum("meter_type"),
    unit: text("unit").notNull(),
    unitPrice: numeric("unit_price", { precision: 14, scale: 4 }),
    vatRate: numeric("vat_rate", { precision: 7, scale: 4 })
      .notNull()
      .default("0"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveUntil: date("effective_until"),
    applicationScope: billingRuleScopeEnum("application_scope")
      .notNull()
      .default("ONE_TO_ALL"),
    sortOrder: integer("sort_order").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("billing_rules_organization_id_code_key").on(
      table.organizationId,
      table.code
    ),
    // Referenced by billing_rule_assignments' composite FK below, same
    // pattern as dwellings_id_organization_id_key.
    unique("billing_rules_id_organization_id_key").on(
      table.id,
      table.organizationId
    ),
    index("billing_rules_organization_id_idx").on(table.organizationId),
  ]
);

// Explicit dwelling participation for ONE_TO_MANY/ONE_TO_ONE rules. Never
// consulted for ONE_TO_ALL rules (those apply to every dwelling with no
// rows here at all). A ONE_TO_ONE rule must have exactly one row at all
// times -- see billingRuleScopeEnum's comment.
export const billingRuleAssignments = pgTable(
  "billing_rule_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    billingRuleId: uuid("billing_rule_id")
      .notNull()
      .references(() => billingRules.id),
    dwellingId: uuid("dwelling_id")
      .notNull()
      .references(() => dwellings.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("billing_rule_assignments_rule_id_dwelling_id_key").on(
      table.billingRuleId,
      table.dwellingId
    ),
    index("billing_rule_assignments_organization_id_idx").on(
      table.organizationId
    ),
    index("billing_rule_assignments_dwelling_id_idx").on(table.dwellingId),
    foreignKey({
      columns: [table.billingRuleId, table.organizationId],
      foreignColumns: [billingRules.id, billingRules.organizationId],
      name: "billing_rule_assignments_billing_rule_id_organization_id_fk",
    }),
    foreignKey({
      columns: [table.dwellingId, table.organizationId],
      foreignColumns: [dwellings.id, dwellings.organizationId],
      name: "billing_rule_assignments_dwelling_id_organization_id_fk",
    }),
  ]
);

// One admin-supplied value per (period, dwelling, rule) for the two
// calculation types that can't be derived from anything else stored in the
// system -- MANUAL_QUANTITY (a quantity, priced by the rule's unit_price
// same as any other type) and MANUAL_AMOUNT (the value IS the line's net
// amount; generation.ts treats it as quantity=1 x unitPrice=value). Mirrors
// meter_readings' shape: one row per input per period, admin backfillable,
// read at generation time, tracked as missing data until filled in.
export const manualRuleInputs = pgTable(
  "manual_rule_inputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    periodId: uuid("period_id")
      .notNull()
      .references(() => billingPeriods.id),
    dwellingId: uuid("dwelling_id")
      .notNull()
      .references(() => dwellings.id),
    billingRuleId: uuid("billing_rule_id")
      .notNull()
      .references(() => billingRules.id),
    value: numeric("value", { precision: 14, scale: 4 }).notNull(),
    submittedByUserId: uuid("submitted_by_user_id").references(
      () => appUsers.id
    ),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    note: text("note"),
  },
  (table) => [
    unique("manual_rule_inputs_period_id_dwelling_id_billing_rule_id_key").on(
      table.periodId,
      table.dwellingId,
      table.billingRuleId
    ),
    index("manual_rule_inputs_organization_id_idx").on(table.organizationId),
    index("manual_rule_inputs_period_id_idx").on(table.periodId),
  ]
);

// One billing_case per (period, dwelling); owns the monthly workflow status
// independent of whether an invoice has been generated yet.
export const billingCases = pgTable(
  "billing_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    periodId: uuid("period_id")
      .notNull()
      .references(() => billingPeriods.id),
    dwellingId: uuid("dwelling_id")
      .notNull()
      .references(() => dwellings.id),
    status: billingCaseStatusEnum("status").notNull().default("MISSING_DATA"),
    missingData: jsonb("missing_data")
      .notNull()
      .default(sql`'[]'::jsonb`),
    manualStatusOverride: boolean("manual_status_override")
      .notNull()
      .default(false),
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("billing_cases_period_id_dwelling_id_key").on(
      table.periodId,
      table.dwellingId
    ),
    // Tenant-first composite: the workbench/dashboard queries filter by
    // organization_id first, then status (spec Section 27) -- a standalone
    // status index would mix rows across every tenant and rarely get used.
    index("billing_cases_organization_id_status_idx").on(
      table.organizationId,
      table.status
    ),
  ]
);
