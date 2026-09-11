// Phase M (QA/security) - explicit cross-tenant/cross-resident attack tests
// (spec Section 33, 35 SEC-001/SEC-002, 47's Phase M brief: "cross-org UUID
// access; cross-resident UUID access; action tampering; invoice mutation;
// token leakage; duplicate bank processing"). authorization.test.ts (Phase
// C) already covers the requireOrganizationAccess/requireDwellingAccess
// guard primitives in isolation; this file exercises the real domain
// functions those guards protect, for every entity spec's SEC-001/SEC-002
// lists name, plus the other four attack categories. Requires a real
// Postgres and local Supabase Storage/SMTP stack (autoSendForOrganization-
// style dependencies) reachable via the env vars below.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../../src/db/client";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  requireDatabaseUrl,
  seedTestAdmin,
} from "./_helpers";
import { appUsers } from "../../src/db/schema/auth";
import { createOrganization } from "../../src/domain/organizations/organizations";
import {
  createDwelling,
  getDwelling,
} from "../../src/domain/organizations/dwellings";
import {
  createMeter,
  archiveMeter,
} from "../../src/domain/organizations/meters";
import { createPeriod, getPeriod } from "../../src/domain/periods/periods";
import { createRule } from "../../src/domain/billing/rules";
import {
  generateInvoice,
  getInvoice,
  getInvoiceForResident,
  prepareInvoice,
} from "../../src/domain/billing/generation";
import {
  sendInvoice,
  type SendInvoiceDeps,
} from "../../src/domain/billing/sending";
import {
  createInvoiceAccessToken,
  resolveInvoiceAccessToken,
  revokeInvoiceAccessTokens,
} from "../../src/domain/billing/invoice-tokens";
import {
  submitAdminReading,
  submitResidentReading,
} from "../../src/domain/periods/readings";
import { ConflictError, NotFoundError } from "../../src/domain/errors";
import {
  importBankCsv,
  ImportHeaderError,
} from "../../src/domain/payments/bank-import";
import { auditLogs } from "../../src/db/schema/audit";
import { invoiceAccessTokens } from "../../src/db/schema/invoices";
import { bankImports } from "../../src/db/schema/payments";
import { and, eq } from "drizzle-orm";
import { createSupabaseAdminClient } from "../../src/lib/supabase/admin";
import type { EmailService } from "../../src/lib/email/service";
import { hmacSha256Hex } from "../../src/lib/hash";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SECRET_KEY are required for integration tests"
  );
}
const supabaseAdmin = createSupabaseAdminClient(supabaseUrl, supabaseSecretKey);

function stubDeps(): SendInvoiceDeps {
  const email: EmailService = {
    sendInvoice: async () => ({
      success: true,
      provider: "smtp" as const,
      providerMessageId: "stub",
    }),
  };
  return {
    renderPdf: async () => new TextEncoder().encode("%PDF-1.4 stub"),
    supabaseAdmin,
    emailService: email,
    tokenSecret: "it-m-token-secret",
    appBaseUrl: "https://billing.example.test",
  };
}

let db: Db;
let seedAdminId: string;

// One shared two-tenant fixture: org A (dwellings A1/A2, each with a meter,
// resident, and a generated invoice) and org B (dwelling B1, meter,
// resident, invoice). Every SEC-001/SEC-002 test below reuses this instead
// of building its own -- the attack surface is "does org A's/dwelling A1's
// data leak to org B/dwelling A2", which only needs one fixture built once.
let orgA: Awaited<ReturnType<typeof createOrganization>>;
let orgB: Awaited<ReturnType<typeof createOrganization>>;
let dwellingA1: Awaited<ReturnType<typeof createDwelling>>;
let dwellingA2: Awaited<ReturnType<typeof createDwelling>>;
let dwellingB1: Awaited<ReturnType<typeof createDwelling>>;
let meterA1: Awaited<ReturnType<typeof createMeter>>;
let meterB1: Awaited<ReturnType<typeof createMeter>>;
let periodA: Awaited<ReturnType<typeof createPeriod>>;
let periodB: Awaited<ReturnType<typeof createPeriod>>;
let invoiceA1: Awaited<ReturnType<typeof generateInvoice>>;
let residentA1Id: string;
let residentA2Id: string;
let residentB1Id: string;

async function seedResident(email: string): Promise<string> {
  const id = randomUUID();
  await db
    .insert(appUsers)
    .values({ id, role: "RESIDENT", emailSnapshot: email });
  return id;
}

