// The building view's saved arrangement: round trip, guards and reset.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/client";
import {
  cleanupOrganization,
  createIntegrationDb,
  deleteTestAdmin,
  seedTestAdmin,
} from "./_helpers";
import { createOrganization } from "../../src/domain/organizations/organizations";
import {
  archiveDwelling,
  createDwelling,
} from "../../src/domain/organizations/dwellings";
import {
  getBuildingLayout,
  resetBuildingLayout,
  saveBuildingLayout,
} from "../../src/domain/organizations/building";
import { ValidationError } from "../../src/domain/errors";

let db: Db;
let adminId: string;

beforeAll(async () => {
  db = await createIntegrationDb();
  adminId = await seedTestAdmin(db, "it-building-admin@example.com");
});

afterAll(async () => {
  await deleteTestAdmin(db, adminId);
  await db.$client.end();
});

describe("building layout", () => {
  it("saves, reads back, refuses foreign or archived dwellings, and resets", async () => {
    const org = await createOrganization(
      db,
      { name: "IT-Building", addressLine1: "Addr" },
      adminId
    );
    const other = await createOrganization(
      db,
      { name: "IT-Building other", addressLine1: "Addr" },
      adminId
    );
    try {
      const [d1, d2, d3] = [
        await createDwelling(db, org.id, { number: "1" }, adminId),
        await createDwelling(db, org.id, { number: "2" }, adminId),
        await createDwelling(db, org.id, { number: "3" }, adminId),
      ];
      const foreign = await createDwelling(
        db,
        other.id,
        { number: "1" },
        adminId
      );

      expect(await getBuildingLayout(db, org.id)).toEqual({
        saved: false,
        entrances: [],
      });

      const layout = [
        {
          name: " House 1 - A ",
          floors: 2,
          columns: 2,
          placements: [
            { dwellingId: d1.id, floor: 0, slot: 0 },
            { dwellingId: d2.id, floor: 1, slot: 1 },
          ],
        },
        {
          name: "House 1 - B",
          floors: 1,
          columns: 1,
          placements: [{ dwellingId: d3.id, floor: 0, slot: 0 }],
        },
      ];
      await saveBuildingLayout(db, org.id, layout, adminId);
      const saved = await getBuildingLayout(db, org.id);
      expect(saved.saved).toBe(true);
      expect(saved.entrances.map((e) => e.name)).toEqual([
        "House 1 - A",
        "House 1 - B",
      ]);
      expect(saved.entrances[0].placements).toHaveLength(2);
      expect(saved.entrances[1].placements).toEqual([
        { dwellingId: d3.id, floor: 0, slot: 0 },
      ]);

      // Saving again replaces the whole layout.
      await saveBuildingLayout(
        db,
        org.id,
        [{ name: "A", floors: 1, columns: 3, placements: [] }],
        adminId
      );
      expect((await getBuildingLayout(db, org.id)).entrances).toEqual([
        { name: "A", floors: 1, columns: 3, placements: [] },
      ]);

      // Another organization's dwelling, or an archived one, is refused, and
      // the saved layout stays as it was.
      const place = (dwellingId: string) => [
        {
          name: "A",
          floors: 1,
          columns: 1,
          placements: [{ dwellingId, floor: 0, slot: 0 }],
        },
      ];
      await expect(
        saveBuildingLayout(db, org.id, place(foreign.id), adminId)
      ).rejects.toThrow(ValidationError);
      await archiveDwelling(db, org.id, d1.id, adminId);
      await expect(
        saveBuildingLayout(db, org.id, place(d1.id), adminId)
      ).rejects.toThrow(ValidationError);
      expect((await getBuildingLayout(db, org.id)).entrances[0].columns).toBe(
        3
      );

      const audit = await db.$client.query(
        "select action, before_data, after_data from audit_logs where organization_id = $1 and action like 'BUILDING_%' order by created_at",
        [org.id]
      );
      expect(audit.rows.map((r) => r.action)).toEqual([
        "BUILDING_LAYOUT_UPDATED",
        "BUILDING_LAYOUT_UPDATED",
      ]);
      // The log shows where each dwelling was and where it went.
      expect(audit.rows[0].before_data).toBeNull();
      expect(audit.rows[0].after_data.entrances[1].placements).toEqual([
        { dwellingId: d3.id, floor: 0, slot: 0 },
      ]);
      expect(audit.rows[1].before_data.entrances[1].placements).toEqual([
        { dwellingId: d3.id, floor: 0, slot: 0 },
      ]);

      await resetBuildingLayout(db, org.id, adminId);
      expect((await getBuildingLayout(db, org.id)).saved).toBe(false);
    } finally {
      await cleanupOrganization(db, org.id);
      await cleanupOrganization(db, other.id);
    }
  });
});
