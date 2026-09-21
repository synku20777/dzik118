DROP INDEX "invoice_send_attempts_invoice_id_active_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_send_attempts_invoice_id_active_idx" ON "invoice_send_attempts" USING btree ("invoice_id") WHERE "invoice_send_attempts"."status" in ('CLAIMED', 'DISPATCHING');--> statement-breakpoint
DELETE FROM "invoice_deliveries"
WHERE "method" = 'PAPER'
  AND "id" NOT IN (
    SELECT DISTINCT ON ("invoice_id") "id"
    FROM "invoice_deliveries"
    WHERE "method" = 'PAPER'
    ORDER BY "invoice_id", "created_at" ASC, "id" ASC
  );--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_deliveries_invoice_id_paper_idx" ON "invoice_deliveries" USING btree ("invoice_id") WHERE "invoice_deliveries"."method" = 'PAPER';