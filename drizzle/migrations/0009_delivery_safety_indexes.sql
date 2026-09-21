DROP INDEX "invoice_send_attempts_invoice_id_active_idx";--> statement-breakpoint
ALTER TABLE "invoice_deliveries" ADD COLUMN "is_initial_paper_dispatch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_send_attempts" ADD COLUMN "command_id" text;--> statement-breakpoint
-- No backfill: a historical PAPER row proves only that the PAPER preference
-- was enabled at send time under the old auto-success behavior, never that
-- an administrator actually printed and physically posted/handed over the
-- invoice. "Exactly one historical row" is not evidence of that -- it is
-- indistinguishable from the old code's automatic behavior. Every existing
-- row is therefore left at its default is_initial_paper_dispatch = false
-- (an unverified legacy record); only a NEW row created through the
-- explicit "Record paper dispatch" admin action is ever marked true.
CREATE UNIQUE INDEX "invoice_deliveries_invoice_id_initial_paper_idx" ON "invoice_deliveries" USING btree ("invoice_id") WHERE "invoice_deliveries"."is_initial_paper_dispatch" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_send_attempts_invoice_id_command_id_idx" ON "invoice_send_attempts" USING btree ("invoice_id","command_id") WHERE "invoice_send_attempts"."command_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_send_attempts_invoice_id_active_idx" ON "invoice_send_attempts" USING btree ("invoice_id") WHERE "invoice_send_attempts"."status" in ('CLAIMED', 'DISPATCHING');