CREATE TABLE "manual_rule_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"dwelling_id" uuid NOT NULL,
	"billing_rule_id" uuid NOT NULL,
	"value" numeric(14, 4) NOT NULL,
	"submitted_by_user_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	CONSTRAINT "manual_rule_inputs_period_id_dwelling_id_billing_rule_id_key" UNIQUE("period_id","dwelling_id","billing_rule_id")
);
--> statement-breakpoint
ALTER TABLE "manual_rule_inputs" ADD CONSTRAINT "manual_rule_inputs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_rule_inputs" ADD CONSTRAINT "manual_rule_inputs_period_id_billing_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."billing_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_rule_inputs" ADD CONSTRAINT "manual_rule_inputs_dwelling_id_dwellings_id_fk" FOREIGN KEY ("dwelling_id") REFERENCES "public"."dwellings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_rule_inputs" ADD CONSTRAINT "manual_rule_inputs_billing_rule_id_billing_rules_id_fk" FOREIGN KEY ("billing_rule_id") REFERENCES "public"."billing_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_rule_inputs" ADD CONSTRAINT "manual_rule_inputs_submitted_by_user_id_app_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manual_rule_inputs_organization_id_idx" ON "manual_rule_inputs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "manual_rule_inputs_period_id_idx" ON "manual_rule_inputs" USING btree ("period_id");--> statement-breakpoint
ALTER TABLE "manual_rule_inputs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "manual_rule_inputs" FORCE ROW LEVEL SECURITY;