// Shared setup/teardown for the "one seed admin, N throwaway organizations"
// pattern every integration test file in this directory follows (except
// authorization.test.ts, which exercises a fixed multi-org/multi-resident
// fixture shared across all its cases rather than one org per test).
import { randomUUID } from "node:crypto";
import { createDb, type Db } from "../../src/db/client";
import { appUsers } from "../../src/db/schema/auth";

export function requireDatabaseUrl(): string {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for integration tests");
  }
  return connectionString;
}

export async function createIntegrationDb(): Promise<Db> {
  return createDb(requireDatabaseUrl());
}

export async function seedTestAdmin(db: Db, email: string): Promise<string> {
  const id = randomUUID();
  await db.insert(appUsers).values({ id, role: "ADMIN", emailSnapshot: email });
  return id;
}

export async function deleteTestAdmin(db: Db, id: string): Promise<void> {
  await db.$client.query("delete from app_users where id = $1", [id]);
}

// Every child table an organization fixture in this test suite might have
// populated, in FK-safe (children-before-parents) order. Deleting from a
// table the test never touched for this org is a harmless no-op, so one
// comprehensive list is simpler and safer than each file hand-maintaining
// its own subset (the exact bug this replaces: a file forgetting to add a
// newly-used table to its cleanup and hitting a leftover-FK error).
export async function cleanupOrganization(
  db: Db,
  organizationId: string
): Promise<void> {
  // account_entries/payment_allocations/late_fee_adjustments are append-only
  // in production (a trigger raises on UPDATE/DELETE, so a mistake can only
  // ever be corrected with a compensating entry, never erased) -- test
  // cleanup is the one place that legitimately needs to bypass that.
  // `ALTER TABLE ... DISABLE TRIGGER` is a global catalog change visible to
  // every session immediately, so toggling it here would race with any
  // other integration test file's cleanup running concurrently (confirmed:
  // an intermittent "Financial history is append-only" failure that never
  // reproduced when the failing test ran alone). session_replication_role
  // is a per-connection GUC -- setting it only affects statements run on
  // this same `db` connection, so it can't interleave with another test
  // file's connection.
  await db.$client.query("set session_replication_role = replica");
  try {
    // Must run before bank_transactions/invoices below -- these three
    // reference both.
    await db.$client.query(
      "delete from account_entries where organization_id = $1",
      [organizationId]
    );
    await db.$client.query(
      "delete from payment_allocations where organization_id = $1",
      [organizationId]
    );
    await db.$client.query(
      "delete from late_fee_adjustments where organization_id = $1",
      [organizationId]
    );
  } finally {
    await db.$client.query("set session_replication_role = default");
  }
  const statements = [
    "delete from late_fee_policies where organization_id = $1",
    "delete from payment_matches where organization_id = $1",
    "delete from bank_transactions where organization_id = $1",
    "delete from bank_imports where organization_id = $1",
    "delete from messages where organization_id = $1",
    "delete from conversations where organization_id = $1",
    "delete from invoice_deliveries where organization_id = $1",
    "delete from invoice_send_attempts where organization_id = $1",
    "delete from invoice_access_tokens where organization_id = $1",
    "delete from invoice_lines where organization_id = $1",
    "delete from invoices where organization_id = $1",
    "delete from invoice_templates where organization_id = $1",
    "delete from meter_readings where organization_id = $1",
    "delete from manual_rule_inputs where organization_id = $1",
    "delete from billing_cases where organization_id = $1",
    "delete from billing_periods where organization_id = $1",
    "delete from billing_rule_assignments where organization_id = $1",
    "delete from billing_rules where organization_id = $1",
    "delete from meters where organization_id = $1",
    "delete from dwelling_access where dwelling_id in (select id from dwellings where organization_id = $1)",
    "delete from dwellings where organization_id = $1",
    "delete from organization_memberships where organization_id = $1",
    "delete from mutation_receipts where organization_id = $1",
    "delete from audit_logs where organization_id = $1",
    "delete from organizations where id = $1",
  ];
  for (const statement of statements) {
    await db.$client.query(statement, [organizationId]);
  }
}
