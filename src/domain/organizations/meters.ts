// Phase E (Periods/meters/readings) - Meter CRUD (spec Section 13.6, MTR-001).
// Callers must call requireOrganizationAccess() before calling any of these,
// same convention as organizations.ts/dwellings.ts (spec Section 14).
import { and, eq } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import { meterReadings } from "../../db/schema/billing";
import { meterTypeEnum, meters } from "../../db/schema/dwellings";
import { recordAuditEvent } from "../../lib/logging/audit";
import { recalculateCaseReadinessForOpenPeriods } from "../periods/case-readiness";
import { getDwelling } from "./dwellings";
import { ConflictError, NotFoundError } from "../errors";
import {
  claimMutationReceipt,
  completeMutationReceipt,
} from "../mutations/receipts";

export { ConflictError, NotFoundError };

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
  actorUserId: string,
  clientMutationId: string = crypto.randomUUID()
) {
  await getDwelling(db, organizationId, dwellingId);
  return db.transaction(async (tx) => {
    const identity = {
      organizationId,
      clientMutationId,
      operation: "meter.create",
      entityType: "meter" as const,
      scopeId: dwellingId,
    };
    const { replayed, receipt } = await claimMutationReceipt(tx, identity);
    if (replayed) {
      const [existing] = receipt.entityId
        ? await tx
            .select()
            .from(meters)
            .where(
              and(
                eq(meters.organizationId, organizationId),
                eq(meters.id, receipt.entityId)
              )
            )
            .limit(1)
        : [];
      if (!existing)
        throw new NotFoundError("The original meter is no longer present");
      return existing;
    }

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
    await completeMutationReceipt(tx, identity, meter.id);
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

export interface UpdateMeterInput {
  serialNumber?: string | null;
  unit?: string;
  label?: string | null;
  installedAt?: string | null;
}

export async function updateMeter(
  db: Db,
  organizationId: string,
  meterId: string,
  input: UpdateMeterInput,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(meters)
      .where(
        and(eq(meters.id, meterId), eq(meters.organizationId, organizationId))
      )
      .for("update");
    if (!before) throw new NotFoundError("Meter not found");
    if (before.archivedAt) {
      throw new ConflictError("An archived meter cannot be edited");
    }

    if (input.unit !== undefined && input.unit !== before.unit) {
      const [reading] = await tx
        .select({ id: meterReadings.id })
        .from(meterReadings)
        .where(eq(meterReadings.meterId, meterId))
        .limit(1);
      if (reading) {
        throw new ConflictError(
          "The unit cannot change after readings exist. Archive this meter and add a new one."
        );
      }
    }

    const patch: Partial<typeof meters.$inferInsert> = {};
    if (input.serialNumber !== undefined)
      patch.serialNumber = input.serialNumber;
    if (input.unit !== undefined) patch.unit = input.unit;
    if (input.label !== undefined) patch.label = input.label;
    if (input.installedAt !== undefined) patch.installedAt = input.installedAt;

    const [after] = await tx
      .update(meters)
      .set(patch)
      .where(
        and(eq(meters.id, meterId), eq(meters.organizationId, organizationId))
      )
      .returning();

    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "METER_UPDATED",
      entityType: "meter",
      entityId: meterId,
      beforeData: before,
      afterData: after,
    });
    return after;
  });
}
