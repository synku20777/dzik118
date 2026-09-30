// Email addresses that must not receive invoices: SES reported a permanent
// bounce or a complaint (ADR 0008). One row per organization and address.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const suppressionReasonEnum = pgEnum("suppression_reason", [
  "BOUNCE",
  "COMPLAINT",
]);

export const suppressedEmails = pgTable(
  "suppressed_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    // Always lowercase, so a lookup by lowercase address matches.
    email: text("email").notNull(),
    reason: suppressionReasonEnum("reason").notNull(),
    // Short provider text such as the bounce sub type. Never a message body.
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("suppressed_emails_organization_id_email_key").on(
      table.organizationId,
      table.email
    ),
    index("suppressed_emails_organization_id_idx").on(table.organizationId),
    check(
      "suppressed_emails_email_lowercase_check",
      sql`${table.email} = lower(${table.email})`
    ),
  ]
);