beforeAll(async () => {
  db = await createIntegrationDb();
  seedAdminId = await seedTestAdmin(db, "it-m-admin@example.com");

  orgA = await createOrganization(
    db,
    {
      name: "IT-M Org A",
      addressLine1: "Addr A",
      bankName: "Test Bank",
      iban: "LV00TEST0000000000000",
    },
    seedAdminId
  );
  orgB = await createOrganization(
    db,
    { name: "IT-M Org B", addressLine1: "Addr B" },
    seedAdminId
  );

  dwellingA1 = await createDwelling(
    db,
    orgA.id,
    {
      number: "A1",
      occupantName: "Resident A1",
      billingAddress: "1 Test St",
      billingEmail: "residenta1@example.com",
    },
    seedAdminId
  );
  dwellingA2 = await createDwelling(
    db,
    orgA.id,
    { number: "A2", occupantName: "Resident A2" },
    seedAdminId
  );
  dwellingB1 = await createDwelling(
    db,
    orgB.id,
    { number: "B1", occupantName: "Resident B1" },
    seedAdminId
  );

  meterA1 = await createMeter(
    db,
    orgA.id,
    dwellingA1.id,
    { type: "COLD_WATER", unit: "m3" },
    seedAdminId
  );
  meterB1 = await createMeter(
    db,
    orgB.id,
    dwellingB1.id,
    { type: "COLD_WATER", unit: "m3" },
    seedAdminId
  );

  periodA = await createPeriod(
    db,
    orgA.id,
    {
      year: 2026,
      month: 1,
      startsOn: "2026-01-01",
      endsOn: "2026-01-31",
      invoiceIssueDate: "2026-01-31",
      invoiceDueDate: "2026-02-14",
    },
    seedAdminId
  );
  periodB = await createPeriod(
    db,
    orgB.id,
    {
      year: 2026,
      month: 1,
      startsOn: "2026-01-01",
      endsOn: "2026-01-31",
      invoiceIssueDate: "2026-01-31",
      invoiceDueDate: "2026-02-14",
    },
    seedAdminId
  );

  await createRule(
    db,
    orgA.id,
    {
      name: "Fee",
      code: "fee",
      calculationType: "FIXED",
      unit: "month",
      unitPrice: "50.00",
      effectiveFrom: "2025-01-01",
    },
    seedAdminId
  );
  await createRule(
    db,
    orgB.id,
    {
      name: "Fee",
      code: "fee",
      calculationType: "FIXED",
      unit: "month",
      unitPrice: "50.00",
      effectiveFrom: "2025-01-01",
    },
    seedAdminId
  );

  // Both dwellings have a meter that existed before their period was
  // created, so a reading is required before generateInvoice will accept
  // the case (spec Section 16: MISSING_DATA blocks generation).
  await submitAdminReading(
    db,
    orgA.id,
    periodA.id,
    meterA1.id,
    "10.000",
    seedAdminId
  );
  await submitAdminReading(
    db,
    orgB.id,
    periodB.id,
    meterB1.id,
    "10.000",
    seedAdminId
  );

  invoiceA1 = await generateInvoice(
    db,
    orgA.id,
    periodA.id,
    dwellingA1.id,
    seedAdminId
  );
  await generateInvoice(db, orgB.id, periodB.id, dwellingB1.id, seedAdminId);

  residentA1Id = await seedResident("it-m-resident-a1@example.com");
  residentA2Id = await seedResident("it-m-resident-a2@example.com");
  residentB1Id = await seedResident("it-m-resident-b1@example.com");
});

afterAll(async () => {
  await cleanupOrganization(db, orgA.id);
  await cleanupOrganization(db, orgB.id);
  await deleteTestAdmin(db, seedAdminId);
  for (const id of [residentA1Id, residentA2Id, residentB1Id]) {
    await db.$client.query("delete from app_users where id = $1", [id]);
  }
  await db.$client.end();
});

