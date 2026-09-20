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
    const overflow = await page.evaluate(() => ({
      fits: document.documentElement.scrollWidth <= window.innerWidth + 1,
      layout: ["main", "[data-dwelling-detail]", ".dwelling-tabs"].map(
        (selector) => {
          const element = document.querySelector<HTMLElement>(selector);
          return element
            ? {
                selector,
                width: element.getBoundingClientRect().width,
                scrollWidth: element.scrollWidth,
                overflowX: getComputedStyle(element).overflowX,
              }
            : null;
        }
      ),
      offenders: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter(
          (element) =>
            element.getBoundingClientRect().right > window.innerWidth + 1
        )
        .slice(0, 5)
        .map((element) => ({
          tag: element.tagName,
          id: element.id,
          className: element.className,
          text: element.textContent?.trim().slice(0, 40),
          parentClass: element.parentElement?.className,
          right: element.getBoundingClientRect().right,
        })),
    }));
    expect(
      overflow.fits,
      `${path} at ${width}px: ${JSON.stringify(overflow)}`
    ).toBe(true);
  }
}

function mutationStatuses(page: Page) {
  return page.evaluate(() =>
    Array.from(
      (
        globalThis as typeof globalThis & {
          __dzik118Mutations?: Map<string, { status: string }>;
        }
      ).__dzik118Mutations?.values() ?? [],
      (mutation) => mutation.status
    )
  );
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
  await page.waitForURL(/type=PARKING/);
  await expect(page.locator("tbody tr").first()).toContainText("Parking");
  await page.goto(`${base}/dashboard`);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" })
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await page.locator("[data-open-mobile-nav]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#mobile-nav-drawer")).toBeVisible();
  await page.goto(`${base}/dashboard?lang=lv`);
  await expect(page.locator("html")).toHaveAttribute("lang", "lv");
  await expect(
    page.locator(`.admin-sidebar a[href="${base}/dashboard"]`)
  ).toContainText("Pārskats");
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
  let releaseDwelling!: () => void;
  let dwellingRequests = 0;
  const dwellingGate = new Promise<void>((resolve) => {
    releaseDwelling = resolve;
  });
  const holdDwellingRequest = async (
    route: import("@playwright/test").Route
  ) => {
    if (route.request().method() === "POST") {
      dwellingRequests += 1;
      await dwellingGate;
      await route.continue();
      return;
    }
    await route.continue();
  };
  await page.route("**/*", holdDwellingRequest);
  await page.locator("#create-dwelling button[type=submit]").click();
  const pendingDwelling = page.locator("#dwellings-list tr", {
    hasText: dwellingNumber,
  });
  await expect(pendingDwelling).toHaveAttribute("data-pending", "true");
  await expect(pendingDwelling).toContainText("Saving");
  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "1 change saving"
  );
  releaseDwelling();
  await expect(pendingDwelling).not.toHaveAttribute("data-pending");
  await page.unroute("**/*", holdDwellingRequest);
  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "All changes saved"
  );
  expect(dwellingRequests).toBe(1);
  const dwellingLink = page.locator("tbody a.row-link-target", {
    hasText: dwellingNumber,
  });
  await dwellingLink.click();

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
  let releaseMeter!: () => void;
  const meterGate = new Promise<void>((resolve) => {
    releaseMeter = resolve;
  });
  const holdMeterRequest = async (route: import("@playwright/test").Route) => {
    if (route.request().method() === "POST") {
      await meterGate;
      await route.continue();
      return;
    }
    await route.continue();
  };
  await page.route("**/*", holdMeterRequest);
  await page.locator("#meter-form button[type=submit]").click();

  const row = page.locator("#meters .meter-row", { hasText: label });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-archived", "false");
  await expect(row).toHaveAttribute("data-pending", "true");
  await expect(row).toContainText("Saving");
  await expect(row.locator("[data-meter-archive-form]")).toHaveCount(0);
  await expect(page.locator("#meters-empty-state")).toBeHidden();
  expect(createRequests).toBe(1);
  releaseMeter();
  await expect(row).not.toHaveAttribute("data-pending");
  await page.unroute("**/*", holdMeterRequest);
  await expect(row.locator("[data-meter-archive-form]")).toHaveCount(1);
  await expect(page.locator(".mutation-toasts")).toContainText("Meter added");

  await page.locator("#meter-details summary").click();
  const secondLabel = `Second meter ${Date.now()}`;
  await page.locator('#meter-form input[name="unit"]').fill("m3");
  await page.locator('#meter-form input[name="label"]').fill(secondLabel);
  await page.locator("#meter-form button[type=submit]").click();
  const secondRow = page.locator("#meters .meter-row", {
    hasText: secondLabel,
  });
  await expect(secondRow).toBeVisible();
  await expect(secondRow).not.toHaveAttribute("data-pending");
  expect(createRequests).toBe(2);

  await page.locator("#meter-details summary").click();
  const awayLabel = `Navigate-away meter ${Date.now()}`;
  await page.locator('#meter-form input[name="unit"]').fill("m3");
  await page.locator('#meter-form input[name="label"]').fill(awayLabel);
  let releaseAwayMeter!: () => void;
  const awayMeterGate = new Promise<void>((resolve) => {
    releaseAwayMeter = resolve;
  });
  const holdAwayMeterRequest = async (
    route: import("@playwright/test").Route
  ) => {
    if (route.request().method() === "POST") {
      await awayMeterGate;
      await route.continue();
      return;
    }
    await route.continue();
  };
  await page.route("**/*", holdAwayMeterRequest);
  await page.locator("#meter-form button[type=submit]").click();
  await expect(
    page.locator("#meters .meter-row", { hasText: awayLabel })
  ).toHaveAttribute("data-pending", "true");
  await page.locator(`.admin-sidebar a[href="${base}/dashboard"]`).click();
  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "1 change saving"
  );
  releaseAwayMeter();
  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "All changes saved"
  );
  await page.unroute("**/*", holdAwayMeterRequest);
  expect(createRequests).toBe(3);
  await page.locator(`.admin-sidebar a[href="${base}/dwellings"]`).click();
  await page.getByRole("link", { name: dwellingNumber, exact: true }).click();
  await page.getByRole("tab", { name: "Meters" }).click();
  await expect(
    page.locator("#meters .meter-row", { hasText: awayLabel })
  ).toBeVisible();

  await page.getByRole("tab", { name: "Residents" }).click();
  await page.locator("#resident-details summary").click();
  await page
    .locator('#resident-form input[name="email"]')
    .fill("resident1@example.com");
  let releaseResident!: () => void;
  const residentGate = new Promise<void>((resolve) => {
    releaseResident = resolve;
  });
  let residentRequests = 0;
  const holdResidentRequest = async (
    route: import("@playwright/test").Route
  ) => {
    if (route.request().method() === "POST") {
      residentRequests += 1;
      await residentGate;
      await route.continue();
      return;
    }
    await route.continue();
  };
  await page.route("**/*", holdResidentRequest);
  await page.locator("#resident-form button[type=submit]").click();
  await expect(
    page.locator('#residents-list-region li[data-pending="true"]')
  ).toContainText("Adding");
  await expect.poll(() => residentRequests).toBe(1);
  await expect.poll(() => mutationStatuses(page)).toContain("pending");
  await page.locator(`.admin-sidebar a[href="${base}/dashboard"]`).click();
  await expect(page).toHaveURL(`${base}/dashboard`);
  await expect.poll(() => mutationStatuses(page)).toContain("pending");
  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "1 change saving"
  );
  releaseResident();
  await expect(page.locator(".mutation-toasts")).toContainText(
    "Resident added"
  );
  await page.unroute("**/*", holdResidentRequest);
  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "All changes saved"
  );
  expect(residentRequests).toBe(1);
  await page.locator(`.admin-sidebar a[href="${base}/dwellings"]`).click();
  await page.getByRole("link", { name: dwellingNumber, exact: true }).click();
  await page.getByRole("tab", { name: "Meters" }).click();
  await expect(row).toBeVisible();

  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(row).toBeHidden();
  await expect(page.locator("#meters-empty-state")).toBeVisible();
  await page.getByRole("button", { name: "Active", exact: true }).click();
  await expect(row).toBeVisible();

  let archiveRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("meters.archive")
    ) {
      archiveRequests += 1;
    }
  });
  await row.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(row).toBeHidden();
  await expect(page.locator("#meters-empty-state")).toBeHidden();
  await expect(secondRow).toBeVisible();
  expect(archiveRequests).toBe(1);
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

  await page.getByRole("tab", { name: "Meters" }).click();
  await page.getByRole("button", { name: "Active", exact: true }).click();
  await page.locator("#meter-details summary").click();
  const recoveredLabel = `Recovered meter ${Date.now()}`;
  await page.locator('#meter-form input[name="unit"]').fill("m3");
  await page.locator('#meter-form input[name="label"]').fill(recoveredLabel);
  let lostResponseRequests = 0;
  let releaseLookup!: () => void;
  const lookupGate = new Promise<void>((resolve) => {
    releaseLookup = resolve;
  });
  const loseCreateResponse = async (
    route: import("@playwright/test").Route
  ) => {
    if (
      route.request().method() === "POST" &&
      route.request().url().includes("meters.create")
    ) {
      lostResponseRequests += 1;
      await route.fetch();
      await route.abort("failed");
      return;
    }
    if (
      route.request().method() === "POST" &&
      route.request().url().includes("mutations.lookup")
    ) {
      await lookupGate;
      await route.continue();
      return;
    }
    await route.continue();
  };
  await page.route("**/*", loseCreateResponse);
  await page.locator("#meter-form button[type=submit]").click();
  await expect.poll(() => lostResponseRequests).toBe(1);
  const recoveringRow = page.locator("#meters .meter-row", {
    hasText: recoveredLabel,
  });
  await expect(recoveringRow).toContainText("Checking save status");
  await expect(recoveringRow).toHaveAttribute("data-pending", "true");
  await expect(recoveringRow.locator("[data-meter-archive-form]")).toHaveCount(
    0
  );
  await expect(page.locator("#meter-form button[type=submit]")).toBeDisabled();
  releaseLookup();
  await expect(recoveringRow).not.toHaveAttribute("data-pending");
  await page.unroute("**/*", loseCreateResponse);
  await expect(recoveringRow.locator("[data-meter-archive-form]")).toHaveCount(
    1
  );
  await expect(page.locator("#meter-form button[type=submit]")).toBeEnabled();
  expect(lostResponseRequests).toBe(1);

  await page.locator("#meter-details summary").click();
  const rejectedLabel = `Rejected meter ${Date.now()}`;
  await page.locator('#meter-form input[name="unit"]').fill("x".repeat(21));
  await page.locator('#meter-form input[name="label"]').fill(rejectedLabel);
  await page.locator("#meter-form button[type=submit]").click();
  await expect(
    page.locator("#meters .meter-row", { hasText: rejectedLabel })
  ).toHaveCount(0);
  await expect(page.locator(".mutation-toasts")).toContainText(
    "Could not add meter"
  );
  await expect(page.locator('#meter-form input[name="label"]')).toHaveValue(
    rejectedLabel
  );
  await expect(page.locator("#meter-form button[type=submit]")).toBeEnabled();

  await page.setViewportSize({ width: 390, height: 900 });
  await page.locator("[data-open-mobile-nav]").click();
  await expect(page.locator("#mobile-nav-drawer")).toBeVisible();
  await page.locator(`#mobile-nav-drawer a[href="${base}/settings"]`).click();
  await expect(page).toHaveURL(`${base}/settings`);
  await page.locator("[data-open-mobile-nav]").click();
  await expect(page.locator("#mobile-nav-drawer")).toBeVisible();
  await page.locator("[data-close-mobile-nav]").click();
  await expect(page.locator("#mobile-nav-drawer")).toBeHidden();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("link", { name: "Tariffs & rules" }).click();
  await expect(page.locator("main h1")).toContainText("Tariffs");
  await page.goBack();
  await page.getByRole("link", { name: "Invoice template" }).click();
  await expect(page.locator("#tpl-blocks .tpl-block").first()).toBeVisible();
  const blocksBefore = await page.locator("#tpl-blocks .tpl-block").count();
  await page.locator("#tpl-add-text").click();
  await expect(page.locator("#tpl-blocks .tpl-block")).toHaveCount(
    blocksBefore + 1
  );
  await page.goBack();
  await page.goForward();
  await expect(page.locator("#tpl-blocks .tpl-block")).toHaveCount(
    blocksBefore
  );

  for (const path of ["dashboard", "dwellings", "dashboard", "settings"]) {
    await page.locator(`.admin-sidebar a[href="${base}/${path}"]`).click();
    await expect(page).toHaveURL(`${base}/${path}`);
  }
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
  await page.waitForURL(/\/portal\/dwellings(?:\/.*)?$/);
  if (new URL(page.url()).pathname === "/portal/dwellings") {
    await page.locator('main a[href^="/portal/dwellings/"]').first().click();
    await page.waitForURL(/\/portal\/dwellings\/.+/);
  }
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
