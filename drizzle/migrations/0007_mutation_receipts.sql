CREATE TABLE "mutation_receipts" (
	"organization_id" uuid NOT NULL,
	"client_mutation_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"entity_type" text NOT NULL,
	"scope_id" uuid,
	"entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mutation_receipts_organization_id_client_mutation_id_pk" PRIMARY KEY("organization_id","client_mutation_id")
);
--> statement-breakpoint
ALTER TABLE "mutation_receipts" ADD CONSTRAINT "mutation_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."mutation_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."mutation_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "public"."mutation_receipts" FROM anon;--> statement-breakpoint
REVOKE ALL ON TABLE "public"."mutation_receipts" FROM authenticated;
