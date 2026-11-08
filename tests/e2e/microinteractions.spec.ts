import { expect, test } from "@playwright/test";

test("dwellings and settings: dots menus get tooltips and ease open, cards ease on hover", async ({
  page,
}) => {
  await page.goto("/login?lang=en");
  await page.locator("#admin-email").fill("admin.a@example.com");
  await page.locator("#admin-password").fill("ChangeMe123!");
  await page.locator("#admin-login-form button").click();
  await page.waitForURL(/\/admin\/(organizations|o\/.+\/dashboard)/);
  if (new URL(page.url()).pathname === "/admin/organizations") {
    await page.locator('main a[href$="/dashboard"]').first().click();
    await page.waitForURL(/\/dashboard/);
  }
  const base = new URL(page.url()).pathname.replace(/\/dashboard$/, "");
  await page.setViewportSize({ width: 1440, height: 1000 });

  // A dots-only row menu says what it is, then its panel eases in.
  await page.goto(`${base}/dwellings?lang=en`);
  const trigger = page.locator(".row-menu > summary").first();
  await trigger.hover();
  await expect(page.locator("#app-tooltip[data-visible]")).toContainText(
    "More actions"
  );
  await trigger.click();
  await expect(page.locator(".row-menu[open] > div").first()).toHaveCSS(
    "animation-name",
    "panel-in"
  );

  // A settings card's chevron leans toward the destination on hover.
  await page.goto(`${base}/settings?lang=en`);
  const card = page.locator(".settings-card").first();
  const chevron = card.locator(".settings-card-chevron");
  await expect(chevron).toHaveCSS("transform", "none");
  await card.hover();
  await expect(chevron).not.toHaveCSS("transform", "none");

  // Reduced motion turns all of it off.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${base}/dwellings?lang=en`);
  await page.locator(".row-menu > summary").first().click();
  await expect(page.locator(".row-menu[open] > div").first()).toHaveCSS(
    "animation-name",
    "none"
  );
});
