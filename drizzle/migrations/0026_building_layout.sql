CREATE TABLE "building_entrances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"floors" integer NOT NULL,
	"columns" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "building_entrances_id_organization_id_key" UNIQUE("id","organization_id"),
	CONSTRAINT "building_entrances_size_check" CHECK ("building_entrances"."floors" between 1 and 60 and "building_entrances"."columns" between 1 and 24)
);
--> statement-breakpoint
CREATE TABLE "dwelling_placements" (
	"dwelling_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"entrance_id" uuid NOT NULL,
	"floor" integer NOT NULL,
	"slot" integer NOT NULL,
	CONSTRAINT "dwelling_placements_slot_key" UNIQUE("entrance_id","floor","slot"),
	CONSTRAINT "dwelling_placements_position_check" CHECK ("dwelling_placements"."floor" >= 0 and "dwelling_placements"."slot" >= 0)
);
--> statement-breakpoint
ALTER TABLE "building_entrances" ADD CONSTRAINT "building_entrances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dwelling_placements" ADD CONSTRAINT "dwelling_placements_dwelling_id_organization_id_fk" FOREIGN KEY ("dwelling_id","organization_id") REFERENCES "public"."dwellings"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dwelling_placements" ADD CONSTRAINT "dwelling_placements_entrance_id_organization_id_fk" FOREIGN KEY ("entrance_id","organization_id") REFERENCES "public"."building_entrances"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "building_entrances_organization_id_idx" ON "building_entrances" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "dwelling_placements_organization_id_idx" ON "dwelling_placements" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "building_entrances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "building_entrances" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dwelling_placements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dwelling_placements" FORCE ROW LEVEL SECURITY;
