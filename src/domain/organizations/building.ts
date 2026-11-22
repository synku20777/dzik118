// The dwellings page's building view: entrances, their floors and columns, and
// the slot each dwelling sits in. Purely visual, arranged by hand; billing
// never reads it. Saved whole: the page sends the full layout and it replaces
// the organization's previous one in one transaction.
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import {
  buildingEntrances,
  dwellingPlacements,
} from "../../db/schema/building";
import { dwellings } from "../../db/schema/dwellings";
import { organizations } from "../../db/schema/organizations";
import { recordAuditEvent } from "../../lib/logging/audit";
import { ValidationError } from "../errors";
import { compareDwellingNumbers } from "../periods/cases";

// The error messages below spell these numbers out so they can be translated.
export const BUILDING_LIMITS = {
  entrances: 20,
  floors: 60,
  columns: 24,
  nameLength: 60,
} as const;

export interface PlacementInput {
  dwellingId: string;
  // 0 is the ground floor.
  floor: number;
  // Column, left to right.
  slot: number;
}

export interface EntranceInput {
  name: string;
  floors: number;
  columns: number;
  placements: PlacementInput[];
}

export interface BuildingLayout {
  // False until an admin saves one: the page then shows autoLayout's result.
  saved: boolean;
  entrances: EntranceInput[];
}

export async function getBuildingLayout(
  db: DbOrTx,
  organizationId: string
): Promise<BuildingLayout> {
  // One query, so a read never mixes two saves' entrances and placements.
  const rows = await db
    .select({ entrance: buildingEntrances, placement: dwellingPlacements })
    .from(buildingEntrances)
    .leftJoin(
      dwellingPlacements,
      eq(dwellingPlacements.entranceId, buildingEntrances.id)
    )
    .where(eq(buildingEntrances.organizationId, organizationId))
    .orderBy(asc(buildingEntrances.position));
  if (rows.length === 0) return { saved: false, entrances: [] };
  const entrances = new Map<string, EntranceInput>();
  for (const { entrance, placement } of rows) {
    const entry = entrances.get(entrance.id) ?? {
      name: entrance.name,
      floors: entrance.floors,
      columns: entrance.columns,
      placements: [],
    };
    entrances.set(entrance.id, entry);
    if (placement) {
      const { dwellingId, floor, slot } = placement;
      entry.placements.push({ dwellingId, floor, slot });
    }
  }
  return { saved: true, entrances: [...entrances.values()] };
}

// The starting point before anything is saved: one entrance, the given
// dwellings in number order, `columns` per floor from the ground floor up.
export function autoLayout(
  apartments: { id: string; number: string }[],
  name: string,
  columns = 4
): EntranceInput {
  const ordered = [...apartments].sort((a, b) =>
    compareDwellingNumbers(a.number, b.number)
  );
  // A very large building gets wider floors, not more than the floor limit;
  // past the largest grid, the rest start in "Not placed".
  columns = Math.min(
    BUILDING_LIMITS.columns,
    Math.max(columns, Math.ceil(ordered.length / BUILDING_LIMITS.floors))
  );
  ordered.splice(columns * BUILDING_LIMITS.floors);
  return {
    name,
    floors: Math.max(1, Math.ceil(ordered.length / columns)),
    columns,
    placements: ordered.map((dwelling, index) => ({
      dwellingId: dwelling.id,
      floor: Math.floor(index / columns),
      slot: index % columns,
    })),
  };
}

