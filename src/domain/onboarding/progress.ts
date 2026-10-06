// Setup progress (ADR 0012). Everything is derived from saved data and
// computed live; nothing records that a step was visited, so a step is done
// only when its configuration really exists. Read-only.
// Callers must call requireOrganizationAccess() first.
import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../../db/client";
import { billingCases } from "../../db/schema/billing";
import { dwellings } from "../../db/schema/dwellings";
import { invoices } from "../../db/schema/invoices";
import { getEffectiveRules } from "../billing/rules";
import { getOrganization } from "../organizations/organizations";
import {
  resolveInvoiceEligibilityForDwellings,
  type MissingDataItem,
} from "../periods/case-readiness";
import { listOpeningReadings } from "../periods/opening-readings";
import { getFirstBillingPeriod } from "../periods/periods";

export type SetupStepKey =
  "organization" | "dwellings" | "period" | "charges" | "meters";

export interface SetupProgress {
  steps: Record<SetupStepKey, boolean>;
  // Steps 1-5 are done. Not the same as "ready to generate".
  complete: boolean;
  firstPeriodId: string | null;
  firstPeriodLocked: boolean;
  dwellingCount: number;
  // Live blockers of the first period's cases, counted by reason.
  blockers: Partial<Record<MissingDataItem["reason"], number>>;
  dwellingsWithoutCase: number;
  metersWithoutStartingReading: number;
  readyToGenerate: boolean;
  // Invoice issuer data that prepareInvoice requires.
  issuerMissing: string[];
  recipientsIncomplete: number;
  billingEmailsMissing: number;
}

// `loadedOrg`: pass the organization row a page already read, to save a query.
export async function getSetupProgress(
  db: Db,
  organizationId: string,
  loadedOrg?: Awaited<ReturnType<typeof getOrganization>>
): Promise<SetupProgress> {
  const org = loadedOrg ?? (await getOrganization(db, organizationId));
  const activeDwellings = await db
    .select()
    .from(dwellings)
    .where(
      and(
        eq(dwellings.organizationId, organizationId),
        isNull(dwellings.archivedAt)
      )
    );
  const first = await getFirstBillingPeriod(db, organizationId);

  const blockers: SetupProgress["blockers"] = {};
  let dwellingsWithoutCase = 0;
  let metersWithoutStartingReading = 0;
  let hasRules = false;
  if (first) {
    hasRules = (await getEffectiveRules(db, organizationId, first)).length > 0;
    const caseRows = await db
      .select({ dwellingId: billingCases.dwellingId })
      .from(billingCases)
      .where(eq(billingCases.periodId, first.id));
    const withCase = new Set(caseRows.map((c) => c.dwellingId));
    const opening = new Set(
      (await listOpeningReadings(db, organizationId)).map((r) => r.meterId)
    );
    const withCaseIds = activeDwellings
      .filter((d) => withCase.has(d.id))
      .map((d) => d.id);
    dwellingsWithoutCase = activeDwellings.length - withCaseIds.length;
    // One batch of queries for every dwelling, not one set per dwelling.
    const eligibility = await resolveInvoiceEligibilityForDwellings(
      db,
      organizationId,
      withCaseIds,
      first.id,
      first
    );
    for (const id of withCaseIds) {
      const result = eligibility.get(id)!;
      for (const b of result.blockers) {
        blockers[b.reason] = (blockers[b.reason] ?? 0) + 1;
      }
      metersWithoutStartingReading += result.requiredMeterIds.filter(
        (id) => !opening.has(id)
      ).length;
    }
  }

  const steps: Record<SetupStepKey, boolean> = {
    organization: Boolean(org.name?.trim() && org.addressLine1?.trim()),
    dwellings: activeDwellings.length > 0,
    // Rule and meter changes only recalculate OPEN periods. Every active
    // dwelling must have a case in it, or it gets no first invoice.
    period:
      Boolean(first) && first!.status === "OPEN" && dwellingsWithoutCase === 0,
    charges: hasRules && !blockers.NO_APPLICABLE_RULES,
    meters:
      Boolean(first) &&
      !blockers.NO_ACTIVE_METER_FOR_RULE &&
      metersWithoutStartingReading === 0,
  };

  const issuerMissing = (
    [
      ["name", org.name],
      ["address", org.addressLine1],
      ["bank name", org.bankName],
      ["IBAN", org.iban],
    ] as const
  )
    .filter(([, value]) => !value?.trim())
    .map(([label]) => label);

  const totalBlockers = Object.values(blockers).reduce((a, b) => a + b, 0);
  return {
    steps,
    complete: Object.values(steps).every(Boolean),
    firstPeriodId: first?.id ?? null,
    firstPeriodLocked: first?.status === "LOCKED",
    dwellingCount: activeDwellings.length,
    blockers,
    dwellingsWithoutCase,
    metersWithoutStartingReading,
    readyToGenerate:
      Boolean(first) &&
      activeDwellings.length > 0 &&
      dwellingsWithoutCase === 0 &&
      totalBlockers === 0,
    issuerMissing,
    recipientsIncomplete: activeDwellings.filter(
      (d) => !(d.billingName || d.occupantName) || !d.billingAddress
    ).length,
    billingEmailsMissing: activeDwellings.filter(
      (d) => d.invoiceByEmail && !d.billingEmail
    ).length,
  };
}

// For the dashboard card: an organization that has sent an invoice is past
// setup, which also keeps the full check off busy dashboards. A draft does
// not count. Returns the progress once, so the page never calculates it twice;
// it is null when setup is over.
export async function getSetupStatus(
  db: Db,
  organizationId: string,
  loadedOrg?: Awaited<ReturnType<typeof getOrganization>>
): Promise<{ complete: boolean; progress: SetupProgress | null }> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        isNotNull(invoices.sentAt)
      )
    );
  if (n > 0) return { complete: true, progress: null };
  const progress = await getSetupProgress(db, organizationId, loadedOrg);
  return progress.complete
    ? { complete: true, progress: null }
    : { complete: false, progress };
}
