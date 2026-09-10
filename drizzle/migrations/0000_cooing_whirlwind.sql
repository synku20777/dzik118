CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'RESIDENT');--> statement-breakpoint
CREATE TYPE "public"."billing_calculation_type" AS ENUM('FIXED', 'AREA', 'RESIDENT_COUNT', 'METER_CONSUMPTION', 'MANUAL_QUANTITY', 'MANUAL_AMOUNT');--> statement-breakpoint
CREATE TYPE "public"."billing_case_status" AS ENUM('MISSING_DATA', 'DRAFT', 'PREPARED', 'SENT', 'PAID', 'OVERDUE');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('OPEN', 'LOCKED');--> statement-breakpoint
CREATE TYPE "public"."reading_source" AS ENUM('ADMIN', 'RESIDENT', 'IMPORT');--> statement-breakpoint
CREATE TYPE "public"."dwelling_type" AS ENUM('APARTMENT', 'COMMERCIAL_UNIT', 'PARKING', 'STORAGE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."meter_type" AS ENUM('COLD_WATER', 'HOT_WATER', 'ELECTRICITY', 'GAS', 'HEAT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('NEW', 'OPEN', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."payment_match_status" AS ENUM('PROPOSED', 'CONFIRMED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."payment_match_type" AS ENUM('AUTO_EXACT', 'AUTO_PROBABLE', 'MANUAL');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before_data" jsonb,
	"after_data" jsonb,
	"request_id" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"role" "user_role" NOT NULL,
	"email_snapshot" text NOT NULL,
	"display_name" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"dwelling_id" uuid NOT NULL,
	"status" "billing_case_status" DEFAULT 'MISSING_DATA' NOT NULL,
	"missing_data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manual_status_override" boolean DEFAULT false NOT NULL,
	"status_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_cases_period_id_dwelling_id_key" UNIQUE("period_id","dwelling_id")
);
--> statement-breakpoint
CREATE TABLE "billing_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" smallint NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"reading_deadline" date,
	"invoice_issue_date" date NOT NULL,
	"invoice_due_date" date NOT NULL,
	"status" "period_status" DEFAULT 'OPEN' NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_periods_organization_id_year_month_key" UNIQUE("organization_id","year","month")
);
--> statement-breakpoint
CREATE TABLE "billing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"calculation_type" "billing_calculation_type" NOT NULL,
	"meter_type" "meter_type",
	"unit" text NOT NULL,
	"unit_price" numeric(14, 4),
	"vat_rate" numeric(7, 4) DEFAULT '0' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_until" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "billing_rules_organization_id_code_key" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "meter_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"meter_id" uuid NOT NULL,
	"previous_value" numeric(14, 3),
	"current_value" numeric(14, 3) NOT NULL,
	"consumption" numeric(14, 3) NOT NULL,
	"source" "reading_source" NOT NULL,
	"submitted_by_user_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	CONSTRAINT "meter_readings_period_id_meter_id_key" UNIQUE("period_id","meter_id")
);
--> statement-breakpoint
CREATE TABLE "dwelling_access" (
	"dwelling_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dwelling_access_dwelling_id_user_id_pk" PRIMARY KEY("dwelling_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "dwellings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "dwelling_type" DEFAULT 'APARTMENT' NOT NULL,
	"number" text NOT NULL,
	"display_name" text,
	"occupant_name" text,
	"billing_name" text,
	"billing_email" text,
	"billing_address" text,
	"area_m2" numeric(10, 2) DEFAULT '0' NOT NULL,
	"resident_count" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "dwellings_organization_id_number_key" UNIQUE("organization_id","number"),
	CONSTRAINT "dwellings_id_organization_id_key" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "meters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"dwelling_id" uuid NOT NULL,
	"type" "meter_type" NOT NULL,
	"serial_number" text,
	"unit" text NOT NULL,
	"label" text,
	"installed_at" date,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_access_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "invoice_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"destination_email" text NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text,
	"status" text NOT NULL,
	"error_code" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"billing_rule_id" uuid,
	"sort_order" integer NOT NULL,
	"description" text NOT NULL,
	"calculation_type" "billing_calculation_type" NOT NULL,
	"source_snapshot" jsonb NOT NULL,
	"unit" text,
	"quantity" numeric(14, 4),
	"unit_price" numeric(14, 4),
	"vat_rate" numeric(7, 4) NOT NULL,
	"net_amount" numeric(14, 2) NOT NULL,
	"vat_amount" numeric(14, 2) NOT NULL,
	"gross_amount" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"logo_object_key" text,
	"header_text" text,
	"footer_text" text,
	"payment_instructions" text,
	"default_note" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_templates_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"billing_case_id" uuid NOT NULL,
	"dwelling_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"currency" char(3) NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"vat_total" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"issuer_snapshot" jsonb NOT NULL,
	"recipient_snapshot" jsonb NOT NULL,
	"payment_snapshot" jsonb NOT NULL,
	"template_snapshot" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"prepared_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"pdf_object_key" text,
	"pdf_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_billing_case_id_unique" UNIQUE("billing_case_id"),
	CONSTRAINT "invoices_organization_id_invoice_number_key" UNIQUE("organization_id","invoice_number")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"dwelling_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"status" "conversation_status" DEFAULT 'NEW' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_memberships_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"registration_number" text,
	"vat_number" text,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text,
	"postal_code" text,
	"country_code" char(2) DEFAULT 'LV' NOT NULL,
	"email" text,
	"phone" text,
	"bank_name" text,
	"iban" text,
	"bic" text,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"timezone" text DEFAULT 'Europe/Riga' NOT NULL,
	"locale" text DEFAULT 'lv' NOT NULL,
	"invoice_prefix" text DEFAULT 'INV' NOT NULL,
	"default_due_days" integer DEFAULT 14 NOT NULL,
	"auto_generate_enabled" boolean DEFAULT false NOT NULL,
	"auto_send_enabled" boolean DEFAULT false NOT NULL,
	"auto_send_day" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "organizations_default_due_days_check" CHECK ("organizations"."default_due_days" between 0 and 120),
	CONSTRAINT "organizations_auto_send_day_check" CHECK ("organizations"."auto_send_day" is null or "organizations"."auto_send_day" between 1 and 28)
);
--> statement-breakpoint
CREATE TABLE "bank_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"original_filename" text NOT NULL,
	"file_sha256" text NOT NULL,
	"imported_by_user_id" uuid NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_count" integer NOT NULL,
	CONSTRAINT "bank_imports_organization_id_file_sha256_key" UNIQUE("organization_id","file_sha256")
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"bank_import_id" uuid NOT NULL,
	"external_transaction_id" text,
	"booking_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"payer_name" text,
	"payer_account" text,
	"reference" text,
	"raw_data" jsonb NOT NULL,
	"row_number" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"bank_transaction_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"match_type" "payment_match_type" NOT NULL,
	"status" "payment_match_status" DEFAULT 'PROPOSED' NOT NULL,
	"confidence" numeric(5, 4),
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_matches_bank_transaction_id_invoice_id_key" UNIQUE("bank_transaction_id","invoice_id")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_cases" ADD CONSTRAINT "billing_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_cases" ADD CONSTRAINT "billing_cases_period_id_billing_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."billing_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_cases" ADD CONSTRAINT "billing_cases_dwelling_id_dwellings_id_fk" FOREIGN KEY ("dwelling_id") REFERENCES "public"."dwellings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_rules" ADD CONSTRAINT "billing_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_period_id_billing_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."billing_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_submitted_by_user_id_app_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dwelling_access" ADD CONSTRAINT "dwelling_access_dwelling_id_dwellings_id_fk" FOREIGN KEY ("dwelling_id") REFERENCES "public"."dwellings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dwelling_access" ADD CONSTRAINT "dwelling_access_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dwellings" ADD CONSTRAINT "dwellings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meters" ADD CONSTRAINT "meters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meters" ADD CONSTRAINT "meters_dwelling_id_organization_id_fk" FOREIGN KEY ("dwelling_id","organization_id") REFERENCES "public"."dwellings"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_access_tokens" ADD CONSTRAINT "invoice_access_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_access_tokens" ADD CONSTRAINT "invoice_access_tokens_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_deliveries" ADD CONSTRAINT "invoice_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_deliveries" ADD CONSTRAINT "invoice_deliveries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_billing_rule_id_billing_rules_id_fk" FOREIGN KEY ("billing_rule_id") REFERENCES "public"."billing_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_templates" ADD CONSTRAINT "invoice_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_billing_case_id_billing_cases_id_fk" FOREIGN KEY ("billing_case_id") REFERENCES "public"."billing_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_dwelling_id_dwellings_id_fk" FOREIGN KEY ("dwelling_id") REFERENCES "public"."dwellings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_period_id_billing_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."billing_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_dwelling_id_dwellings_id_fk" FOREIGN KEY ("dwelling_id") REFERENCES "public"."dwellings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_app_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_imports" ADD CONSTRAINT "bank_imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_imports" ADD CONSTRAINT "bank_imports_imported_by_user_id_app_users_id_fk" FOREIGN KEY ("imported_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_import_id_bank_imports_id_fk" FOREIGN KEY ("bank_import_id") REFERENCES "public"."bank_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_confirmed_by_user_id_app_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "billing_cases_organization_id_status_idx" ON "billing_cases" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "billing_periods_organization_id_idx" ON "billing_periods" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "billing_rules_organization_id_idx" ON "billing_rules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "meter_readings_organization_id_idx" ON "meter_readings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "meter_readings_period_id_idx" ON "meter_readings" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "dwelling_access_user_id_idx" ON "dwelling_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dwellings_organization_id_idx" ON "dwellings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "meters_organization_id_idx" ON "meters" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "meters_dwelling_id_idx" ON "meters" USING btree ("dwelling_id");--> statement-breakpoint
CREATE INDEX "invoice_access_tokens_invoice_id_idx" ON "invoice_access_tokens" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_deliveries_invoice_id_idx" ON "invoice_deliveries" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_organization_id_idx" ON "invoices" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invoices_dwelling_id_idx" ON "invoices" USING btree ("dwelling_id");--> statement-breakpoint
CREATE INDEX "invoices_period_id_idx" ON "invoices" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "conversations_organization_id_idx" ON "conversations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "conversations_dwelling_id_idx" ON "conversations" USING btree ("dwelling_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "organization_memberships_user_id_idx" ON "organization_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bank_imports_organization_id_idx" ON "bank_imports" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "bank_transactions_organization_id_idx" ON "bank_transactions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "bank_transactions_bank_import_id_idx" ON "bank_transactions" USING btree ("bank_import_id");--> statement-breakpoint
CREATE INDEX "payment_matches_organization_id_idx" ON "payment_matches" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "payment_matches_invoice_id_idx" ON "payment_matches" USING btree ("invoice_id");