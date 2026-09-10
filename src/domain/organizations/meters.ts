// Phase E (Periods/meters/readings) - Meter CRUD (spec Section 13.6, MTR-001).
// Callers must call requireOrganizationAccess() before calling any of these,
// same convention as organizations.ts/dwellings.ts (spec Section 14).
import { and, eq } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import { meterTypeEnum, meters } from "../../db/schema/dwellings";
import { recordAuditEvent } from "../../lib/logging/audit";
import { recalculateCaseReadinessForOpenPeriods } from "../periods/case-readiness";
import { getDwelling, NotFoundError } from "./dwellings";

export { NotFoundError };

export interface CreateMeterInput {
  type: (typeof meterTypeEnum.enumValues)[number];
  serialNumber?: string;
  unit: string;
  label?: string;
  installedAt?: string;
}

// MTR-001: belongs to one dwelling, organization consistency enforced by
// the composite FK on meters(dwelling_id, organization_id) (spec Section
// 13.6) -- getDwelling here also confirms the dwelling itself is this org's.
export async function createMeter(
  db: Db,
  organizationId: string,
  dwellingId: string,
  input: CreateMeterInput,
  actorUserId: string
) {
  await getDwelling(db, organizationId, dwellingId);
  return db.transaction(async (tx) => {
    const [meter] = await tx
      .insert(meters)
      .values({ organizationId, dwellingId, ...input })
      .returning();
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "METER_CREATED",
      entityType: "meter",
      entityId: meter.id,
      afterData: meter,
    });
    await recalculateCaseReadinessForOpenPeriods(
      tx,
      organizationId,
      dwellingId
    );
    return meter;
  });
}

export async function listMeters(
  db: DbOrTx,
  organizationId: string,
  dwellingId: string
) {
  return db
    .select()
    .from(meters)
    .where(
      and(
        eq(meters.dwellingId, dwellingId),
        eq(meters.organizationId, organizationId)
      )
    )
    .orderBy(meters.createdAt);
}

// MTR-001: archived meter retained historically -- soft-delete only, same
// reasoning as archiveDwelling (spec Section 27).
export async function archiveMeter(
  db: Db,
  organizationId: string,
  meterId: string,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    const [meter] = await tx
      .update(meters)
      .set({ archivedAt: new Date() })
      .where(
        and(eq(meters.id, meterId), eq(meters.organizationId, organizationId))
      )
      .returning();
    if (!meter) throw new NotFoundError("Meter not found");
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "METER_ARCHIVED",
      entityType: "meter",
      entityId: meterId,
    });
    await recalculateCaseReadinessForOpenPeriods(
      tx,
      organizationId,
      meter.dwellingId
    );
    return meter;
  });
}
