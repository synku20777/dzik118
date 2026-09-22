ALTER TABLE "public"."billing_rule_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."billing_rule_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "public"."billing_rule_assignments" FROM anon;--> statement-breakpoint
REVOKE ALL ON TABLE "public"."billing_rule_assignments" FROM authenticated;
