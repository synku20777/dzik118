ALTER TYPE "public"."account_entry_type" ADD VALUE 'PAYMENT_REVERSAL';--> statement-breakpoint
ALTER TYPE "public"."payment_match_status" ADD VALUE 'REVERSED';--> statement-breakpoint
CREATE TABLE "payment_reversals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"dwelling_id" uuid NOT NULL,
	"payment_match_id" uuid NOT NULL,
	"bank_transaction_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"reversed_allocation_amount" numeric(14, 2) NOT NULL,
	"reversed_credit_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_reversals_payment_match_id_unique" UNIQUE("payment_match_id"),
	CONSTRAINT "payment_reversals_amounts_check" CHECK ("payment_reversals"."reversed_allocation_amount" > 0 and "payment_reversals"."reversed_credit_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_dwelling_id_dwellings_id_fk" FOREIGN KEY ("dwelling_id") REFERENCES "public"."dwellings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_payment_match_id_payment_matches_id_fk" FOREIGN KEY ("payment_match_id") REFERENCES "public"."payment_matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_reversals_org_invoice_idx" ON "payment_reversals" USING btree ("organization_id","invoice_id");
--> statement-breakpoint
ALTER TABLE "payment_reversals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_reversals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER "payment_reversals_append_only" BEFORE UPDATE OR DELETE ON "payment_reversals" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_financial_history_mutation"();