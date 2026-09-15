// Phase B (Database) - Periods, readings, tariffs, and the monthly billing_case
// workflow state (spec Section 13.7-13.10). billing_case owns workflow status;
// it is NOT put on invoices, since an invoice does not exist for MISSING_DATA.
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
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
    index("billing_rules_organization_id_idx").on(table.organizationId),
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
