// Phase E (Periods/meters/readings) - one-off backfill for a fixed bug: a
// dwelling created after a period already existed never got a billing_case
// row in it (only createPeriod ever inserted cases, as a one-time snapshot
// of active dwellings at that moment). createDwelling/importDwellingsCsv now
// call syncCasesForDwelling() themselves going forward; this script covers
// dwellings created before that fix shipped.
//   DATABASE_URL=... vite-node scripts/backfill-dwelling-cases.ts
// Idempotent -- safe to re-run (onConflictDoNothing inside syncCasesForDwelling).
import { isNull } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { dwellings } from "../src/db/schema/dwellings";
import { syncCasesForDwelling } from "../src/domain/periods/periods";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for backfill:dwelling-cases");
}

const db = await createDb(databaseUrl);

const activeDwellings = await db
  .select({ id: dwellings.id, organizationId: dwellings.organizationId })
  .from(dwellings)
  .where(isNull(dwellings.archivedAt));

let createdCount = 0;
for (const dwelling of activeDwellings) {
  await db
    .transaction((tx) =>
      syncCasesForDwelling(tx, dwelling.organizationId, dwelling.id)
    )
    .then((count) => {
      createdCount += count;
    });
}

console.log(
  `Backfill complete: checked ${activeDwellings.length} dwellings, created ${createdCount} billing_case row(s).`
);
await db.$client.end();
