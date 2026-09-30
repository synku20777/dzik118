CREATE TYPE "public"."suppression_reason" AS ENUM('BOUNCE', 'COMPLAINT');--> statement-breakpoint
CREATE TABLE "suppressed_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppressed_emails_organization_id_email_key" UNIQUE("organization_id","email"),
	CONSTRAINT "suppressed_emails_email_lowercase_check" CHECK ("suppressed_emails"."email" = lower("suppressed_emails"."email"))
);
--> statement-breakpoint
ALTER TABLE "suppressed_emails" ADD CONSTRAINT "suppressed_emails_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suppressed_emails_organization_id_idx" ON "suppressed_emails" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "suppressed_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppressed_emails" FORCE ROW LEVEL SECURITY;