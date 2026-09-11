-- Phase M (Security hardening) - Enable RLS on all tables and revoke PostgREST public access
-- Ensures PostgREST (/rest/v1/*) cannot read or write application tables with the publishable anon key.

ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."audit_logs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."app_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."app_users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."billing_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."billing_cases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."billing_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."billing_periods" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."billing_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."billing_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."meter_readings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."meter_readings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."dwelling_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."dwelling_access" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."dwellings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."dwellings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."meters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."meters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."organization_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."organization_memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."organizations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."invoice_access_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."invoice_access_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."invoice_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."invoice_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."invoice_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."invoice_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."invoices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."invoice_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."invoice_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."conversations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."bank_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."bank_imports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."bank_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."bank_transactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."payment_matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."payment_matches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA public FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM authenticated;
  END IF;
END $$;
