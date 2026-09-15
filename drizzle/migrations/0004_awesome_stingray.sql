CREATE TYPE "public"."delivery_method" AS ENUM('EMAIL', 'PAPER');--> statement-breakpoint
ALTER TABLE "invoice_deliveries" ALTER COLUMN "destination_email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dwellings" ADD COLUMN "invoice_by_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "dwellings" ADD COLUMN "invoice_by_paper" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_deliveries" ADD COLUMN "method" "delivery_method" DEFAULT 'EMAIL' NOT NULL;--> statement-breakpoint
ALTER TABLE "dwellings" ADD CONSTRAINT "dwellings_invoice_delivery_method_check" CHECK ("dwellings"."invoice_by_email" OR "dwellings"."invoice_by_paper");