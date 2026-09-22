CREATE TYPE "public"."billing_rule_scope" AS ENUM('ONE_TO_ALL', 'ONE_TO_MANY', 'ONE_TO_ONE');--> statement-breakpoint
ALTER TABLE "billing_rules" ADD COLUMN "application_scope" "billing_rule_scope" DEFAULT 'ONE_TO_ALL' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_rules" ADD CONSTRAINT "billing_rules_id_organization_id_key" UNIQUE("id","organization_id");--> statement-breakpoint
CREATE TABLE "billing_rule_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"billing_rule_id" uuid NOT NULL,
	"dwelling_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_rule_assignments_rule_id_dwelling_id_key" UNIQUE("billing_rule_id","dwelling_id")
);
--> statement-breakpoint
ALTER TABLE "billing_rule_assignments" ADD CONSTRAINT "billing_rule_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_rule_assignments" ADD CONSTRAINT "billing_rule_assignments_billing_rule_id_billing_rules_id_fk" FOREIGN KEY ("billing_rule_id") REFERENCES "public"."billing_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_rule_assignments" ADD CONSTRAINT "billing_rule_assignments_dwelling_id_dwellings_id_fk" FOREIGN KEY ("dwelling_id") REFERENCES "public"."dwellings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_rule_assignments" ADD CONSTRAINT "billing_rule_assignments_billing_rule_id_organization_id_fk" FOREIGN KEY ("billing_rule_id","organization_id") REFERENCES "public"."billing_rules"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_rule_assignments" ADD CONSTRAINT "billing_rule_assignments_dwelling_id_organization_id_fk" FOREIGN KEY ("dwelling_id","organization_id") REFERENCES "public"."dwellings"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_rule_assignments_organization_id_idx" ON "billing_rule_assignments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "billing_rule_assignments_dwelling_id_idx" ON "billing_rule_assignments" USING btree ("dwelling_id");