describe("SEC-001: cross-tenant UUID access is denied for every listed entity", () => {
  it("dwelling: org B cannot read org A's dwelling by known UUID", async () => {
    await expect(
      getDwelling(db, orgB.id, dwellingA1.id)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("period: org B cannot read org A's period by known UUID", async () => {
    await expect(getPeriod(db, orgB.id, periodA.id)).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it("meter: org B cannot archive org A's meter by known UUID", async () => {
    await expect(
      archiveMeter(db, orgB.id, meterA1.id, seedAdminId)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reading: org B cannot submit against org A's period, even with org B's own (valid) meter", async () => {
    // periodA is foreign; meterB1 is genuinely orgB's own -- isolates the
    // period tenant check specifically (recordReading checks period before
    // meter, so a test pairing a foreign period with a foreign meter too
    // would pass even if the meter check were deleted).
    await expect(
      submitAdminReading(
        db,
        orgB.id,
        periodA.id,
        meterB1.id,
        "10.000",
        seedAdminId
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reading: org B cannot submit against org A's meter, even with org B's own (valid) period", async () => {
    // periodB is genuinely orgB's own; meterA1 is foreign -- isolates the
    // meter tenant check specifically, the mirror of the test above.
    await expect(
      submitAdminReading(
        db,
        orgB.id,
        periodB.id,
        meterA1.id,
        "10.000",
        seedAdminId
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("invoice: org B cannot read org A's invoice by known UUID", async () => {
    await expect(getInvoice(db, orgB.id, invoiceA1.id)).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  // Bank import and conversation cross-tenant isolation already have
  // dedicated, explicit tests in payments.test.ts ("getBankImport is
  // tenant-scoped") and messaging.test.ts ("SEC-001: an admin from a
  // different organization cannot reply to this conversation").
});

describe("SEC-002: cross-resident UUID access is denied for every listed entity", () => {
  // The canonical high-risk invoice-cross-resident check (spec's own named
  // scenario) is deliberately NOT here: at this point in the file invoiceA1
  // is still DRAFT, and generation.ts's getInvoiceForResident now also
  // hides non-issued (DRAFT/PREPARED) invoices from residents regardless of
  // dwelling. Asserting NotFoundError here would pass for that reason alone
  // and never actually exercise the dwelling check -- see the dedicated,
  // isolated re-check after the "Invoice mutation" describe below, once
  // invoiceA1 is genuinely SENT and that confound is gone.

  it("draft invoice: resident A1 cannot access an unissued (DRAFT) invoice for their own dwelling", async () => {
    await expect(
      getInvoiceForResident(db, invoiceA1.id, dwellingA1.id)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reading/meter: a resident cannot submit a reading for a meter belonging to a different dwelling", async () => {
    // dwellingA2's own resident submitting against meterA1 (dwellingA1's
    // meter) -- rejected as "meter not found" for THIS dwelling, not
    // forbidden, so the meter UUID's existence elsewhere isn't confirmed.
    await expect(
      submitResidentReading(
        db,
        dwellingA2.id,
        periodA.id,
        meterA1.id,
        "10.000",
        residentA2Id
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // Dwelling cross-resident denial is covered at the guard-primitive level
  // in authorization.test.ts (requireDwellingAccess); every resident page/
  // action calls that guard before ever reaching a dwelling-scoped domain
  // function (verified by reading every caller of getDwellingForResident/
  // getInvoiceForResident -- none skip it). Conversation cross-resident
  // isolation has its own dedicated test in messaging.test.ts (SEC-002).
});

describe("Action tampering: a valid actor's own org/dwelling with a foreign nested entity id", () => {
  it("admin A, real own org, but a period id belonging to org B: generateInvoice is denied, not misrouted", async () => {
    await expect(
      generateInvoice(db, orgA.id, periodB.id, dwellingA1.id, seedAdminId)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("admin A, real own org, but a dwelling id belonging to org B: generateInvoice is denied", async () => {
    await expect(
      generateInvoice(db, orgA.id, periodA.id, dwellingB1.id, seedAdminId)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("resident, real own dwelling and own meter, but a period id belonging to a different org: submitResidentReading is denied", async () => {
    await expect(
      submitResidentReading(
        db,
        dwellingA1.id,
        periodB.id,
        meterA1.id,
        "1.000",
        residentA1Id
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // The mirror case -- a resident's real own dwelling paired with a meter
  // id belonging to a same-org sibling dwelling -- is exactly the SEC-002
  // "reading/meter" test above (dwellingA2 + meterA1); not duplicated here.
});

describe("Invoice mutation: generation cannot be re-run past DRAFT", () => {
  it("cannot regenerate (mutate) an invoice once its case has moved to PREPARED", async () => {
    await prepareInvoice(db, orgA.id, invoiceA1.id, seedAdminId);
    await expect(
      generateInvoice(db, orgA.id, periodA.id, dwellingA1.id, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("cannot regenerate an invoice once its case has moved to SENT", async () => {
    await sendInvoice(db, orgA.id, invoiceA1.id, stubDeps(), seedAdminId);
    await expect(
      generateInvoice(db, orgA.id, periodA.id, dwellingA1.id, seedAdminId)
    ).rejects.toBeInstanceOf(ConflictError);
    // The already-sent invoice's own fields are provably unchanged --
    // Phase G's dedicated test ("Section 21 ... line amounts unchanged ...
    // PDF hash unchanged") covers the deeper snapshot-immutability proof;
    // this test only re-confirms the entry point into that mutation is
    // closed for a SENT case specifically.
  });

  it("SEC-002 (isolated): now that invoiceA1 is genuinely SENT, resident A2 knows resident A1's valid invoice UUID and is still denied (spec's canonical high-risk scenario)", async () => {
    await expect(
      getInvoiceForResident(db, invoiceA1.id, dwellingA2.id)
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Token leakage", () => {
  const secret = "it-m-token-secret";

  it("unknown, revoked, and expired tokens are all denied with the identical generic message", async () => {
    const revocableToken = await createInvoiceAccessToken(
      db,
      orgA.id,
      invoiceA1.id,
      secret,
      null,
      seedAdminId
    );
    await revokeInvoiceAccessTokens(db, orgA.id, invoiceA1.id, seedAdminId);

    const expiredToken = await createInvoiceAccessToken(
      db,
      orgA.id,
      invoiceA1.id,
      secret,
      new Date(Date.now() - 1000),
      seedAdminId
    );

    const unknown = await resolveInvoiceAccessToken(
      db,
      "not-a-real-token",
      secret
    ).catch((e) => e);
    const revoked = await resolveInvoiceAccessToken(
      db,
      revocableToken,
      secret
    ).catch((e) => e);
    const expired = await resolveInvoiceAccessToken(
      db,
      expiredToken,
      secret
    ).catch((e) => e);

    for (const err of [unknown, revoked, expired]) {
      expect(err).toBeInstanceOf(NotFoundError);
    }
    expect(revoked.message).toBe(unknown.message);
    expect(expired.message).toBe(unknown.message);
  });

  it("the raw token is never written to the audit log, and only its HMAC (never the raw value) is persisted as the token hash", async () => {
    const rawToken = await createInvoiceAccessToken(
      db,
      orgA.id,
      invoiceA1.id,
      secret,
      null,
      seedAdminId
    );

    const expectedHash = await hmacSha256Hex(secret, rawToken);
    const [tokenRow] = await db
      .select()
      .from(invoiceAccessTokens)
      .where(
        and(
          eq(invoiceAccessTokens.organizationId, orgA.id),
          eq(invoiceAccessTokens.tokenHash, expectedHash)
        )
      );
    expect(tokenRow).toBeDefined();
    expect(tokenRow.tokenHash).not.toBe(rawToken);

    const events = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, orgA.id),
          eq(auditLogs.action, "INVOICE_ACCESS_TOKEN_CREATED")
        )
      );
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const serialized = JSON.stringify(event);
      expect(serialized.includes(rawToken)).toBe(false);
      expect(serialized.includes(expectedHash)).toBe(false);
    }
  });
});

describe("Duplicate bank processing under concurrency", () => {
  it("two concurrent imports of the exact same file (separate connections) still produce exactly one bank_imports row", async () => {
    // A single `db` here has only one underlying pg Client (see db/client.ts),
    // so two calls against the SAME db just serialize on one connection --
    // the second would always see the first's row via the pre-check query
    // and never exercise the DB unique-constraint catch in importBankCsv at
    // all. Two separate connections (matching billing.test.ts's "concurrent
    // generation" and periods-meters-readings.test.ts's "concurrent first-
    // time submissions" pattern) let both requests race for real, though --
    // like those two existing tests -- which of the two rejection paths
    // (the pre-check, or the unique-constraint catch) actually fires is not
    // itself asserted; either is an acceptable outcome; what matters, and
    // what's actually asserted below, is the end state: exactly one row.
    const dbA = await createDb(requireDatabaseUrl());
    const dbB = await createDb(requireDatabaseUrl());
    const csv = "booking_date,amount,currency\n2026-01-15,10.00,EUR";
    const [first, second] = await Promise.allSettled([
      importBankCsv(dbA, orgA.id, "concurrent-a.csv", csv, seedAdminId),
      importBankCsv(dbB, orgA.id, "concurrent-b.csv", csv, seedAdminId),
    ]);
    await dbA.$client.end();
    await dbB.$client.end();

    const outcomes = [first, second];
    const succeeded = outcomes.filter((o) => o.status === "fulfilled");
    const failed = outcomes.filter((o) => o.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ImportHeaderError
    );

    const imports = await db
      .select()
      .from(bankImports)
      .where(eq(bankImports.organizationId, orgA.id));
    expect(imports).toHaveLength(1);
  });
});
