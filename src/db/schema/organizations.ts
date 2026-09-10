// Phase B (Database) - Organizations and admin membership (spec Section 13.2-13.3).
import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { appUsers } from "./auth";

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    registrationNumber: text("registration_number"),
    vatNumber: text("vat_number"),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city"),
    postalCode: text("postal_code"),
    countryCode: char("country_code", { length: 2 }).notNull().default("LV"),
    email: text("email"),
    phone: text("phone"),
    bankName: text("bank_name"),
    iban: text("iban"),
    bic: text("bic"),
    currency: char("currency", { length: 3 }).notNull().default("EUR"),
    timezone: text("timezone").notNull().default("Europe/Riga"),
    locale: text("locale").notNull().default("lv"),
    invoicePrefix: text("invoice_prefix").notNull().default("INV"),
    defaultDueDays: integer("default_due_days").notNull().default(14),
    autoGenerateEnabled: boolean("auto_generate_enabled")
      .notNull()
      .default(false),
    autoSendEnabled: boolean("auto_send_enabled").notNull().default(false),
    autoSendDay: smallint("auto_send_day"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "organizations_default_due_days_check",
      sql`${table.defaultDueDays} between 0 and 120`
    ),
    check(
      "organizations_auto_send_day_check",
      sql`${table.autoSendDay} is null or ${table.autoSendDay} between 1 and 28`
    ),
  ]
);

// Only ADMIN users may hold an active organization membership (spec Section 13.3).
export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    // The composite PK above is organization-first; the authorization
    // invariant (spec Section 8) resolves an admin's memberships from the
    // user side on every request, so that lookup needs its own index.
    index("organization_memberships_user_id_idx").on(table.userId),
  ]
);