// Shape checks that need no database: sizes, names, slots in range, no slot
// or dwelling used twice. Throws ValidationError with a message an admin can
// read.
export function validateBuildingLayout(entrances: EntranceInput[]) {
  if (entrances.length < 1 || entrances.length > BUILDING_LIMITS.entrances) {
    throw new ValidationError("A building has 1 to 20 entrances.");
  }
  const seen = new Set<string>();
  for (const entrance of entrances) {
    const name = entrance.name.trim();
    if (!name || name.length > BUILDING_LIMITS.nameLength) {
      throw new ValidationError("An entrance name has 1 to 60 characters.");
    }
    const whole = (n: number, max: number) =>
      Number.isInteger(n) && n >= 1 && n <= max;
    if (
      !whole(entrance.floors, BUILDING_LIMITS.floors) ||
      !whole(entrance.columns, BUILDING_LIMITS.columns)
    ) {
      throw new ValidationError(
        "An entrance has 1 to 60 floors and 1 to 24 places per floor."
      );
    }
    const slots = new Set<string>();
    for (const placement of entrance.placements) {
      if (
        !Number.isInteger(placement.floor) ||
        !Number.isInteger(placement.slot) ||
        placement.floor < 0 ||
        placement.slot < 0 ||
        placement.floor >= entrance.floors ||
        placement.slot >= entrance.columns
      ) {
        throw new ValidationError("A dwelling is placed outside its entrance.");
      }
      const slot = `${placement.floor}:${placement.slot}`;
      if (slots.has(slot)) {
        throw new ValidationError("Two dwellings share one place.");
      }
      slots.add(slot);
      if (seen.has(placement.dwellingId)) {
        throw new ValidationError("A dwelling is placed twice.");
      }
      seen.add(placement.dwellingId);
    }
  }
}

export async function saveBuildingLayout(
  db: Db,
  organizationId: string,
  entrances: EntranceInput[],
  actorUserId: string
) {
  validateBuildingLayout(entrances);
  const dwellingIds = entrances.flatMap((entrance) =>
    entrance.placements.map((placement) => placement.dwellingId)
  );
  return db.transaction(async (tx) => {
    // One save at a time per organization: two concurrent replacements could
    // otherwise both delete and both insert, leaving a mix of two layouts.
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .for("update");
    const before = await getBuildingLayout(tx, organizationId);
    if (dwellingIds.length) {
      const found = await tx
        .select({ id: dwellings.id })
        .from(dwellings)
        .where(
          and(
            eq(dwellings.organizationId, organizationId),
            isNull(dwellings.archivedAt),
            inArray(dwellings.id, dwellingIds)
          )
        );
      if (found.length !== dwellingIds.length) {
        throw new ValidationError(
          "A dwelling in the layout is archived or not in this organization."
        );
      }
    }
    // Replaced whole: placements go with their entrances (cascade).
    await tx
      .delete(buildingEntrances)
      .where(eq(buildingEntrances.organizationId, organizationId));
    const inserted = await tx
      .insert(buildingEntrances)
      .values(
        entrances.map((entrance, position) => ({
          organizationId,
          name: entrance.name.trim(),
          position,
          floors: entrance.floors,
          columns: entrance.columns,
        }))
      )
      .returning({ id: buildingEntrances.id });
    const placements = entrances.flatMap((entrance, index) =>
      entrance.placements.map((placement) => ({
        organizationId,
        entranceId: inserted[index].id,
        ...placement,
      }))
    );
    if (placements.length) {
      await tx.insert(dwellingPlacements).values(placements);
    }
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "BUILDING_LAYOUT_UPDATED",
      entityType: "organization",
      entityId: organizationId,
      // Whole layouts, so the log shows which dwelling moved where.
      beforeData: before.saved ? { entrances: before.entrances } : null,
      afterData: {
        entrances: entrances.map((entrance) => ({
          ...entrance,
          name: entrance.name.trim(),
        })),
      },
    });
    return { entrances: entrances.length, placed: placements.length };
  });
}

// Back to the automatic number-order layout.
export async function resetBuildingLayout(
  db: Db,
  organizationId: string,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .for("update");
    const before = await getBuildingLayout(tx, organizationId);
    await tx
      .delete(buildingEntrances)
      .where(eq(buildingEntrances.organizationId, organizationId));
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "BUILDING_LAYOUT_RESET",
      entityType: "organization",
      entityId: organizationId,
      beforeData: before.saved ? { entrances: before.entrances } : null,
    });
  });
}
