// The dwellings page's building view: entrances side by side, each a grid of
// floors and columns, and the slot each dwelling sits in. Purely visual: the
// admin arranges it by hand and nothing in billing reads it.
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { dwellings } from "./dwellings";
import { organizations } from "./organizations";

export const buildingEntrances = pgTable(
  "building_entrances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    // Free text, e.g. "House 1 - A".
    name: text("name").notNull(),
    // Left to right.
    position: integer("position").notNull(),
    floors: integer("floors").notNull(),
    columns: integer("columns").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Referenced by placements' composite FK, so a placement can only point
    // at an entrance of its own organization.
    unique("building_entrances_id_organization_id_key").on(
      table.id,
      table.organizationId
    ),
    index("building_entrances_organization_id_idx").on(table.organizationId),
    check(
      "building_entrances_size_check",
      sql`${table.floors} between 1 and 60 and ${table.columns} between 1 and 24`
    ),
  ]
);

export const dwellingPlacements = pgTable(
  "dwelling_placements",
  {
    dwellingId: uuid("dwelling_id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    entranceId: uuid("entrance_id").notNull(),
    // 0 is the ground floor.
    floor: integer("floor").notNull(),
    // Column, left to right.
    slot: integer("slot").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.dwellingId, table.organizationId],
      foreignColumns: [dwellings.id, dwellings.organizationId],
      name: "dwelling_placements_dwelling_id_organization_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.entranceId, table.organizationId],
      foreignColumns: [buildingEntrances.id, buildingEntrances.organizationId],
      name: "dwelling_placements_entrance_id_organization_id_fk",
    }).onDelete("cascade"),
    // Two dwellings never share a slot.
    unique("dwelling_placements_slot_key").on(
      table.entranceId,
      table.floor,
      table.slot
    ),
    index("dwelling_placements_organization_id_idx").on(table.organizationId),
    check(
      "dwelling_placements_position_check",
      sql`${table.floor} >= 0 and ${table.slot} >= 0`
    ),
  ]
);
