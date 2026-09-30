// Phase B (Database) - Resident/admin conversations (spec Section 13.19).
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { appUsers, userRoleEnum } from "./auth";
import { dwellings } from "./dwellings";
import { organizations } from "./organizations";

export const conversationStatusEnum = pgEnum("conversation_status", [
  "NEW",
  "OPEN",
  "RESOLVED",
]);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    dwellingId: uuid("dwelling_id")
      .notNull()
      .references(() => dwellings.id),
    subject: text("subject").notNull(),
    status: conversationStatusEnum("status").notNull().default("NEW"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("conversations_organization_id_idx").on(table.organizationId),
    index("conversations_dwelling_id_idx").on(table.dwellingId),
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    senderUserId: uuid("sender_user_id")
      .notNull()
      .references(() => appUsers.id),
    // Which capability the sender acted through when sending THIS message
    // -- stamped explicitly at insert time by the caller, never derived
    // from the sender's current app_users.role (a person can hold both
    // capabilities, and which one they used can differ message to message;
    // see domain/messaging/conversations.ts).
    senderRole: userRoleEnum("sender_role").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [index("messages_conversation_id_idx").on(table.conversationId)]
);
