DROP INDEX "invoice_send_attempts_invoice_id_active_idx";--> statement-breakpoint
ALTER TABLE "invoice_deliveries" ADD COLUMN "is_initial_paper_dispatch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_send_attempts" ADD COLUMN "command_id" text;--> statement-breakpoint
-- Non-destructive backfill: for an invoice with exactly one historical PAPER
-- row, that row was in fact its sole initial dispatch, so mark it as such.
-- Invoices with more than one PAPER row (only possible from the old
-- pre-safety resend behavior) are left unmarked rather than guessed at --
-- no historical row is ever deleted or reassigned ambiguously.
UPDATE "invoice_deliveries" AS d
SET "is_initial_paper_dispatch" = true
WHERE d."method" = 'PAPER'
  AND (
    SELECT count(*) FROM "invoice_deliveries" d2
    WHERE d2."invoice_id" = d."invoice_id" AND d2."method" = 'PAPER'
  ) = 1;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_deliveries_invoice_id_initial_paper_idx" ON "invoice_deliveries" USING btree ("invoice_id") WHERE "invoice_deliveries"."is_initial_paper_dispatch" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_send_attempts_invoice_id_command_id_idx" ON "invoice_send_attempts" USING btree ("invoice_id","command_id") WHERE "invoice_send_attempts"."command_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_send_attempts_invoice_id_active_idx" ON "invoice_send_attempts" USING btree ("invoice_id") WHERE "invoice_send_attempts"."status" in ('CLAIMED', 'DISPATCHING');