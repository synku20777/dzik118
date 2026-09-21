-- Forward, idempotent convergence migration. Do NOT edit 0009 again.
--
-- Migration 0009 has existed in THREE different forms across this
-- project's history (different commits regenerated it with different
-- content while it was believed to be unreleased): an original form that
-- created a destructive `invoice_deliveries_invoice_id_paper_idx` unique
-- index scoped to (invoice_id) WHERE method='PAPER' (which forbids more
-- than one PAPER row per invoice ever, including legitimate future
-- reprints), a second form that added `is_initial_paper_dispatch` but
-- BACKFILLED it to true for any invoice with exactly one historical PAPER
-- row (later judged incorrect -- an old auto-created PAPER row proves
-- nothing about real physical dispatch), and the current form that adds
-- the same column with no backfill at all.
--
-- This repository's own `npm run deploy` script runs
-- `db:migrate:production` directly (not through CI), so the absence of a
-- CI deploy step is NOT evidence that no version of 0009 was ever applied
-- to a real database -- that can only be confirmed by inspecting the
-- actual production migration journal and schema (see
-- docs/deployment/DEPLOYMENT_RUNBOOK.md's migration-safety section). This
-- migration is written to converge to the correct end state regardless of
-- which (if any) prior form of 0009 already ran, using IF EXISTS/IF NOT
-- EXISTS guards throughout, rather than assuming a specific starting
-- point.
--
-- What this migration deliberately does NOT do, and CANNOT do:
--
-- 1. It does not touch any existing `is_initial_paper_dispatch` value. If
--    the SECOND historical form of 0009 already ran against this database,
--    some legacy PAPER rows may already be incorrectly marked `true`. That
--    cannot be safely auto-corrected here (this application has no way to
--    distinguish a wrongly-backfilled row from a row an administrator
--    later confirmed through the current explicit "Record paper dispatch"
--    workflow) -- it requires a manual operator audit. Before relying on
--    this data, run:
--
--      SELECT id, invoice_id, created_at
--      FROM invoice_deliveries
--      WHERE method = 'PAPER' AND is_initial_paper_dispatch = true;
--
--    and manually cross-check the resulting rows against real evidence of
--    physical dispatch for invoices generated before this feature existed.
--
-- 2. It CANNOT restore historical PAPER delivery rows that were already
--    deleted. The FIRST historical form of 0009 (commit 4e0f735) executed:
--
--      DELETE FROM invoice_deliveries
--      WHERE method = 'PAPER'
--        AND id NOT IN (
--          SELECT DISTINCT ON (invoice_id) id FROM invoice_deliveries
--          WHERE method = 'PAPER' ORDER BY invoice_id, created_at ASC, id ASC
--        );
--
--    If that specific form of 0009 was ever applied to a real database,
--    any invoice that had MORE than one historical PAPER row at that time
--    already had all but its earliest one irreversibly deleted, before
--    this migration (or any later one) could ever run. This is schema
--    convergence, not data convergence -- 0010 fixes the SCHEMA (indexes,
--    columns) to a consistent state regardless of which prior 0009 ran,
--    but it has no way to know what a deleted row's method/status/
--    timestamps were, so it cannot reconstruct deleted history. If this
--    matters, it must be recovered from a database backup taken before
--    that deploy, or accepted as unrecoverable.
--
-- See docs/deployment/DEPLOYMENT_RUNBOOK.md's "Migration 0009/0010 safety
-- check" section for the full inspection procedure and what to do with
-- each possible finding.

-- Drop the original, superseded destructive index if the first historical
-- form of 0009 ever created it. Harmless no-op otherwise.
DROP INDEX IF EXISTS "invoice_deliveries_invoice_id_paper_idx";--> statement-breakpoint

-- Ensure both columns exist regardless of which form of 0009 ran (or
-- whether it ran at all).
ALTER TABLE "invoice_deliveries" ADD COLUMN IF NOT EXISTS "is_initial_paper_dispatch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_send_attempts" ADD COLUMN IF NOT EXISTS "command_id" text;--> statement-breakpoint

-- Re-create the active-attempt index from scratch: if an OLDER, wider form
-- of this same-named index exists (the pre-0008-safety-rework predicate,
-- or an intermediate one), `CREATE INDEX IF NOT EXISTS` would silently
-- keep the WRONG predicate in place, since it only checks the index NAME
-- exists, not that its definition matches. Drop and recreate unconditionally.
DROP INDEX IF EXISTS "invoice_send_attempts_invoice_id_active_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_send_attempts_invoice_id_active_idx" ON "invoice_send_attempts" USING btree ("invoice_id") WHERE "invoice_send_attempts"."status" in ('CLAIMED', 'DISPATCHING');--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_deliveries_invoice_id_initial_paper_idx" ON "invoice_deliveries" USING btree ("invoice_id") WHERE "invoice_deliveries"."is_initial_paper_dispatch" = true;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_send_attempts_invoice_id_command_id_idx" ON "invoice_send_attempts" USING btree ("invoice_id","command_id") WHERE "invoice_send_attempts"."command_id" is not null;
