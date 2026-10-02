ALTER TABLE "audit_logs" ADD COLUMN "scope_dwelling_id" uuid;--> statement-breakpoint
CREATE INDEX "audit_logs_organization_id_scope_dwelling_id_created_at_idx" ON "audit_logs" USING btree ("organization_id","scope_dwelling_id","created_at" DESC NULLS LAST);--> statement-breakpoint
UPDATE "audit_logs"
SET "scope_dwelling_id" = "dwellings"."id"
FROM "dwellings"
WHERE "audit_logs"."entity_type" = 'dwelling'
  AND "audit_logs"."entity_id" = "dwellings"."id"
  AND "audit_logs"."organization_id" = "dwellings"."organization_id"
  AND "audit_logs"."scope_dwelling_id" IS NULL;--> statement-breakpoint
UPDATE "audit_logs"
SET "scope_dwelling_id" = "meters"."dwelling_id"
FROM "meters"
WHERE "audit_logs"."entity_type" = 'meter'
  AND "audit_logs"."entity_id" = "meters"."id"
  AND "audit_logs"."organization_id" = "meters"."organization_id"
  AND "audit_logs"."scope_dwelling_id" IS NULL;--> statement-breakpoint
UPDATE "audit_logs"
SET "scope_dwelling_id" = "meters"."dwelling_id"
FROM "meter_readings"
JOIN "meters" ON "meters"."id" = "meter_readings"."meter_id"
  AND "meters"."organization_id" = "meter_readings"."organization_id"
WHERE "audit_logs"."entity_type" = 'meter_reading'
  AND "audit_logs"."entity_id" = "meter_readings"."id"
  AND "audit_logs"."organization_id" = "meter_readings"."organization_id"
  AND "audit_logs"."scope_dwelling_id" IS NULL;--> statement-breakpoint
UPDATE "audit_logs"
SET "scope_dwelling_id" = "invoices"."dwelling_id"
FROM "invoices"
WHERE "audit_logs"."entity_type" = 'invoice'
  AND "audit_logs"."entity_id" = "invoices"."id"
  AND "audit_logs"."organization_id" = "invoices"."organization_id"
  AND "audit_logs"."scope_dwelling_id" IS NULL;--> statement-breakpoint
UPDATE "audit_logs"
SET "scope_dwelling_id" = "billing_cases"."dwelling_id"
FROM "billing_cases"
WHERE "audit_logs"."entity_type" = 'billing_case'
  AND "audit_logs"."entity_id" = "billing_cases"."id"
  AND "audit_logs"."organization_id" = "billing_cases"."organization_id"
  AND "audit_logs"."scope_dwelling_id" IS NULL;--> statement-breakpoint
UPDATE "audit_logs"
SET "scope_dwelling_id" = "invoices"."dwelling_id"
FROM "payment_matches"
JOIN "invoices" ON "invoices"."id" = "payment_matches"."invoice_id"
  AND "invoices"."organization_id" = "payment_matches"."organization_id"
WHERE "audit_logs"."entity_type" = 'payment_match'
  AND "audit_logs"."entity_id" = "payment_matches"."id"
  AND "audit_logs"."organization_id" = "payment_matches"."organization_id"
  AND "audit_logs"."scope_dwelling_id" IS NULL;--> statement-breakpoint
UPDATE "audit_logs"
SET "scope_dwelling_id" = "invoices"."dwelling_id"
FROM "invoices"
WHERE "audit_logs"."entity_type" = 'bank_transaction'
  AND "audit_logs"."action" = 'MANUAL_PAYMENT_RECORDED'
  AND "audit_logs"."after_data"->>'invoiceId' = "invoices"."id"::text
  AND "audit_logs"."organization_id" = "invoices"."organization_id"
  AND "audit_logs"."scope_dwelling_id" IS NULL;--> statement-breakpoint
UPDATE "audit_logs"
SET "scope_dwelling_id" = "account_entries"."dwelling_id"
FROM "account_entries"
WHERE "audit_logs"."entity_type" = 'account_entry'
  AND "audit_logs"."entity_id" = "account_entries"."id"
  AND "audit_logs"."organization_id" = "account_entries"."organization_id"
  AND "audit_logs"."scope_dwelling_id" IS NULL;--> statement-breakpoint
UPDATE "audit_logs"
SET "scope_dwelling_id" = "credits"."dwelling_id"::uuid
FROM (
  SELECT "organization_id", "bank_transaction_id", min("dwelling_id"::text) AS "dwelling_id"
  FROM "account_entries"
  WHERE "type" = 'PAYMENT'
  GROUP BY "organization_id", "bank_transaction_id"
  HAVING count(DISTINCT "dwelling_id") = 1
) AS "credits"
WHERE "audit_logs"."entity_type" = 'account_entry'
  AND "audit_logs"."action" = 'ACCOUNT_CREDIT_CREATED'
  AND "audit_logs"."scope_dwelling_id" IS NULL
  AND "audit_logs"."after_data"->>'bankTransactionId' = "credits"."bank_transaction_id"::text
  AND "audit_logs"."organization_id" = "credits"."organization_id";--> statement-breakpoint
UPDATE "audit_logs"
SET "scope_dwelling_id" = "conversations"."dwelling_id"
FROM "conversations"
WHERE "audit_logs"."entity_type" = 'conversation'
  AND "audit_logs"."entity_id" = "conversations"."id"
  AND "audit_logs"."organization_id" = "conversations"."organization_id"
  AND "audit_logs"."scope_dwelling_id" IS NULL;--> statement-breakpoint
UPDATE "audit_logs"
SET "scope_dwelling_id" = "conversations"."dwelling_id"
FROM "messages"
JOIN "conversations" ON "conversations"."id" = "messages"."conversation_id"
  AND "conversations"."organization_id" = "messages"."organization_id"
WHERE "audit_logs"."entity_type" = 'message'
  AND "audit_logs"."entity_id" = "messages"."id"
  AND "audit_logs"."organization_id" = "messages"."organization_id"
  AND "audit_logs"."scope_dwelling_id" IS NULL;--> statement-breakpoint
UPDATE "audit_logs"
SET "scope_dwelling_id" = "manual_rule_inputs"."dwelling_id"
FROM "manual_rule_inputs"
WHERE "audit_logs"."entity_type" = 'manual_rule_input'
  AND "audit_logs"."entity_id" = "manual_rule_inputs"."id"
  AND "audit_logs"."organization_id" = "manual_rule_inputs"."organization_id"
  AND "audit_logs"."scope_dwelling_id" IS NULL;
