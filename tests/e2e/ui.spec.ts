import { test, expect, type Page } from "@playwright/test";

// Uses the existing local seed, without modifying billing or financial records.
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);
const widths = [1440, 1024, 768, 390];

async function inspect(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBeLessThan(400);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("main h1"), path).toHaveCount(1);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      ),
      `${path} at ${width}px`
    ).toBe(true);
  }
}

test("admin routes, keyboard navigation, filters and locked actions", async ({
  page,
}) => {
  await page.goto("/login");
  await page.locator("#admin-email").fill("admin.a@example.com");
  await page.locator("#admin-password").fill("ChangeMe123!");
  await page.locator("#admin-login-form button").click();
  await page.waitForURL(/\/admin\/o\/.+\/dashboard/);
  const base = new URL(page.url()).pathname.replace(/\/dashboard$/, "");
  for (const path of [
    "dashboard",
    "periods",
    "dwellings",
    "payments",
    "messages",
    "settings",
    "settings/organization",
    "settings/billing",
    "settings/rules",
    "settings/users",
    "settings/data",
    "settings/invoice-template",
    "guide",
    "audit",
    "payments/import",
    "dwellings/import",
  ]) {
    await inspect(page, `${base}/${path}`);
  }
  await page.goto(`${base}/periods`);
  const periods = await page
    .locator("tbody a")
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")!));
  let selectionChecked = false;
  for (const path of periods) {
    await inspect(page, path);
    await expect(page.locator("#bulk-toolbar")).toBeHidden();
    await expect(
      page.getByRole("navigation", { name: "Filter by workflow stage" })
    ).toBeVisible();
    const selectableCase = page.locator('input[name="invoiceIds"]').first();
    if (!selectionChecked && (await selectableCase.count())) {
      await selectableCase.check();
      await expect(page.locator("#bulk-toolbar")).toBeVisible();
      await expect(page.locator("#selected-count")).toHaveText("1");
      await page.getByRole("button", { name: "Clear selection" }).click();
      await expect(page.locator("#bulk-toolbar")).toBeHidden();
      selectionChecked = true;
    }
    if (await page.locator("#locked-notice").count()) {
      await expect(
        page.getByRole("button", { name: "Generate all eligible" })
      ).toBeDisabled();
    }
    const invoice = await page
      .locator('tbody a[href*="/invoices/"]')
      .first()
      .getAttribute("href");
    if (invoice) await inspect(page, invoice);
  }
  await page.goto(`${base}/dwellings`);
  const dwelling = await page.locator("tbody a").first().getAttribute("href");
  if (dwelling) await inspect(page, dwelling);
  await page.goto(`${base}/dwellings`);
  await page.locator("#type-filter").selectOption("PARKING");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await expect(page.locator("tbody tr").first()).toContainText("Parking");
  await page.goto(`${base}/dashboard`);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" })
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await page.locator(".admin-mobile summary").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".admin-mobile nav")).toBeVisible();
  await page.goto(`${base}/dashboard?lang=lv`);
  await expect(page.locator("html")).toHaveAttribute("lang", "lv");
  await expect(page.locator("main .eyebrow").first()).toHaveText("Pārskats");
  await page.goto(`${base}/guide?lang=en`);
  await expect(
    page.locator(`.admin-sidebar a[href="${base}/guide"]`)
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator("main ol > li")).toHaveCount(10);
});

test("first meter is reconciled immediately and its dynamic archive control works", async ({
  page,
}) => {
  await page.goto("/login");
  await page.locator("#admin-email").fill("admin.a@example.com");
  await page.locator("#admin-password").fill("ChangeMe123!");
  await page.locator("#admin-login-form button").click();
  await page.waitForURL(/\/admin\/o\/.+\/dashboard/);
  const base = new URL(page.url()).pathname.replace(/\/dashboard$/, "");
  const dwellingNumber = `E2E-${Date.now()}`;

  await page.goto(`${base}/dwellings`);
  await page.getByRole("link", { name: "Create dwelling" }).click();
  await page.locator("#create-dwelling #number").fill(dwellingNumber);
  await page.locator("#create-dwelling #areaM2").fill("1");
  await page.locator("#create-dwelling button[type=submit]").click();
  await page
    .locator("tbody a.row-link-target", { hasText: dwellingNumber })
    .click();

  await page.getByRole("tab", { name: "Meters" }).click();
  await expect(page.locator("#meters-empty-state")).toBeVisible();
  await page.locator("#meter-details summary").click();
  const label = `Regression meter ${Date.now()}`;
  await page.locator('#meter-form input[name="unit"]').fill("m3");
  await page.locator('#meter-form input[name="label"]').fill(label);

  let createRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("meters.create")
    ) {
      createRequests += 1;
    }
  });
  await page.locator("#meter-form button[type=submit]").click();

  const row = page.locator("#meters .meter-row", { hasText: label });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-archived", "false");
  await expect(page.locator("#meters-empty-state")).toBeHidden();
  expect(createRequests).toBe(1);

  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(row).toBeHidden();
  await expect(page.locator("#meters-empty-state")).toBeVisible();
  await page.getByRole("button", { name: "Active", exact: true }).click();
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(row).toBeHidden();
  await expect(page.locator("#meters-empty-state")).toBeVisible();
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-archived", "true");
  await expect(row.locator("[data-meter-archive-form]")).toHaveCount(0);

  await page.reload();
  await page.getByRole("tab", { name: "Meters" }).click();
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  const refreshedRow = page.locator("#meters .meter-row", { hasText: label });
  await expect(refreshedRow).toBeVisible();
  await expect(refreshedRow).toHaveAttribute("data-archived", "true");
  await expect(refreshedRow.locator("[data-meter-archive-form]")).toHaveCount(
    0
  );
});

test("resident mobile routes remain separate from administration", async ({
  page,
  request,
}) => {
  await page.goto("/login");
  await page.locator("#resident-email").fill("resident1@example.com");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page).toHaveURL(/sent=1/);
  const mailbox = await (
    await request.get("http://127.0.0.1:54324/api/v1/messages")
  ).json();
  const message = mailbox.messages.find((m: { To: { Address: string }[] }) =>
    m.To.some((to) => to.Address === "resident1@example.com")
  );
  const mail = await (
    await request.get(`http://127.0.0.1:54324/api/v1/message/${message.ID}`)
  ).json();
  const link = mail.HTML.match(/href="([^"]+)"/)[1].replaceAll("&amp;", "&");
  const localLink = new URL(link);
  await page.goto(localLink.pathname + localLink.search);
  await page.getByRole("button", { name: "Confirm sign-in" }).click();
  await page.waitForURL(/\/portal\/dwellings\/.+/);
  const base = new URL(page.url()).pathname;
  for (const path of [
    base,
    `${base}/invoices`,
    `${base}/messages`,
    "/portal/profile",
    "/portal/dwellings",
  ]) {
    await inspect(page, path);
    await expect(page.locator(".admin-sidebar")).toHaveCount(0);
  }
  await page.goto(`${base}/invoices`);
  const invoice = await page
    .locator('main a[href^="/portal/invoices/"]')
    .first()
    .getAttribute("href");
  if (invoice) {
    await inspect(page, invoice);
    await expect(
      page.getByRole("button", { name: "Prepare", exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Print", exact: true })
    ).toBeVisible();
  }
});
