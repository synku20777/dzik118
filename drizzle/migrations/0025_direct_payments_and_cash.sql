CREATE TYPE "public"."payment_method" AS ENUM('BANK', 'CASH');--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "payment_method" "payment_method" DEFAULT 'BANK' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "applied_dwelling_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_applied_dwelling_id_dwellings_id_fk" FOREIGN KEY ("applied_dwelling_id") REFERENCES "public"."dwellings"("id") ON DELETE no action ON UPDATE no action;