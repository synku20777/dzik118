import { expect, test } from "@playwright/test";

test("dashboard is readable across languages, themes and viewport sizes", async ({
  page,
}, testInfo) => {
  await page.goto("/login?lang=en");
  await page.locator("#admin-email").fill("admin.a@example.com");
  await page.locator("#admin-password").fill("ChangeMe123!");
  await page.locator("#admin-login-form button").click();
  await page.waitForURL(/\/admin\/(organizations|o\/.+\/dashboard)/);
  if (new URL(page.url()).pathname === "/admin/organizations") {
    await page.locator('main a[href$="/dashboard"]').first().click();
    await page.waitForURL(/\/admin\/o\/.+\/dashboard/);
  }
  const dashboard = new URL(page.url()).pathname;
  await expect(page.locator(".dashboard-page")).toBeVisible();
  // One money card: the total to pay leads, and the sum that makes it is
  // visible without a click.
  await expect(page.locator(".dashboard-metric")).toHaveCount(2);
  await expect(page.locator('[data-metric="collection"]')).toHaveCount(1);
  await expect(page.locator(".collection-total")).toBeVisible();
  await expect(page.locator(".money-ledger .money-total")).toBeVisible();
  await expect(page.locator(".money-total dd")).toHaveText(
    (await page.locator(".collection-total").textContent())!.trim()
  );
  // A period with no neighbour gets no placeholder button, and a passed
  // deadline is never shown as an invoice issue date.
  await expect(
    page.locator(".dashboard-period-nav [aria-disabled]")
  ).toHaveCount(0);
  await expect(page.locator(".month-progress time")).toHaveCount(2);
  // The Dashboard is its own breadcrumb root: just the current page.
  await expect(page.locator(".crumbs [aria-current='page']")).toHaveText(
    "Dashboard"
  );
  for (const locale of ["en", "lv", "ru"]) {
    await page.goto(`${dashboard}?lang=${locale}`);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
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
  await page.goto(`${dashboard}?lang=en`);
  const expectedUnsent = await page
    .locator(
      '.dashboard-status-list a[href$="status=DRAFT"], .dashboard-status-list a[href$="status=PREPARED"]'
    )
    .evaluateAll((links) =>
      links.reduce(
        (sum, link) =>
          sum +
          Number(
            link.querySelector(":scope > span:last-child")?.textContent?.trim()
          ),
        0
      )
    );
  const workbench = await page
    .locator('[data-metric="unpaid"]')
    .getAttribute("href");
  await page.goto(`${workbench}?status=UNSENT`);
  await expect(page.locator(".queue-result")).toContainText(
    "Draft and prepared invoices"
  );
  const queueStatuses = await page
    .locator("tr[data-status]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-status")));
  expect(
    queueStatuses.every((status) => status === "DRAFT" || status === "PREPARED")
  ).toBe(true);
  expect(expectedUnsent).toBeGreaterThan(0);
  expect(queueStatuses).toHaveLength(expectedUnsent);
  await page.goto(`${dashboard}?lang=en`);
  const drawerLink = page.locator(
    '.month-status-lead [data-open-drawer="readings"]'
  );
  await expect(drawerLink).toHaveCount(1);
  await drawerLink.click();
  await expect(page.locator("#admin-context-drawer")).toBeVisible();
  await expect(page.locator("#context-drawer-title")).toHaveText(
    "Meter readings"
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("#admin-context-drawer")).not.toBeVisible();
  await expect(page).not.toHaveURL(/[?&]drawer=/);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await page.screenshot({
    path: testInfo.outputPath("dashboard-desktop.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  const targetSurface = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--color-surface)";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  await expect(page.locator(".dashboard-metric").first()).toHaveCSS(
    "background-color",
    targetSurface
  );
  await page.screenshot({
    path: testInfo.outputPath("dashboard-dark.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  // One column: the breakdown starts closed, opens on demand, and the
  // next-step button is on the first screen.
  await expect(page.locator(".money-ledger")).toBeHidden();
  await expect(
    page.locator(".month-status-lead .btn-primary")
  ).toBeInViewport();
  await page.locator(".collection-ledger > summary").click();
  await expect(page.locator(".money-ledger .money-total")).toBeVisible();
  await page.locator(".collection-ledger > summary").click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".money-ledger .money-total")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("dashboard-mobile.png"),
    fullPage: true,
  });
});
