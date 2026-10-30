CREATE TABLE "migration_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_filename" text NOT NULL,
	"source_sha256" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"mapping_sources" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"balance_date" date,
	"row_count" integer NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"totals" jsonb,
	"imported_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"fingerprint" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_mappings_organization_id_kind_fingerprint_key" UNIQUE("organization_id","kind","fingerprint")
);
--> statement-breakpoint
ALTER TABLE "migration_imports" ADD CONSTRAINT "migration_imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_imports" ADD CONSTRAINT "migration_imports_imported_by_user_id_app_users_id_fk" FOREIGN KEY ("imported_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_mappings" ADD CONSTRAINT "migration_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "migration_imports_organization_id_created_at_idx" ON "migration_imports" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "public"."migration_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."migration_imports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "public"."migration_imports" FROM anon;--> statement-breakpoint
REVOKE ALL ON TABLE "public"."migration_imports" FROM authenticated;--> statement-breakpoint
ALTER TABLE "public"."migration_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."migration_mappings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "public"."migration_mappings" FROM anon;--> statement-breakpoint
REVOKE ALL ON TABLE "public"."migration_mappings" FROM authenticated;