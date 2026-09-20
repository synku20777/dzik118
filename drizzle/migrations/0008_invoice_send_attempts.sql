CREATE TYPE "public"."invoice_send_attempt_status" AS ENUM('CLAIMED', 'DISPATCHING', 'SENT', 'FAILED', 'UNKNOWN');--> statement-breakpoint
CREATE TABLE "invoice_send_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"status" "invoice_send_attempt_status" DEFAULT 'CLAIMED' NOT NULL,
	"error_code" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatch_started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_deliveries" ADD COLUMN "attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_send_attempts" ADD CONSTRAINT "invoice_send_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_send_attempts" ADD CONSTRAINT "invoice_send_attempts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_send_attempts_invoice_id_idx" ON "invoice_send_attempts" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_send_attempts_invoice_id_active_idx" ON "invoice_send_attempts" USING btree ("invoice_id") WHERE "invoice_send_attempts"."status" in ('CLAIMED', 'DISPATCHING', 'SENT', 'UNKNOWN');--> statement-breakpoint
ALTER TABLE "invoice_deliveries" ADD CONSTRAINT "invoice_deliveries_attempt_id_invoice_send_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."invoice_send_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_deliveries_attempt_id_idx" ON "invoice_deliveries" USING btree ("attempt_id");--> statement-breakpoint
ALTER TABLE "public"."invoice_send_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."invoice_send_attempts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "public"."invoice_send_attempts" FROM anon;--> statement-breakpoint
REVOKE ALL ON TABLE "public"."invoice_send_attempts" FROM authenticated;