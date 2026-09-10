// Phase B (Database) - Application identity. Supabase owns auth.users;
// app_users.id must equal the corresponding auth.users.id (spec Section 12).
import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["ADMIN", "RESIDENT"]);

export const appUsers = pgTable("app_users", {
  // Not defaultRandom(): this id is assigned at provisioning time to match
  // the Supabase auth.users.id it mirrors (Phase C), never generated here.
  id: uuid("id").primaryKey(),
  role: userRoleEnum("role").notNull(),
  emailSnapshot: text("email_snapshot").notNull(),
  displayName: text("display_name"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
