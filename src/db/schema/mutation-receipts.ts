import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

// Durable proof that one client create intent maps to one committed domain
// write. Receipt semantics are derived server-side; browser input contributes
// only the opaque client mutation ID.
export const mutationReceipts = pgTable(
  "mutation_receipts",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    clientMutationId: uuid("client_mutation_id").notNull(),
    operation: text("operation").notNull(),
    entityType: text("entity_type").notNull(),
    scopeId: uuid("scope_id"),
    entityId: uuid("entity_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.clientMutationId],
    }),
  ]
);
