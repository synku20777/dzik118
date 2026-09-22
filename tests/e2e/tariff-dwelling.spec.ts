import { test, expect, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "../../src/db/client";
import { appUsers } from "../../src/db/schema/auth";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import { createRule } from "../../src/domain/billing/rules";
import { createOrganization } from "../../src/domain/organizations/organizations";

// Read-only dwelling-side recurring tariff display + Tariffs & Rules deep
// linking. Uses the existing local seed admin, without modifying billing or
// financial records -- same convention as ui.spec.ts.
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const dbUrl = process.env.DATABASE_URL;

async function loginAdmin(page: Page): Promise<string> {
  await page.goto("/login");
  await page.locator("#admin-email").fill("admin.a@example.com");
  await page.locator("#admin-password").fill("ChangeMe123!");
  await page.locator("#admin-login-form button").click();
  await page.waitForURL(/\/admin\/o\/.+\/dashboard/);
  return new URL(page.url()).pathname.replace(/\/dashboard$/, "");
}

async function cleanup(
  db: Db,
  ruleIds: string[],
  dwellingIds: string[]
): Promise<void> {
  await db.$client.query("set session_replication_role = replica");
  try {
    for (const ruleId of ruleIds) {
      await db.$client.query(
        "delete from billing_rule_assignments where billing_rule_id = $1",
        [ruleId]
      );
      await db.$client.query(
        "delete from manual_rule_inputs where billing_rule_id = $1",
        [ruleId]
      );
      await db.$client.query("delete from billing_rules where id = $1", [
        ruleId,
      ]);
    }
    for (const dwellingId of dwellingIds) {
      await db.$client.query(
        "delete from billing_cases where dwelling_id = $1",
        [dwellingId]
      );
      await db.$client.query("delete from dwellings where id = $1", [
        dwellingId,
      ]);
    }
  } finally {
    await db.$client.query("set session_replication_role = default");
  }
}

test("recurring tariffs: dwelling page is read-only, unassigned selective tariffs stay hidden, and deep-linking to Tariffs & Rules works", async ({
  page,
}) => {
  if (!dbUrl) {
    throw new Error("DATABASE_URL is required for this test's DB seeding");
  }
  const db = await createDb(dbUrl);
  const ruleIds: string[] = [];
  const dwellingIds: string[] = [];

  try {
    const base = await loginAdmin(page);
    const orgId = base.replace("/admin/o/", "");

    const [adminUser] = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.emailSnapshot, "admin.a@example.com"))
      .limit(1);
    expect(adminUser).toBeDefined();
    const adminUserId = adminUser.id;

    const stamp = Date.now();
    const dwellingA = await createDwelling(
      db,
      orgId,
      { number: `E2E-TAR-A-${stamp}`, areaM2: "40.00", residentCount: 2 },
      adminUserId
    );
    const dwellingB = await createDwelling(
      db,
      orgId,
      { number: `E2E-TAR-B-${stamp}`, areaM2: "40.00", residentCount: 2 },
      adminUserId
    );
    dwellingIds.push(dwellingA.id, dwellingB.id);

    const allRule = await createRule(
      db,
      orgId,
      {
        name: `E2E Management fee ${stamp}`,
        code: `e2e_mgmt_${stamp}`,
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "9.99",
        effectiveFrom: "2020-01-01",
      },
      adminUserId
    );
    const manyRule = await createRule(
      db,
      orgId,
      {
        name: `E2E Parking ${stamp}`,
        code: `e2e_parking_${stamp}`,
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "15.00",
        effectiveFrom: "2020-01-01",
        applicationScope: "ONE_TO_MANY",
        dwellingIds: [dwellingA.id],
      },
      adminUserId
    );
    const oneRule = await createRule(
      db,
      orgId,
      {
        name: `E2E Board parking ${stamp}`,
        code: `e2e_board_parking_${stamp}`,
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "0",
        effectiveFrom: "2020-01-01",
        applicationScope: "ONE_TO_ONE",
        dwellingIds: [dwellingA.id],
      },
      adminUserId
    );
    const otherManyRule = await createRule(
      db,
      orgId,
      {
        name: `E2E Storage ${stamp}`,
        code: `e2e_storage_${stamp}`,
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "3.00",
        effectiveFrom: "2020-01-01",
        applicationScope: "ONE_TO_MANY",
        dwellingIds: [dwellingB.id],
      },
      adminUserId
    );
    ruleIds.push(allRule.id, manyRule.id, oneRule.id, otherManyRule.id);

    // ---- SCENARIO 1: dwelling A shows all three applicable tariffs,
    // read-only (no Manage tariffs button, no assignment checkboxes). ----
    await page.goto(`${base}/dwellings/${dwellingA.id}`);
    const tariffsPanel = page.locator("#tariffs");
    await expect(tariffsPanel.getByText(allRule.name)).toBeVisible();
    await expect(tariffsPanel.getByText(manyRule.name)).toBeVisible();
    await expect(tariffsPanel.getByText(oneRule.name)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /manage tariffs/i })
    ).toHaveCount(0);
    await expect(tariffsPanel.locator('input[type="checkbox"]')).toHaveCount(0);
    // Zero-price ONE_TO_ONE tariff must display a real formatted amount
    // ("€0.00"-shaped), not a blank, an omitted price, or a raw dash.
    const boardParkingRow = tariffsPanel
      .locator("li")
      .filter({ hasText: oneRule.name });
    await expect(boardParkingRow).not.toContainText("—");
    await expect(boardParkingRow).toContainText(/0[.,]00/);

    // ---- SCENARIO 2: dwelling A never shows a selective tariff assigned
    // only to dwelling B. ----
    await expect(tariffsPanel.getByText(otherManyRule.name)).toHaveCount(0);

    // ---- SCENARIO 3: "Edit tariff" deep-links to Tariffs & Rules and
    // opens the exact tariff's drawer automatically. ----
    await tariffsPanel
      .locator("li", { hasText: manyRule.name })
      .getByRole("link", { name: /edit tariff/i })
      .click();
    await page.waitForURL(new RegExp(`/settings/rules\\?edit=${manyRule.id}$`));
    const drawer = page.locator("#tariff-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.locator("#tariff-name")).toHaveValue(manyRule.name);
    await expect(drawer.locator("#tariff-code")).toHaveValue(manyRule.code);

    // ---- SCENARIO 4: closing the drawer strips ?edit= from the URL. ----
    await drawer.getByRole("button", { name: /cancel/i }).click();
    await expect(drawer).toBeHidden();
    await expect(page).toHaveURL(/\/settings\/rules$/);

    // ---- SCENARIO 5: deep link again, then browser Back returns to the
    // dwelling page with no broken modal state. ----
    await page.goto(`${base}/dwellings/${dwellingA.id}`);
    await page
      .locator("#tariffs")
      .locator("li", { hasText: manyRule.name })
      .getByRole("link", { name: /edit tariff/i })
      .click();
    await page.waitForURL(new RegExp(`/settings/rules\\?edit=${manyRule.id}$`));
    await expect(page.locator("#tariff-drawer")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/dwellings/${dwellingA.id}$`));
    // The dialog element belongs to the rules page, which Back navigated
    // away from entirely -- it must not still be present/open.
    await expect(page.locator("#tariff-drawer")).toHaveCount(0);
  } finally {
    await cleanup(db, ruleIds, dwellingIds);
    await db.$client.end();
  }
});

test("an invalid ?edit= id is ignored safely, and a cross-organization id is never opened", async ({
  page,
}) => {
  if (!dbUrl) {
    throw new Error("DATABASE_URL is required for this test's DB seeding");
  }
  const db = await createDb(dbUrl);
  let foreignOrgId: string | null = null;
  let foreignRuleId: string | null = null;
  try {
    const base = await loginAdmin(page);

    const response = await page.goto(
      `${base}/settings/rules?edit=00000000-0000-0000-0000-000000000000`
    );
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator("#tariff-drawer")).toBeHidden();
    await expect(page.locator("main h1, main .font-display")).toBeVisible();

    // A real, existing rule id -- just belonging to a DIFFERENT org -- must
    // be just as inert as a nonexistent one. Not a member of this org, but
    // createOrganization only needs an actor id for its audit event, not
    // membership, so the seeded admin's id works fine as that actor here.
    const [adminUser] = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.emailSnapshot, "admin.a@example.com"))
      .limit(1);
    const foreignOrg = await createOrganization(
      db,
      { name: `E2E Foreign Org ${Date.now()}`, addressLine1: "Addr 1" },
      adminUser.id
    );
    foreignOrgId = foreignOrg.id;
    const foreignRule = await createRule(
      db,
      foreignOrg.id,
      {
        name: "Foreign org rule",
        code: `e2e_foreign_${Date.now()}`,
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "5.00",
        effectiveFrom: "2020-01-01",
      },
      adminUser.id
    );
    foreignRuleId = foreignRule.id;

    await page.goto(`${base}/settings/rules?edit=${foreignRuleId}`);
    await expect(page.locator("#tariff-drawer")).toBeHidden();
  } finally {
    if (foreignRuleId) {
      await db.$client.query("delete from billing_rules where id = $1", [
        foreignRuleId,
      ]);
    }
    if (foreignOrgId) {
      await db.$client.query(
        "delete from audit_logs where organization_id = $1",
        [foreignOrgId]
      );
      await db.$client.query(
        "delete from organization_memberships where organization_id = $1",
        [foreignOrgId]
      );
      await db.$client.query("delete from organizations where id = $1", [
        foreignOrgId,
      ]);
    }
    await db.$client.end();
  }
});
