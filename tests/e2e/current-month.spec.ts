import { expect, test } from "@playwright/test";

test("Current Month keeps billing actions usable through filtering and queue refresh", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("/login?lang=en");
  await page.locator("#admin-email").fill("admin.a@example.com");
  await page.locator("#admin-password").fill("ChangeMe123!");
  await page.locator("#admin-login-form button").click();
  await page.waitForURL(/\/admin\/(organizations|o\/.+\/dashboard)/);
  if (new URL(page.url()).pathname === "/admin/organizations") {
    await page.locator('main a[href$="/dashboard"]').first().click();
    await page.waitForURL(/\/admin\/o\/.+\/dashboard/);
  }
  // Total to pay, received, still unpaid: the collection card carries
  // all three.
  const dashboardAmounts = [
    await page.locator(".collection-total").textContent(),
    await page
      .locator('[data-metric="collection"] .collection-received')
      .textContent(),
    await page.locator('[data-metric="unpaid"] strong').textContent(),
  ];
  const workbench = await page
    .locator('[data-metric="unpaid"]')
    .getAttribute("href");
  expect(workbench).toBeTruthy();
  await page.goto(`${workbench}?lang=en`);
  await expect(page.locator("main h1")).toHaveCount(1);
  const financials = page.locator(".financial-stat strong");
  await expect(financials).toHaveCount(3);
  // Both pages must describe the same period and financial baseline.
  expect(
    (await financials.allTextContents()).map((text) => text.trim())
  ).toEqual(dashboardAmounts.map((text) => text!.trim()));
  // Breadcrumbs say where the page sits: Dashboard > Periods > this month.
  await expect(page.locator(".crumbs li")).toHaveCount(3);
  await expect(page.locator(".crumbs a").first()).toHaveText("Dashboard");
  await expect(page.locator(".crumbs [aria-current='page']")).toHaveText(
    await page
      .locator("main h1")
      .textContent()
      .then((t) => t!.trim())
  );
  // The stage filters are tabs, not boxes inside the panel.
  await expect(page.locator(".workflow-rail")).toHaveCSS(
    "border-top-width",
    "0px"
  );
  await expect(page.locator(".workflow-filter").first()).toHaveCSS(
    "border-left-width",
    "0px"
  );
  // At most two missing items per case, then "+N more".
  for (const row of await page.locator("tr[data-status]").all()) {
    // Only reading-type items (the ones that open the drawer) are capped.
    const shown = await row
      .locator('.readiness-item[data-open-drawer="readings"]')
      .count();
    // A truncating tag is one line: icon and text share it.
    for (const tag of await row.locator(".readiness-item[data-tip]").all()) {
      expect((await tag.boundingBox())!.height).toBeLessThan(32);
    }
    const more = row.locator(".readiness-more");
    if ((await more.count()) > 0) {
      await expect(more).toHaveText(/^\+\d+ more$/);
      expect(shown).toBeLessThanOrEqual(2);
    }
  }
  await expect(page.locator(".workflow-filter")).toHaveCount(8);
  await expect(page.locator("#period-tariffs")).not.toHaveAttribute("open");
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.locator(".case-table").boundingBox())!.y).toBeLessThan(
    700
  );

  const readyLink = page.locator('.workflow-filter[href*="status=DRAFT"]');
  const drafts = Number(await readyLink.locator("strong").textContent());
  expect(drafts).toBeGreaterThan(0);
  await page.locator("#status").selectOption("DRAFT");
  await expect(page).not.toHaveURL(/status=DRAFT/);
  await page.locator(".filter-submit").click();
  await expect(page).toHaveURL(/status=DRAFT/);
  await expect(
    page.locator('.workflow-filter[aria-current="page"]')
  ).toHaveAttribute("href", /status=DRAFT/);
  await expect(page.locator("tr[data-status]")).toHaveCount(drafts);
  const firstNumber = (await page
    .locator(".dwelling-cell a")
    .first()
    .textContent())!.trim();
  await page.locator("#search").pressSequentially("7x", { delay: 400 });
  await expect(page.locator("#search")).toHaveValue("7x");
  await expect(page.locator("#search")).toBeFocused();
  await page.locator("#search").fill(firstNumber);
  await page.locator("#search").press("Enter");
  await expect(page).toHaveURL(/search=/);
  await expect(page.locator("tr[data-status]")).toHaveCount(1);
  await expect(page.locator("#status")).toHaveValue("DRAFT");
  for (const number of await page.locator(".dwelling-cell a").allTextContents())
    expect(number.trim()).toContain(firstNumber);
  await page.locator(".clear-filters").click();
  await expect(page.locator("#search")).toHaveValue("");
  await expect(page.locator("#status")).toHaveValue("");
  await readyLink.click();
  await expect(page.locator("#status")).toHaveValue("DRAFT");
  await page.locator(".clear-filters").click();
  await expect(page.locator("#status")).toHaveValue("");

  // Simulate the real drawer's fragment replacement without changing billing data.
  await page.evaluate(() => {
    const queue = document.querySelector(".case-queue")!;
    queue.replaceWith(queue.cloneNode(true));
    document.dispatchEvent(new Event("workbench:refreshed"));
  });
  const boxes = page.locator('input[name="invoiceIds"]');
  expect(await boxes.count()).toBeGreaterThan(1);
  await boxes.first().check();
  await expect(page.locator("#bulk-toolbar")).toBeVisible();
  await expect(page.locator("#selected-count")).toHaveText("1");
  await expect(page.locator("tr[data-selected]")).toHaveCount(1);
  expect(
    await page
      .locator("#select-all")
      .evaluate((el: HTMLInputElement) => el.indeterminate)
  ).toBe(true);
  await page.locator("#select-all").check();
  await expect(page.locator("#selected-count")).toHaveText(
    String(await boxes.count())
  );
  for (const [attribute, button] of [
    ["data-prepare-eligible", "DRAFT"],
    ["data-send-eligible", "PREPARED"],
  ]) {
    const eligible = await boxes.evaluateAll(
      (elements, attr) =>
        elements.filter((el) => el.getAttribute(attr) === "true").length,
      attribute
    );
    if (eligible > 0)
      await expect(
        page.locator(`[data-bulk-status="${button}"]`)
      ).toBeEnabled();
    else
      await expect(
        page.locator(`[data-bulk-status="${button}"]`)
      ).toBeDisabled();
  }
  await page.locator("#clear-selection").click();
  await expect(page.locator("#bulk-toolbar")).toBeHidden();
  await expect(page.locator("#select-all")).toBeFocused();
  const rowBeforeMenu = await page
    .locator("tr[data-status]")
    .last()
    .boundingBox();
  const columnsBeforeMenu = await page
    .locator(".case-table th")
    .evaluateAll((ths) => ths.map((th) => th.getBoundingClientRect().width));
  await page.locator(".case-menu-trigger").last().click();
  await expect(page.locator(".case-menu:popover-open")).toBeVisible();
  expect(
    await page
      .locator(".case-table th")
      .evaluateAll((ths) => ths.map((th) => th.getBoundingClientRect().width))
  ).toEqual(columnsBeforeMenu);
  expect(
    (await page.locator("tr[data-status]").last().boundingBox())!.height
  ).toBe(rowBeforeMenu!.height);
  const menuBounds = (await page
    .locator(".case-menu:popover-open")
    .boundingBox())!;
  expect(menuBounds.x).toBeGreaterThanOrEqual(0);
  expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(1440);
  expect(menuBounds.y).toBeGreaterThanOrEqual(0);
  expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(1000);
  await page.keyboard.press("Escape");
  await expect(page.locator(".case-menu:popover-open")).toHaveCount(0);
  await expect(page.locator(".case-menu-trigger").last()).toBeFocused();
  await page
    .locator("[data-open-lock-dialog]")
    .evaluate((el: HTMLButtonElement) => (el.closest("details")!.open = true));
  await page.locator("[data-open-lock-dialog]").click();
  await expect(
    page.getByRole("dialog", { name: "Lock this period?" })
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Lock this period?" })
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(page.locator("#lock-period-dialog")).toBeHidden();

  const drawer = page
    .locator('.case-table [data-open-drawer="readings"]')
    .first();
  await drawer.click();
  await expect(page.locator("#context-drawer-title")).toHaveText(
    "Meter readings"
  );
  const openedDwelling = new URL(page.url()).searchParams.get("dwelling");
  await page.evaluate(() => {
    const queue = document.querySelector(".case-queue")!;
    queue.replaceWith(queue.cloneNode(true));
    document.dispatchEvent(new Event("workbench:refreshed"));
  });
  await page.keyboard.press("Escape");
  await expect(page.locator("#admin-context-drawer")).toBeHidden();
  await expect(
    page
      .locator(
        `[data-open-drawer="readings"][data-dwelling-id="${openedDwelling}"]`
      )
      .first()
  ).toBeFocused();
  // A resolved row can disappear from an active filter after a save.
  await page
    .locator(
      `[data-open-drawer="readings"][data-dwelling-id="${openedDwelling}"]`
    )
    .first()
    .click();
  await expect(page.locator("#context-drawer-title")).toHaveText(
    "Meter readings"
  );
  await page.evaluate((id) => {
    document.querySelector(`tr[data-dwelling-id="${id}"]`)!.remove();
    document.dispatchEvent(new Event("workbench:refreshed"));
  }, openedDwelling);
  await page.keyboard.press("Escape");
  await expect(page.locator("#queue-heading")).toBeFocused();

  for (const locale of ["en", "lv", "ru"]) {
    await page.goto(`${workbench}?lang=${locale}`);
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
        if (width < 640)
          await expect(page.locator(".dwelling-cell").first()).toHaveAttribute(
            "data-label",
            /.+/
          );
        if (width === 320 && locale === "en" && theme === "dark") {
          await page.locator(".case-menu-trigger").first().click();
          const menu = page.locator(".case-menu:popover-open");
          await expect(menu).toBeVisible();
          const bounds = (await menu.boundingBox())!;
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
          expect(bounds.y).toBeGreaterThanOrEqual(0);
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(1000);
          await page.keyboard.press("Escape");
          await expect(menu).toHaveCount(0);
        }
      }
    }
  }
  await page.goto(`${workbench}?lang=en&search=nonexistent-dwelling`);
  await expect(page.locator(".empty-queue")).toContainText(
    "No billing cases match these filters."
  );
  await page.locator(".empty-queue a").click();
  await expect(page.locator("tr[data-status]").first()).toBeVisible();
  for (const [theme, width, file] of [
    ["light", 1440, "current-month-light.png"],
    ["dark", 1440, "current-month-dark.png"],
    ["dark", 390, "current-month-mobile.png"],
  ] as const) {
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme
    );
    const surface = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--color-surface)";
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    await expect(page.locator(".financial-summary")).toHaveCSS(
      "background-color",
      surface
    );
    await expect(page.locator(".period-actions > .btn-secondary")).toHaveCSS(
      "background-color",
      surface
    );
    await page.screenshot({ path: testInfo.outputPath(file), fullPage: true });
  }
  // The seeded previous month is locked; inspection must remain available.
  await page.locator(".period-navigation a").first().click();
  await expect(page.locator("#locked-notice")).toBeVisible();
  await expect(page.locator(".period-actions .btn-primary")).toBeDisabled();
  await expect(page.locator(".next-action").first()).toContainText(
    "View invoice"
  );
});
