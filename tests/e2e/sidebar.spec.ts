import { expect, test } from "@playwright/test";

test("sidebar: one nav, one account block, motion only when the section changes", async ({
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
  await page.goto(`${base}/payments?lang=en`);

  const sidebar = page.locator(".admin-sidebar");
  // The admin guide is an item of the same navigation, not a one-off link.
  const nav = sidebar.getByRole("navigation", { name: "Navigation" });
  await expect(nav.locator("a")).toHaveCount(7);
  await expect(nav.locator(`a[href="${base}/guide"]`)).toBeVisible();
  await expect(
    nav.locator('a[aria-current="page"]'),
    "exactly one active item"
  ).toHaveCount(1);

  // Account: who, language, theme, sign out.
  const account = sidebar.getByRole("group", { name: "Account" });
  await expect(account.locator(".account-email")).toHaveText(
    "admin.a@example.com"
  );
  const language = account.getByRole("group", { name: "Language" });
  await expect(language.locator("[aria-current]")).toHaveText("EN");
  await expect(language.locator("a")).toHaveCount(2);
  for (const control of [
    language.locator("a").first(),
    account.locator("[data-theme-toggle]"),
    account.getByRole("button", { name: "Sign out" }),
  ]) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }

  // Arriving at a new section marks its item; staying in one does not. The
  // first step is a client-side navigation inside Payments.
  const active = nav.locator('a[aria-current="page"]');
  await expect(active).not.toHaveAttribute("data-arrived", "");
  await page.locator('main a[href$="/payments/import"]').first().click();
  await page.waitForURL(/\/payments\/import/);
  await expect(active).toHaveAttribute("href", `${base}/payments`);
  await expect(active).not.toHaveAttribute("data-arrived", "");
  await nav.locator(`a[href="${base}/periods"]`).click();
  await expect(nav.locator(`a[href="${base}/periods"]`)).toHaveAttribute(
    "data-arrived",
    ""
  );

  // Reduced motion: nothing animates.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await nav.locator(`a[href="${base}/dwellings"]`).click();
  await expect(
    page.locator(".admin-sidebar .app-nav a[data-arrived]")
  ).toHaveCSS("animation-name", "none");
});

test("organization menu floats; tooltips only where words are missing; dashboard starts at the breadcrumbs", async ({
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

  // The dashboard starts on the breadcrumbs' left edge, even on a wide screen.
  await page.setViewportSize({ width: 2400, height: 1000 });
  await page.goto(`${base}/dashboard?lang=en`);
  const crumbs = (await page.locator(".crumbs").boundingBox())!;
  const content = (await page.locator(".dashboard-page").boundingBox())!;
  expect(Math.abs(crumbs.x - content.x)).toBeLessThan(1);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/payments?lang=en`);
  const sidebar = page.locator(".admin-sidebar");

  // The organization menu opens over the navigation, not into it.
  const switcher = sidebar.locator(".organization-switcher");
  const firstItem = sidebar.locator(".app-nav a").first();
  const before = (await firstItem.boundingBox())!;
  await switcher.locator("summary").click();
  const menu = switcher.locator(".organization-menu");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS("position", "absolute");
  expect((await firstItem.boundingBox())!.y).toBe(before.y);
  await page.waitForTimeout(350);
  const covers = await menu.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      r.x + r.width / 2,
      r.y + r.height / 2
    );
    return !!hit && el.contains(hit);
  });
  expect(covers).toBe(true);
  // Closing plays out, then the menu is gone.
  await switcher.locator("summary").click();
  await expect(switcher).not.toHaveAttribute("open", "");
  await expect(menu).toBeHidden();

  // Tooltips: icon-only and abbreviated controls get one, labelled ones do not.
  const tip = page.locator("#app-tooltip[data-visible]");
  await sidebar.locator("[data-theme-toggle]").hover();
  await expect(tip).toHaveText("Switch to dark theme");
  await sidebar.locator(".lang-switch a").first().hover();
  await expect(tip).toHaveText("Latviešu valoda");
  await sidebar.locator(".app-nav a").nth(1).hover();
  await page.waitForTimeout(700);
  await expect(tip).toHaveCount(0);
  // The email fits, so repeating it in a tooltip would add nothing.
  await sidebar.locator(".account-email").hover();
  await page.waitForTimeout(700);
  await expect(tip).toHaveCount(0);
  // The tooltip can be hovered: moving onto it keeps it open.
  await sidebar.locator("[data-theme-toggle]").hover();
  await expect(tip).toHaveCount(1);
  const box = (await page.locator("#app-tooltip").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
  await expect(tip).toHaveCount(1);
  // Escape dismisses a visible tooltip.
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
  // Dismissed stays dismissed while the pointer is still on that control.
  const toggleBox = (await sidebar
    .locator("[data-theme-toggle]")
    .boundingBox())!;
  await page.mouse.move(toggleBox.x + 6, toggleBox.y + 6);
  await page.mouse.move(toggleBox.x + 14, toggleBox.y + 14);
  await page.waitForTimeout(700);
  await expect(tip).toHaveCount(0);
  // Clicking after another control had focus must stay dismissed too: the
  // focus move from that control is not the pointer leaving this one.
  await page.mouse.move(900, 500);
  await sidebar.locator(".lang-switch a").first().focus();
  await page.mouse.click(toggleBox.x + 6, toggleBox.y + 6);
  await page.mouse.move(toggleBox.x + 14, toggleBox.y + 14);
  await page.waitForTimeout(700);
  await expect(tip).toHaveCount(0);
  // From the keyboard, activating the toggle refreshes the text instead of
  // leaving the old label on screen.
  // (The click above switched to the dark theme, so the label now offers light.)
  await page.mouse.move(900, 500);
  await sidebar.locator(".lang-switch a").first().focus();
  await page.keyboard.press("Shift");
  await sidebar.locator("[data-theme-toggle]").focus();
  await expect(tip).toHaveText("Switch to light theme");
  await page.keyboard.press("Space");
  await expect(tip).toHaveText("Switch to dark theme");
});
