import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/client";
import { invoiceSendAttempts } from "../../src/db/schema/invoices";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import { createOrganization } from "../../src/domain/organizations/organizations";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import { createPeriod } from "../../src/domain/periods/periods";
import { createRule } from "../../src/domain/billing/rules";
import {
  generateInvoice,
  prepareInvoice,
} from "../../src/domain/billing/generation";
import {
  claimSendAttempt,
  markDispatching,
  markFailed,
  markSent,
  markUnknown,
  reconcileStaleAttempt,
} from "../../src/domain/billing/send-attempts";

let db: Db;
let seedAdminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, "it-send-attempts-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, seedAdminId);
  await db.$client.end();
});

async function setupTestInvoice(name: string, month: number = 1) {
  const org = await createOrganization(
    db,
    {
      name,
      addressLine1: "Attempt Test St 1",
      bankName: "Test Bank",
      iban: "LV00TEST0000000000000",
    },
    seedAdminId
  );
  const dwelling = await createDwelling(
    db,
    org.id,
    {
      number: "1",
      occupantName: "Attempt Resident",
      billingAddress: "1 Test St",
      billingEmail: "attempt@example.com",
    },
    seedAdminId
  );
  const period = await createPeriod(
    db,
    org.id,
    {
      year: 2026,
      month,
      startsOn: `2026-0${month}-01`,
      endsOn: `2026-0${month}-28`,
      invoiceIssueDate: `2026-0${month}-28`,
      invoiceDueDate: `2026-0${month + 1}-14`,
    },
    seedAdminId
  );
  await createRule(
    db,
    org.id,
    {
      name: "Fee",
      code: "fee",
      calculationType: "FIXED",
      unit: "month",
      unitPrice: "10.00",
      vatRate: "21.0000",
      effectiveFrom: "2025-01-01",
    },
    seedAdminId
  );
  const generated = await generateInvoice(
    db,
    org.id,
    period.id,
    dwelling.id,
    seedAdminId
  );
  const prepared = await prepareInvoice(db, org.id, generated.id, seedAdminId);
  return { org, invoice: prepared };
}

