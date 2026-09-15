// Phase B (Database) - Dwellings, resident access, and meters (spec Section 13.4-13.6).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { appUsers } from "./auth";
import { organizations } from "./organizations";

export const dwellingTypeEnum = pgEnum("dwelling_type", [
  "APARTMENT",
  "COMMERCIAL_UNIT",
  "PARKING",
  "STORAGE",
  "OTHER",
]);

export const meterTypeEnum = pgEnum("meter_type", [
  "COLD_WATER",
  "HOT_WATER",
  "ELECTRICITY",
  "GAS",
  "HEAT",
  "OTHER",
]);

export const dwellings = pgTable(
  "dwellings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    type: dwellingTypeEnum("type").notNull().default("APARTMENT"),
    number: text("number").notNull(),
    displayName: text("display_name"),
    occupantName: text("occupant_name"),
    billingName: text("billing_name"),
    billingEmail: text("billing_email"),
    billingAddress: text("billing_address"),
    // How this dwelling receives its invoice (spec: admin-configurable per
    // dwelling). Both default true/false respectively so every existing
    // dwelling keeps today's email-only behavior after this column is added.
    invoiceByEmail: boolean("invoice_by_email").notNull().default(true),
    invoiceByPaper: boolean("invoice_by_paper").notNull().default(false),
    areaM2: numeric("area_m2", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    residentCount: integer("resident_count").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("dwellings_organization_id_number_key").on(
      table.organizationId,
      table.number
    ),
    // Referenced by meters' composite FK below, so a meter's organization_id
    // is guaranteed by Postgres (not just app code) to match its dwelling's.
    unique("dwellings_id_organization_id_key").on(
      table.id,
      table.organizationId
    ),
    index("dwellings_organization_id_idx").on(table.organizationId),
    // Defense in depth for the same rule the domain layer enforces
    // (updateInvoiceDeliveryPreferences): a dwelling with neither delivery
    // method selected could never have its invoice marked delivered.
    check(
      "dwellings_invoice_delivery_method_check",
      sql`${table.invoiceByEmail} OR ${table.invoiceByPaper}`
    ),
  ]
);

// A resident may access one or more dwellings; no organization-wide access (spec Section 8).
export const dwellingAccess = pgTable(
  "dwelling_access",
  {
    dwellingId: uuid("dwelling_id")
      .notNull()
      .references(() => dwellings.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.dwellingId, table.userId] }),
    // The composite PK above is dwelling-first; authorization resolves a
    // user's accessible dwellings on every request (spec Section 8/15.3), so
    // that lookup needs its own user-first index.
    index("dwelling_access_user_id_idx").on(table.userId),
  ]
);

export const meters = pgTable(
  "meters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Must equal the owning dwelling's organization_id (spec Section 13.6).
    // Enforced below by a composite FK against dwellings(id, organization_id),
    // not just left as an application-layer invariant.
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    dwellingId: uuid("dwelling_id").notNull(),
    type: meterTypeEnum("type").notNull(),
    serialNumber: text("serial_number"),
    unit: text("unit").notNull(),
    label: text("label"),
    installedAt: date("installed_at"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("meters_organization_id_idx").on(table.organizationId),
    index("meters_dwelling_id_idx").on(table.dwellingId),
    foreignKey({
      columns: [table.dwellingId, table.organizationId],
      foreignColumns: [dwellings.id, dwellings.organizationId],
      name: "meters_dwelling_id_organization_id_fk",
    }),
  ]
);
