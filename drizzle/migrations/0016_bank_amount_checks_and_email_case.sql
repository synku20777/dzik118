-- NOT VALID: enforce the rule for new rows without scanning old ones. A debit
-- row imported before this rule must not block the deploy.
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_amount_positive_check" CHECK ("bank_transactions"."amount" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_allocation_nonnegative_check" CHECK ("payment_matches"."proposed_allocation_amount" >= 0) NOT VALID;--> statement-breakpoint
-- Sign-in and password reset look the address up in lowercase.
UPDATE "app_users" SET "email_snapshot" = lower(btrim("email_snapshot")) WHERE "email_snapshot" <> lower(btrim("email_snapshot"));
