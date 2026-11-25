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

  // A dots-only row menu says what it is, then its popover eases in.
  await page.goto(`${base}/dwellings?lang=en`);
  const trigger = page
    .locator('button.icon-btn[popovertarget^="dwelling-menu-"]')
    .first();
  await trigger.hover();
  await expect(page.locator("#app-tooltip[data-visible]")).toContainText(
    "More actions"
  );
  await trigger.click();
  await expect(page.locator(".case-menu:popover-open").first()).toHaveCSS(
    "animation-name",
    "panel-in"
  );
  await page.keyboard.press("Escape");

  // Opening the last row's menu never clips inside the table wrapper, and
  // widths across phone/tablet/desktop keep zero horizontal overflow.
  const lastTrigger = page
    .locator('button.icon-btn[popovertarget^="dwelling-menu-"]')
    .last();
  await lastTrigger.click();
  const lastMenuBox = await page
    .locator(".case-menu:popover-open")
    .first()
    .boundingBox();
  expect(lastMenuBox!.height).toBeGreaterThan(20);
  expect(lastMenuBox!.x).toBeGreaterThanOrEqual(0);
  expect(lastMenuBox!.y).toBeGreaterThanOrEqual(0);
  expect(lastMenuBox!.y + lastMenuBox!.height).toBeLessThanOrEqual(1000);
  await page.keyboard.press("Escape");

  // Cancelling Archive from inside the top-layer popover returns focus to
  // that row's More actions trigger.
  await lastTrigger.click();
  const openRowMenu = page.locator(".case-menu:popover-open").first();
  await expect(openRowMenu).toBeVisible();
  await openRowMenu.getByRole("button", { name: "Archive" }).click();
  const confirmDialog = page.locator("#confirm-dialog");
  await expect(confirmDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirmDialog).toBeHidden();
  await expect(lastTrigger).toBeFocused();

  for (const width of [390, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    );
    expect(overflow, `dwellings overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Settings rules keeps `.row-menu` inside `.table-wrap-visible` and eases open.
  await page.goto(`${base}/settings/rules?lang=en`);
  await page.locator(".row-menu > summary").first().click();
  await expect(page.locator(".row-menu[open] > div").first()).toHaveCSS(
    "animation-name",
    "panel-in"
  );

  // A settings card's chevron darkens on hover; like every icon in the
  // design system, it never moves.
  await page.goto(`${base}/settings?lang=en`);
  const card = page.locator(".settings-card").first();
  const chevron = card.locator(".settings-card-chevron");
  const restColor = await chevron.evaluate((el) => getComputedStyle(el).color);
  await card.hover();
  await expect(chevron).not.toHaveCSS("color", restColor);
  await expect(chevron).toHaveCSS("transform", "none");

  // Reduced motion turns all of it off.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${base}/dwellings?lang=en`);
  await page
    .locator('button.icon-btn[popovertarget^="dwelling-menu-"]')
    .first()
    .click();
  await expect(page.locator(".case-menu:popover-open").first()).toHaveCSS(
    "animation-name",
    "none"
  );
});
