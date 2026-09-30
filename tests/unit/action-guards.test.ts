// ADR 0009: an archived organization is read-only. Every action that changes
// data must call requireActiveOrganization. The read guard is allowed only in
// the actions listed here. A new action that uses the read guard fails this
// test until a person adds it to the list on purpose.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ALLOWED_READ_GUARD_CALLS: Record<string, number> = {
  "organizations.ts": 2, // archive, restore (restore must work when archived)
  "messages.ts": 1, // getThread
  "mutations.ts": 1, // lookup
  "workbench.ts": 1, // getDrawerData
};

describe("action guards", () => {
  it("uses the read guard only in allowed read-only actions", () => {
    const dir = join(__dirname, "../../src/actions");
    const found: Record<string, number> = {};
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const count = (
        readFileSync(join(dir, file), "utf8").match(
          /requireOrganizationAccess\(/g
        ) ?? []
      ).length;
      if (count) found[file] = count;
    }
    expect(found).toEqual(ALLOWED_READ_GUARD_CALLS);
  });
});