describe("invoice send attempts state model", () => {
  it("1. claimSendAttempt on an invoice with no existing attempt succeeds (claimed: true)", async () => {
    const { org, invoice } = await setupTestInvoice("IT-SA Org 1", 1);
    try {
      const result = await claimSendAttempt(db, org.id, invoice.id);
      expect(result.claimed).toBe(true);
      expect(result.attempt.invoiceId).toBe(invoice.id);
      expect(result.attempt.organizationId).toBe(org.id);
      expect(result.attempt.status).toBe("CLAIMED");
      expect(result.attempt.errorCode).toBeNull();
      expect(result.attempt.dispatchStartedAt).toBeNull();
      expect(result.attempt.completedAt).toBeNull();
      expect(result.attempt.claimedAt).toBeInstanceOf(Date);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("2. a second claimSendAttempt call while first is CLAIMED/DISPATCHING fails to claim and returns same row", async () => {
    const { org, invoice } = await setupTestInvoice("IT-SA Org 2", 2);
    try {
      const first = await claimSendAttempt(db, org.id, invoice.id);
      expect(first.claimed).toBe(true);

      // Still CLAIMED: second claim fails
      const second = await claimSendAttempt(db, org.id, invoice.id);
      expect(second.claimed).toBe(false);
      expect(second.attempt.id).toBe(first.attempt.id);
      expect(second.attempt.status).toBe("CLAIMED");

      // Move to DISPATCHING: third claim still fails
      const dispatching = await markDispatching(db, first.attempt.id);
      expect(dispatching.status).toBe("DISPATCHING");
      expect(dispatching.dispatchStartedAt).toBeInstanceOf(Date);

      const third = await claimSendAttempt(db, org.id, invoice.id);
      expect(third.claimed).toBe(false);
      expect(third.attempt.id).toBe(first.attempt.id);
      expect(third.attempt.status).toBe("DISPATCHING");
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("3. after markFailed, a subsequent claimSendAttempt call SUCCEEDS with a new row", async () => {
    const { org, invoice } = await setupTestInvoice("IT-SA Org 3", 3);
    try {
      const first = await claimSendAttempt(db, org.id, invoice.id);
      expect(first.claimed).toBe(true);

      const failed = await markFailed(
        db,
        first.attempt.id,
        "TRANSIENT_NETWORK_ERROR"
      );
      expect(failed.status).toBe("FAILED");
      expect(failed.errorCode).toBe("TRANSIENT_NETWORK_ERROR");
      expect(failed.completedAt).toBeInstanceOf(Date);

      // Critical retryability proof: FAILED is excluded from partial unique index
      const retry = await claimSendAttempt(db, org.id, invoice.id);
      expect(retry.claimed).toBe(true);
      expect(retry.attempt.id).not.toBe(first.attempt.id);
      expect(retry.attempt.status).toBe("CLAIMED");
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("4. after markSent or markUnknown, subsequent claimSendAttempt calls FAIL to claim forever", async () => {
    const { org: orgSent, invoice: invoiceSent } = await setupTestInvoice(
      "IT-SA Org 4a",
      4
    );
    try {
      const claim1 = await claimSendAttempt(db, orgSent.id, invoiceSent.id);
      expect(claim1.claimed).toBe(true);

      const sent = await markSent(db, claim1.attempt.id);
      expect(sent.status).toBe("SENT");
      expect(sent.completedAt).toBeInstanceOf(Date);

      const claimAfterSent = await claimSendAttempt(
        db,
        orgSent.id,
        invoiceSent.id
      );
      expect(claimAfterSent.claimed).toBe(false);
      expect(claimAfterSent.attempt.id).toBe(claim1.attempt.id);
      expect(claimAfterSent.attempt.status).toBe("SENT");
    } finally {
      await cleanupOrganization(db, orgSent.id);
    }

    const { org: orgUnknown, invoice: invoiceUnknown } = await setupTestInvoice(
      "IT-SA Org 4b",
      5
    );
    try {
      const claim2 = await claimSendAttempt(
        db,
        orgUnknown.id,
        invoiceUnknown.id
      );
      expect(claim2.claimed).toBe(true);

      const unknown = await markUnknown(
        db,
        claim2.attempt.id,
        "PROVIDER_TIMEOUT"
      );
      expect(unknown.status).toBe("UNKNOWN");
      expect(unknown.errorCode).toBe("PROVIDER_TIMEOUT");
      expect(unknown.completedAt).toBeInstanceOf(Date);

      const claimAfterUnknown = await claimSendAttempt(
        db,
        orgUnknown.id,
        invoiceUnknown.id
      );
      expect(claimAfterUnknown.claimed).toBe(false);
      expect(claimAfterUnknown.attempt.id).toBe(claim2.attempt.id);
      expect(claimAfterUnknown.attempt.status).toBe("UNKNOWN");
    } finally {
      await cleanupOrganization(db, orgUnknown.id);
    }
  });

  it("5. reconcileStaleAttempt handles fresh vs backdated CLAIMED and DISPATCHING rows correctly", async () => {
    const { org, invoice } = await setupTestInvoice("IT-SA Org 5", 6);
    try {
      // 5a. Fresh CLAIMED row: returned unchanged
      const claim1 = await claimSendAttempt(db, org.id, invoice.id);
      const recFreshClaim = await reconcileStaleAttempt(db, claim1.attempt);
      expect(recFreshClaim.id).toBe(claim1.attempt.id);
      expect(recFreshClaim.status).toBe("CLAIMED");

      // 5b. CLAIMED row backdated past STALE_CLAIM_MS (2 minutes): becomes FAILED
      await db.$client.query(
        "UPDATE invoice_send_attempts SET claimed_at = now() - interval '2 minutes' WHERE id = $1",
        [claim1.attempt.id]
      );
      const recStaleClaim = await reconcileStaleAttempt(db, claim1.attempt);
      expect(recStaleClaim.id).toBe(claim1.attempt.id);
      expect(recStaleClaim.status).toBe("FAILED");
      expect(recStaleClaim.errorCode).toBe("ABANDONED_BEFORE_DISPATCH");
      expect(recStaleClaim.completedAt).toBeInstanceOf(Date);

      // 5c. New claim succeeds since claim1 is FAILED
      const claim2 = await claimSendAttempt(db, org.id, invoice.id);
      expect(claim2.claimed).toBe(true);

      const dispatching = await markDispatching(db, claim2.attempt.id);
      // 5d. Fresh DISPATCHING row: returned unchanged
      const recFreshDispatch = await reconcileStaleAttempt(db, dispatching);
      expect(recFreshDispatch.id).toBe(claim2.attempt.id);
      expect(recFreshDispatch.status).toBe("DISPATCHING");

      // 5e. DISPATCHING row backdated past STALE_DISPATCH_MS (10 minutes): becomes UNKNOWN
      await db.$client.query(
        "UPDATE invoice_send_attempts SET dispatch_started_at = now() - interval '10 minutes' WHERE id = $1",
        [claim2.attempt.id]
      );
      const recStaleDispatch = await reconcileStaleAttempt(db, dispatching);
      expect(recStaleDispatch.id).toBe(claim2.attempt.id);
      expect(recStaleDispatch.status).toBe("UNKNOWN");
      expect(recStaleDispatch.errorCode).toBe("STALE_DISPATCH_NO_CONFIRMATION");
      expect(recStaleDispatch.completedAt).toBeInstanceOf(Date);
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("6. concurrent claimSendAttempt calls converge on exactly one winner via partial unique index", async () => {
    const { org, invoice } = await setupTestInvoice("IT-SA Org 6", 7);
    try {
      const [res1, res2] = await Promise.all([
        claimSendAttempt(db, org.id, invoice.id),
        claimSendAttempt(db, org.id, invoice.id),
      ]);

      const successCount = (res1.claimed ? 1 : 0) + (res2.claimed ? 1 : 0);
      expect(successCount).toBe(1);

      const winner = res1.claimed ? res1.attempt : res2.attempt;
      const loser = res1.claimed ? res2 : res1;

      expect(loser.claimed).toBe(false);
      expect(loser.attempt.id).toBe(winner.id);
      expect(loser.attempt.status).toBe("CLAIMED");
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });

  it("7. reconcileStaleAttempt does not overwrite row if it transitioned concurrently (TOCTOU safety)", async () => {
    const { org, invoice } = await setupTestInvoice("IT-SA Org 7", 8);
    try {
      // Claim an attempt
      const claim = await claimSendAttempt(db, org.id, invoice.id);
      expect(claim.claimed).toBe(true);

      // Backdate claimed_at past STALE_CLAIM_MS to make it look stale for CLAIMED
      await db.$client.query(
        "UPDATE invoice_send_attempts SET claimed_at = now() - interval '2 minutes' WHERE id = $1",
        [claim.attempt.id]
      );

      // Capture the stale-claimed snapshot observed at this time
      const [staleSnapshot] = await db
        .select()
        .from(invoiceSendAttempts)
        .where(eq(invoiceSendAttempts.id, claim.attempt.id))
        .limit(1);
      expect(staleSnapshot.status).toBe("CLAIMED");

      // Before calling reconcileStaleAttempt, the real owner makes progress and transitions to DISPATCHING
      const dispatching = await markDispatching(db, claim.attempt.id);
      expect(dispatching.status).toBe("DISPATCHING");

      // Call reconcileStaleAttempt with the stale-claimed snapshot captured earlier
      const result = await reconcileStaleAttempt(db, staleSnapshot);

      // Assert it does NOT incorrectly overwrite the now-DISPATCHING row back to FAILED;
      // it should return the row's actual current DISPATCHING state instead.
      expect(result.status).toBe("DISPATCHING");
      expect(result.id).toBe(claim.attempt.id);

      // Assert row in database remains DISPATCHING
      const [dbRow] = await db
        .select()
        .from(invoiceSendAttempts)
        .where(eq(invoiceSendAttempts.id, claim.attempt.id))
        .limit(1);
      expect(dbRow.status).toBe("DISPATCHING");
    } finally {
      await cleanupOrganization(db, org.id);
    }
  });
});
