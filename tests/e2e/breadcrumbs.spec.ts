import { expect, test, type Page } from "@playwright/test";

// Read-only. The breadcrumb trail is rendered once by AdminLayout, so every
// admin page must show it in the same place, rooted at the Dashboard, with a
// current page that is not a link, and with every link going somewhere real.
async function login(page: Page): Promise<string> {
  await page.goto("/login?lang=en");
  await page.locator("#admin-email").fill("admin.a@example.com");
  await page.locator("#admin-password").fill("ChangeMe123!");
  await page.locator("#admin-login-form button").click();
  await page.waitForURL(/\/admin\/(organizations|o\/.+\/dashboard)/);
  if (new URL(page.url()).pathname === "/admin/organizations") {
    await page.locator('main a[href$="/dashboard"]').first().click();
    await page.waitForURL(/\/admin\/o\/.+\/dashboard/);
  }
  return new URL(page.url()).pathname.replace(/\/dashboard$/, "");
}

async function firstHref(page: Page, path: string, selector: string) {
  await page.goto(`${path}?lang=en`);
  const href = await page.locator(selector).first().getAttribute("href");
  expect(href, `${path} ${selector}`).toBeTruthy();
  return new URL(href!, page.url()).pathname;
}

test("every admin page has the same breadcrumb trail in the same place", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const base = await login(page);
  const period = await firstHref(
    page,
    `${base}/periods`,
    'a[href*="/periods/"]:not([href$="/periods"])'
  );
  const paths = [
    `${base}/dashboard`,
    `${base}/periods`,
    period,
    `${period}/readings`,
    await firstHref(page, period, ".dwelling-cell a"),
    await firstHref(page, period, 'a[href*="/invoices/"]'),
    `${base}/dwellings`,
    `${base}/dwellings/import`,
    await firstHref(page, `${base}/dwellings`, "tbody a.row-link-target"),
    `${base}/payments`,
    `${base}/payments/import`,
    `${base}/payments/ledger`,
    await firstHref(
      page,
      `${base}/payments`,
      '#history tbody a[href*="/payments/"]:not([href*="ledger"])'
    ),
    await firstHref(page, `${base}/payments`, 'a[href*="/payments/imports/"]'),
    `${base}/messages`,
    `${base}/audit`,
    `${base}/guide`,
    `${base}/settings`,
    ...[
      "billing",
      "data",
      "invoice-template",
      "organization",
      "rules",
      "suppressed-emails",
      "users",
    ].map((slug) => `${base}/settings/${slug}`),
    `${base}/setup`,
    ...["charges", "dwellings", "meters", "organization", "period"].map(
      (slug) => `${base}/setup/${slug}`
    ),
    `${base}/migration`,
  ];

  let top: number | undefined;
  const links = new Set<string>();
  for (const path of paths) {
    const response = await page.goto(`${path}?lang=en`);
    expect(response?.status(), path).toBeLessThan(400);
    const crumbs = page.locator("main nav.crumbs");
    await expect(crumbs, path).toHaveCount(1);
    // First thing in <main> (an archived-organization notice may precede it).
    const firstElement = await page.evaluate(() => {
      const main = document.querySelector("main")!;
      const first = [...main.children].find((el) => !el.matches("p.notice"));
      return first?.matches("nav.crumbs") ?? false;
    });
    expect(firstElement, `${path}: crumbs are not first in main`).toBe(true);
    const box = (await crumbs.boundingBox())!;
    top ??= box.y;
    expect(Math.abs(box.y - top), `${path}: crumbs moved`).toBeLessThanOrEqual(
      2
    );
    // Rooted at the Dashboard; the current page is the last item, not a link.
    await expect(crumbs.locator("li a").first(), path)
      .toHaveText(/^Dashboard$/)
      .catch(async () => {
        // The Dashboard itself: its only item is the current page.
        await expect(crumbs.locator("li"), path).toHaveCount(1);
      });
    await expect(
      crumbs.locator('li:last-child [aria-current="page"]'),
      path
    ).toHaveCount(1);
    await expect(crumbs.locator("li:last-child a"), path).toHaveCount(0);
    // The old ways of saying "back" are gone.
    await expect(page.locator("nav.breadcrumb, a.back-link"), path).toHaveCount(
      0
    );
    for (const href of await crumbs
      .locator("a")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")!))) {
      links.add(new URL(href, page.url()).pathname);
    }
  }
  for (const href of links) {
    const response = await page.request.get(href);
    expect(response.status(), href).toBeLessThan(400);
  }

  // Outside any organization the trail is just that page.
  await page.goto("/admin/organizations?lang=en");
  await expect(page.locator("main nav.crumbs li")).toHaveCount(1);
  await expect(page.locator("main nav.crumbs a")).toHaveCount(0);
});
