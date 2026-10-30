// Migration Center (ADR 0013). `migration_imports` is the audit record of one
// finished import: which kind, which mapping, how many rows, the totals. It
// holds no file and no cell values. `migration_mappings` remembers a column
// mapping by header fingerprint, so the next month's spreadsheet can reuse it.
import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { appUsers } from "./auth";
import { organizations } from "./organizations";

export const migrationImports = pgTable(
  "migration_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    // DWELLINGS | BALANCES | METERS (a text column so a new kind needs no
    // enum migration).
    kind: text("kind").notNull(),
    sourceFilename: text("source_filename").notNull(),
    // Information only ("this file was imported on ..."); it blocks nothing.
    sourceSha256: text("source_sha256").notNull(),
    // Per column: the field it was mapped to.
    mapping: jsonb("mapping").notNull(),
    // Per column: DICTIONARY | JEV | USER | SAVED.
    mappingSources: jsonb("mapping_sources").notNull(),
    fingerprint: text("fingerprint").notNull(),
    // Opening balances only.
    balanceDate: date("balance_date"),
    rowCount: integer("row_count").notNull(),
    createdCount: integer("created_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    // Reconciliation totals (balances) and notices.
    totals: jsonb("totals"),
    importedByUserId: uuid("imported_by_user_id").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("migration_imports_organization_id_created_at_idx").on(
      table.organizationId,
      table.createdAt
    ),
  ]
);

export const migrationMappings = pgTable(
  "migration_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    kind: text("kind").notNull(),
    fingerprint: text("fingerprint").notNull(),
    // Folded header -> field key (or null). Column names only, no values.
    mapping: jsonb("mapping").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("migration_mappings_organization_id_kind_fingerprint_key").on(
      table.organizationId,
      table.kind,
      table.fingerprint
    ),
  ]
);
