CREATE TYPE "public"."account_entry_type" AS ENUM('OPENING_BALANCE', 'INVOICE_CHARGE', 'PAYMENT', 'LATE_FEE', 'LATE_FEE_ADJUSTMENT', 'MANUAL_ADJUSTMENT', 'CREDIT_CARRY_FORWARD', 'DEBT_CARRY_FORWARD');--> statement-breakpoint
CREATE TYPE "public"."late_fee_adjustment_reason" AS ENUM('BANK_PROCESSING_DELAY', 'BILLING_DISPUTE', 'METER_ISSUE', 'AGREEMENT_WITH_RESIDENT', 'ADMIN_WAIVER', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."late_fee_start_rule" AS ENUM('DAY_AFTER_DUE_DATE');--> statement-breakpoint
CREATE TYPE "public"."payment_allocation_method" AS ENUM('EXACT', 'PARTIAL', 'OVERPAYMENT', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."payment_result_type" AS ENUM('EXACT', 'PARTIAL', 'OVERPAYMENT');--> statement-breakpoint
CREATE TABLE "account_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"dwelling_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"type" "account_entry_type" NOT NULL,
	"debit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" char(3) NOT NULL,
	"invoice_id" uuid,
	"bank_transaction_id" uuid,
	"reason" text,
	"description" text NOT NULL,
	"actor_user_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "account_entries_single_sided_check" CHECK (("account_entries"."debit" > 0 and "account_entries"."credit" = 0) or ("account_entries"."credit" > 0 and "account_entries"."debit" = 0))
);
--> statement-breakpoint
CREATE TABLE "late_fee_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"calculated_amount" numeric(14, 2) NOT NULL,
	"prior_applied_amount" numeric(14, 2) NOT NULL,
	"new_applied_amount" numeric(14, 2) NOT NULL,
	"adjustment_amount" numeric(14, 2) NOT NULL,
	"reason" "late_fee_adjustment_reason" NOT NULL,
	"note" text,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "late_fee_adjustments_values_check" CHECK ("late_fee_adjustments"."calculated_amount" >= 0 and "late_fee_adjustments"."prior_applied_amount" >= 0 and "late_fee_adjustments"."new_applied_amount" >= 0 and "late_fee_adjustments"."adjustment_amount" = "late_fee_adjustments"."new_applied_amount" - "late_fee_adjustments"."prior_applied_amount"),
	CONSTRAINT "late_fee_adjustments_other_note_check" CHECK ("late_fee_adjustments"."reason" <> 'OTHER' or length(trim(coalesce("late_fee_adjustments"."note", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "late_fee_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"daily_rate" numeric(9, 6) DEFAULT '0' NOT NULL,
	"grace_days" integer DEFAULT 0 NOT NULL,
	"start_rule" "late_fee_start_rule" DEFAULT 'DAY_AFTER_DUE_DATE' NOT NULL,
	"max_penalty_percent" numeric(7, 4) DEFAULT '0' NOT NULL,
	"stops_at_cap" boolean DEFAULT true NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "late_fee_policies_org_effective_from_key" UNIQUE("organization_id","effective_from"),
	CONSTRAINT "late_fee_policies_values_check" CHECK ("late_fee_policies"."daily_rate" >= 0 and "late_fee_policies"."grace_days" >= 0 and "late_fee_policies"."max_penalty_percent" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"dwelling_id" uuid NOT NULL,
	"bank_transaction_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"allocated_amount" numeric(14, 2) NOT NULL,
	"allocation_date" timestamp with time zone DEFAULT now() NOT NULL,
	"method" "payment_allocation_method" NOT NULL,
	"actor_user_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payment_allocations_transaction_invoice_key" UNIQUE("bank_transaction_id","invoice_id"),
	CONSTRAINT "payment_allocations_amount_positive_check" CHECK ("payment_allocations"."allocated_amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "current_charges" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "previous_outstanding" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "previous_credit_applied" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "late_fee_calculated" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "late_fee_adjustment" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "late_fee_applied" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "manual_adjustment" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "amount_due" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "remaining_credit" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "balance_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "penalty_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "manual_adjustment_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD COLUMN "result_type" "payment_result_type" DEFAULT 'EXACT' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD COLUMN "proposed_allocation_amount" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
-- v1 invoices had one total and no carry-forward. Preserve that document as
-- current-period charges/amount due without manufacturing historic credit.
UPDATE "invoices"
SET "current_charges" = "total",
    "amount_due" = "total",
    "balance_snapshot" = jsonb_build_object('migration', 'v1-total-as-current-charges'),
    "penalty_snapshot" = jsonb_build_object('migration', 'no-prior-late-fee-engine')
WHERE "current_charges" = 0 AND "amount_due" = 0;--> statement-breakpoint
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_dwelling_id_dwellings_id_fk" FOREIGN KEY ("dwelling_id") REFERENCES "public"."dwellings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_fee_adjustments" ADD CONSTRAINT "late_fee_adjustments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_fee_adjustments" ADD CONSTRAINT "late_fee_adjustments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_fee_adjustments" ADD CONSTRAINT "late_fee_adjustments_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_fee_policies" ADD CONSTRAINT "late_fee_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_fee_policies" ADD CONSTRAINT "late_fee_policies_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_dwelling_id_dwellings_id_fk" FOREIGN KEY ("dwelling_id") REFERENCES "public"."dwellings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A disabled epoch policy preserves v1 behavior until an ADMIN saves a future
-- effective late-fee policy.
INSERT INTO "late_fee_policies" ("organization_id", "effective_from", "enabled", "daily_rate", "grace_days", "max_penalty_percent", "stops_at_cap")
SELECT "id", DATE '1970-01-01', false, 0, 0, 0, true FROM "organizations"
ON CONFLICT ("organization_id", "effective_from") DO NOTHING;--> statement-breakpoint
-- Existing v1 has no partial/overpayment history to infer. Only unpaid issued
-- statements become opening receivables; paid rows remain zero-balance.
INSERT INTO "account_entries" ("organization_id", "dwelling_id", "effective_date", "type", "debit", "credit", "currency", "invoice_id", "description", "metadata", "idempotency_key")
SELECT i."organization_id", i."dwelling_id", i."issue_date", 'OPENING_BALANCE', i."amount_due", 0, i."currency", i."id", 'Migrated unpaid invoice balance', jsonb_build_object('migration', 'v1-opening-receivable', 'source_status', c."status"), 'migration:invoice:' || i."id" || ':opening'
FROM "invoices" i
JOIN "billing_cases" c ON c."id" = i."billing_case_id"
WHERE i."paid_at" IS NULL
  AND c."status" IN ('PREPARED', 'SENT', 'OVERDUE')
  AND i."amount_due" > 0
ON CONFLICT ("idempotency_key") DO NOTHING;--> statement-breakpoint
CREATE INDEX "account_entries_org_dwelling_date_idx" ON "account_entries" USING btree ("organization_id","dwelling_id","effective_date","created_at");--> statement-breakpoint
CREATE INDEX "account_entries_invoice_id_idx" ON "account_entries" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "account_entries_bank_transaction_id_idx" ON "account_entries" USING btree ("bank_transaction_id");--> statement-breakpoint
CREATE INDEX "late_fee_adjustments_org_invoice_idx" ON "late_fee_adjustments" USING btree ("organization_id","invoice_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "late_fee_policies_org_effective_from_idx" ON "late_fee_policies" USING btree ("organization_id","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payment_allocations_org_invoice_idx" ON "payment_allocations" USING btree ("organization_id","invoice_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_balance_components_nonnegative_check" CHECK ("invoices"."current_charges" >= 0 and "invoices"."previous_outstanding" >= 0 and "invoices"."previous_credit_applied" >= 0 and "invoices"."late_fee_calculated" >= 0 and "invoices"."late_fee_applied" >= 0 and "invoices"."amount_due" >= 0 and "invoices"."remaining_credit" >= 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_late_fee_reconciles_check" CHECK ("invoices"."late_fee_applied" = "invoices"."late_fee_calculated" + "invoices"."late_fee_adjustment");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_due_reconciles_check" CHECK ("invoices"."amount_due" = greatest("invoices"."current_charges" + "invoices"."previous_outstanding" - "invoices"."previous_credit_applied" + "invoices"."late_fee_applied" + "invoices"."manual_adjustment", 0));
--> statement-breakpoint
ALTER TABLE "account_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_allocations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "late_fee_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "late_fee_policies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "late_fee_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "late_fee_adjustments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."prevent_financial_history_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Financial history is append-only; create a compensating entry instead';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "account_entries_append_only" BEFORE UPDATE OR DELETE ON "account_entries" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_financial_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "payment_allocations_append_only" BEFORE UPDATE OR DELETE ON "payment_allocations" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_financial_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "late_fee_adjustments_append_only" BEFORE UPDATE OR DELETE ON "late_fee_adjustments" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_financial_history_mutation"();
