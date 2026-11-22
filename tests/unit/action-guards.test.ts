// ADR 0009: an archived organization is read-only. orgAction refuses an
// archived organization unless the action says allowArchived, which is
// allowed only in the actions listed here. A new action that allows it fails
// this test until a person adds it to the list on purpose.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ALLOWED_ARCHIVED_ACTIONS: Record<string, number> = {
  "organizations.ts": 2, // archive, restore (restore must work when archived)
  "invoice-templates.ts": 1, // previewLines (read-only sample charges for the editor preview)
  "messages.ts": 1, // getThread
  "mutations.ts": 1, // lookup
  "workbench.ts": 1, // getDrawerData
};

const dir = join(__dirname, "../../src/actions");
const actionFiles = readdirSync(dir).filter(
  (f) => f.endsWith(".ts") && !f.startsWith("_")
);

describe("action guards", () => {
  it("allows an archived organization only in the listed actions", () => {
    const found: Record<string, number> = {};
    for (const file of actionFiles) {
      const source = readFileSync(join(dir, file), "utf8");
      // The read guard is only reachable through orgAction's allowArchived.
      expect(source).not.toContain("requireOrganizationAccess(");
      const count = (source.match(/allowArchived: true/g) ?? []).length;
      if (count) found[file] = count;
    }
    expect(found).toEqual(ALLOWED_ARCHIVED_ACTIONS);
  });

  // The guided setup and the reading grid change data, so each must use the
  // write guard.
  it("guards every setup action and the batch reading action", () => {
    const onboarding = readFileSync(join(dir, "onboarding.ts"), "utf8");
    const actions = onboarding.split(/: (?:define|org)Action\(/).slice(1);
    expect(actions.length).toBeGreaterThan(0);
    expect(onboarding).not.toContain("defineAction(");
    expect(onboarding).not.toContain("allowArchived");
    const batch = readFileSync(join(dir, "readings.ts"), "utf8")
      .split("adminSubmitBatch: orgAction(")[1]
      .split(/(?:define|org)Action\(/)[0];
    expect(batch).toBeDefined();
    expect(batch).not.toContain("allowArchived");
  });
});
