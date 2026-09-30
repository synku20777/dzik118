-- Which capability the sender acted through for each message, stamped
-- explicitly going forward (see src/domain/messaging/conversations.ts) now
-- that a person can hold admin and resident capability at the same time,
-- so app_users.role alone can no longer say which hat they wore for a
-- given message. Backfill from app_users.role: every existing message was
-- sent before dual-role existed, so the sender's role at that time is
-- exactly correct for it.
ALTER TABLE "messages" ADD COLUMN "sender_role" "user_role";--> statement-breakpoint
UPDATE "messages" SET "sender_role" = "app_users"."role"
  FROM "app_users"
  WHERE "app_users"."id" = "messages"."sender_user_id";--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "sender_role" SET NOT NULL;
