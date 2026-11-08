import { expect, test } from "@playwright/test";

test("Dwelling detail reads as one summary, filters by section and stays readable at every width", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/login?lang=en");
  await page.locator("#admin-email").fill("admin.a@example.com");
  await page.locator("#admin-password").fill("ChangeMe123!");
  await page.locator("#admin-login-form button").click();
  await page.waitForURL(/\/admin\/(organizations|o\/.+\/dashboard)/);
  if (new URL(page.url()).pathname === "/admin/organizations") {
    await page.locator('main a[href$="/dashboard"]').first().click();
    await page.waitForURL(/\/admin\/o\/.+\/dashboard/);
  }
  const base = new URL(page.url()).pathname.replace(/\/dashboard$/, "");
  await page.goto(`${base}/dwellings?lang=en`);
  const href = await page
    .locator("tbody a.row-link-target")
    .first()
    .getAttribute("href");
  expect(href).toBeTruthy();
  const detail = `${href}?lang=en`;
  await page.goto(detail);

  await expect(page.locator("main h1")).toHaveCount(1);
  // One summary surface; the area and resident values are the only <p> in
  // their stat, so the optimistic edit updates the value and not the label.
  const stats = page.locator(".dwelling-summary .summary-stat");
  await expect(stats).toHaveCount(4);
  for (const kpi of ["area", "resident-count", "invoice-delivery"])
    await expect(page.locator(`[data-kpi="${kpi}"] p`)).toHaveCount(1);

  // Tab counts describe the real lists.
  const metersTab = page.getByRole("tab", { name: /Meters/ });
  const activeMeters = await page
    .locator("#meters-list-region .meter-row:not([hidden])")
    .count();
  await expect(metersTab.locator(".tab-count")).toHaveText(
    String(activeMeters)
  );
  const residentsTab = page.getByRole("tab", { name: /Residents/ });
  await expect(residentsTab.locator(".tab-count")).toHaveText(
    String(
      await page.locator("#residents-list-region li[data-user-id]").count()
    )
  );

  // Audit entries are sentences, never raw codes.
  const actions = await page.locator(".audit-action").allTextContents();
  for (const action of actions) expect(action).not.toMatch(/[A-Z]+_[A-Z]+/);
  if (actions.length > 6)
    await expect(page.locator(".audit-more summary")).toContainText(
      `(${actions.length - 6})`
    );

  // Each resident's actions share one line under the name.
  for (const row of await page.locator("li[data-user-id]").all()) {
    const tops = await row
      .locator(".sidebar-item-remove")
      .evaluateAll((els) =>
        els.map((el) => Math.round(el.getBoundingClientRect().top))
      );
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
  }

  // A meter caption never repeats its title.
  for (const row of await page.locator(".meter-row").all()) {
    const title = (await row.locator("strong").first().textContent())!.trim();
    const caption = (await row.locator("p").first().textContent())!.trim();
    expect(caption.split(" · ")[0]).not.toBe(title.replace(/ \(.*\)$/, ""));
  }

  // The unit tile is decorative; the unit must still be readable.
  for (const row of await page.locator(".meter-row").all())
    await expect(row.locator("p .sr-only")).toContainText(/\(.+\)/);

  // Tabs filter to one panel and back; the selected tab says so.
  await metersTab.click();
  await expect(metersTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-panel="meters"]')).toBeVisible();
  await expect(page.locator('[data-panel="tariffs"]')).toBeHidden();
  // Meters live in the sidebar column; the emptied main column must not
  // leave a grid gap above it.
  await expect(page.locator(".dwelling-main")).toBeHidden();
  await expect(page.locator(".dwelling-sidebar")).toBeVisible();
  // History lives outside the grid: the emptied grid must not take a row.
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator("[data-panel-group]")).toBeHidden();
  await expect(page.locator("#period-history")).toBeVisible();
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.locator('[data-panel="tariffs"]')).toBeVisible();
  // Keyboard: one tab stop, arrows move and select, End wraps to the last.
  await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  await page.getByRole("tab", { name: "Overview" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Account balance" })
  ).toBeFocused();
  await expect(
    page.getByRole("tab", { name: "Account balance" })
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Overview" })).toBeFocused();
  await page.keyboard.press("ArrowLeft"); // wraps to the last tab
  await expect(page.getByRole("tab", { name: "History" })).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "History" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute(
    "aria-selected",
    "true"
  );

  for (const locale of ["en", "lv", "ru"]) {
    await page.goto(`${href}?lang=${locale}`);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        theme
      );
      for (const width of [1440, 1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1
            )
          )
          .toBe(true);
      }
    }
  }

  await page.goto(detail);
  for (const [theme, width, file] of [
    ["light", 1440, "dwelling-light.png"],
    ["dark", 1440, "dwelling-dark.png"],
    ["dark", 390, "dwelling-mobile.png"],
  ] as const) {
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme
    );
    await page.screenshot({
      path: testInfo.outputPath(file),
      fullPage: true,
      animations: "disabled",
    });
  }
});
