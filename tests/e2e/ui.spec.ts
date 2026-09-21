import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createDb, type Db } from "../../src/db/client";
import { appUsers } from "../../src/db/schema/auth";
import { billingCases, billingPeriods } from "../../src/db/schema/billing";
import { invoiceDeliveries, invoices } from "../../src/db/schema/invoices";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import {
  generateInvoice,
  prepareInvoice,
} from "../../src/domain/billing/generation";
import {
  claimSendAttempt,
  markFailed,
  markUnknown,
} from "../../src/domain/billing/send-attempts";
import { createSupabaseAdminClient } from "../../src/lib/supabase/admin";
import {
  invoicePdfObjectKey,
  uploadInvoicePdf,
} from "../../src/lib/storage/invoices";

// Uses the existing local seed, without modifying billing or financial records.
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);
const widths = [1440, 1024, 768, 390];

async function loginAdmin(page: Page): Promise<string> {
  await page.goto("/login");
  await page.locator("#admin-email").fill("admin.a@example.com");
  await page.locator("#admin-password").fill("ChangeMe123!");
  await page.locator("#admin-login-form button").click();
  await page.waitForURL(/\/admin\/o\/.+\/dashboard/);
  return new URL(page.url()).pathname.replace(/\/dashboard$/, "");
}

interface SetupInvoiceOptions {
  invoiceByEmail: boolean;
  invoiceByPaper: boolean;
  billingEmail: string | null;
}

async function setupPreparedE2EInvoice(
  db: Db,
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  orgId: string,
  periodId: string,
  adminUserId: string,
  opts: SetupInvoiceOptions
) {
  const dwellingNum = `E2E-INV-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const dwelling = await createDwelling(
    db,
    orgId,
    {
      number: dwellingNum,
      areaM2: "50.00",
      occupantName: `Test Resident ${dwellingNum}`,
      billingName: `Test Resident ${dwellingNum}`,
      billingAddress: "Brīvības iela 118, Riga, LV-1001",
      billingEmail: opts.billingEmail ?? undefined,
      invoiceByEmail: opts.invoiceByEmail,
      invoiceByPaper: opts.invoiceByPaper,
    },
    adminUserId
  );

  await db.insert(billingCases).values({
    organizationId: orgId,
    periodId,
    dwellingId: dwelling.id,
    missingData: [],
    status: "READY",
  });

  const generated = await generateInvoice(
    db,
    orgId,
    periodId,
    dwelling.id,
    adminUserId
  );
  const prepared = await prepareInvoice(db, orgId, generated.id, adminUserId);

  // Pre-seed canonical PDF in Supabase storage so PDF download works
  // and sendInvoice does not attempt Cloudflare Browser Rendering (which is disabled in local dev)
  const dummyPdfBytes = new TextEncoder().encode(
    "%PDF-1.4 stub for testing\n%%EOF"
  );
  const pdfSha256 = createHash("sha256").update(dummyPdfBytes).digest("hex");
  const [year, month] = prepared.issueDate.split("-").map(Number);
  const pdfObjectKey = invoicePdfObjectKey(
    orgId,
    year,
    month,
    prepared.id,
    prepared.version
  );
  await uploadInvoicePdf(supabaseAdmin, pdfObjectKey, dummyPdfBytes);
  await db
    .update(invoices)
    .set({ pdfObjectKey, pdfSha256 })
    .where(eq(invoices.id, prepared.id));

  return { dwelling, invoice: prepared };
}

async function cleanupTestDwellingsAndInvoices(
  db: Db,
  dwellingIds: string[],
  invoiceIds: string[]
) {
  if (dwellingIds.length === 0 && invoiceIds.length === 0) return;
  await db.$client.query("set session_replication_role = replica");
  try {
    if (invoiceIds.length > 0) {
      for (const invId of invoiceIds) {
        await db.$client.query(
          "delete from account_entries where invoice_id = $1",
          [invId]
        );
        await db.$client.query(
          "delete from invoice_deliveries where invoice_id = $1",
          [invId]
        );
        await db.$client.query(
          "delete from invoice_send_attempts where invoice_id = $1",
          [invId]
        );
        await db.$client.query(
          "delete from invoice_access_tokens where invoice_id = $1",
          [invId]
        );
        await db.$client.query(
          "delete from invoice_lines where invoice_id = $1",
          [invId]
        );
        await db.$client.query("delete from invoices where id = $1", [invId]);
      }
    }
    if (dwellingIds.length > 0) {
      for (const dwId of dwellingIds) {
        await db.$client.query(
          "delete from billing_cases where dwelling_id = $1",
          [dwId]
        );
        await db.$client.query("delete from dwellings where id = $1", [dwId]);
      }
    }
  } finally {
    await db.$client.query("set session_replication_role = default");
  }
}

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
  const dwellingNumber = `00-E2E-${Date.now()}`;

  await page.goto(`${base}/dwellings`);
  const dwellingBLink = page.locator("tbody a.row-link-target").first();
  const dwellingBHref = await dwellingBLink.getAttribute("href");
  expect(dwellingBHref).toBeTruthy();
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

  await page.locator("#basic-info-details summary").click();
  const basicInfoBillingName = `Basic E2E ${Date.now()}`;
  const basicInfoArea = "45.75";
  const basicInfoResidentCount = "3";
  await page
    .locator('#basic-info-form input[name="billingName"]')
    .fill(basicInfoBillingName);
  await page
    .locator('#basic-info-form input[name="areaM2"]')
    .fill(basicInfoArea);
  await page
    .locator('#basic-info-form input[name="residentCount"]')
    .fill(basicInfoResidentCount);

  let basicInfoRequests = 0;
  const onBasicInfoRequest = (request: import("@playwright/test").Request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("dwellings.update") &&
      !request.url().includes("updateInvoiceDelivery")
    ) {
      basicInfoRequests += 1;
    }
  };
  page.on("request", onBasicInfoRequest);

  let releaseBasicInfo!: () => void;
  const basicInfoGate = new Promise<void>((resolve) => {
    releaseBasicInfo = resolve;
  });
  const holdBasicInfoRequest = async (
    route: import("@playwright/test").Route
  ) => {
    if (
      route.request().method() === "POST" &&
      route.request().url().includes("dwellings.update") &&
      !route.request().url().includes("updateInvoiceDelivery")
    ) {
      await basicInfoGate;
      await route.continue();
      return;
    }
    await route.continue();
  };
  await page.route("**/*", holdBasicInfoRequest);
  await page.locator("#basic-info-form button[type=submit]").click();

  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "1 change saving"
  );
  await expect(page.locator('[data-kpi="area"] p')).toHaveText(
    `${basicInfoArea} m²`
  );
  await expect(page.locator('[data-kpi="resident-count"] p')).toHaveText(
    basicInfoResidentCount
  );
  await expect(page.locator('dd[data-field="billingName"]')).toHaveText(
    basicInfoBillingName
  );
  await expect(page.locator('dd[data-field="areaM2"]')).toHaveText(
    basicInfoArea
  );
  await expect(page.locator('dd[data-field="residentCount"]')).toHaveText(
    basicInfoResidentCount
  );

  releaseBasicInfo();
  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "All changes saved"
  );
  await page.unroute("**/*", holdBasicInfoRequest);
  page.off("request", onBasicInfoRequest);

  await expect(page.locator(".mutation-toasts")).toContainText("Changes saved");
  await expect(page.locator("#basic-info-details")).not.toHaveAttribute(
    "open",
    ""
  );
  await expect(page.locator('[data-kpi="area"] p')).toHaveText(
    `${basicInfoArea} m²`
  );
  await expect(page.locator('dd[data-field="billingName"]')).toHaveText(
    basicInfoBillingName
  );
  await expect(page.locator('dd[data-field="areaM2"]')).toHaveText(
    basicInfoArea
  );
  await expect(page.locator('dd[data-field="residentCount"]')).toHaveText(
    basicInfoResidentCount
  );
  expect(basicInfoRequests).toBe(1);

  await page.reload();
  await expect(page.locator('[data-kpi="area"] p')).toHaveText(
    `${basicInfoArea} m²`
  );
  await expect(page.locator('[data-kpi="resident-count"] p')).toHaveText(
    basicInfoResidentCount
  );
  await expect(page.locator('dd[data-field="billingName"]')).toHaveText(
    basicInfoBillingName
  );
  await expect(page.locator('dd[data-field="areaM2"]')).toHaveText(
    basicInfoArea
  );
  await expect(page.locator('dd[data-field="residentCount"]')).toHaveText(
    basicInfoResidentCount
  );

  // Clear billingName via the form, save, reload, confirm it stays empty
  await page.locator("#basic-info-details summary").click();
  await page.locator('#basic-info-form input[name="billingName"]').fill("");

  let releaseClearGate!: () => void;
  const clearGate = new Promise<void>((resolve) => {
    releaseClearGate = resolve;
  });
  const holdClearRequest = async (route: import("@playwright/test").Route) => {
    if (
      route.request().method() === "POST" &&
      route.request().url().includes("dwellings.update") &&
      !route.request().url().includes("updateInvoiceDelivery")
    ) {
      await clearGate;
      await route.continue();
      return;
    }
    await route.continue();
  };
  await page.route("**/*", holdClearRequest);
  await page.locator("#basic-info-form button[type=submit]").click();

  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "1 change saving"
  );
  await expect(page.locator('dd[data-field="billingName"]')).toHaveText("—");

  releaseClearGate();
  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "All changes saved"
  );
  await page.unroute("**/*", holdClearRequest);

  await expect(page.locator(".mutation-toasts")).toContainText("Changes saved");
  await expect(page.locator("#basic-info-details")).not.toHaveAttribute(
    "open",
    ""
  );
  await expect(page.locator('dd[data-field="billingName"]')).toHaveText("—");

  await page.reload();
  await expect(page.locator('dd[data-field="billingName"]')).toHaveText("—");
  await page.locator("#basic-info-details summary").click();
  await expect(
    page.locator('#basic-info-form input[name="billingName"]')
  ).toHaveValue("");
  // billingEmail: set a valid email, save, then clear it via a
  // whitespace-only value (must be treated the same as a blank clear, not
  // rejected as an invalid email), then save a padded valid email and
  // confirm it's trimmed on persist -- exercises the z.preprocess() fix that
  // trims before z.email() validates.
  const billingEmailInput = page.locator(
    '#basic-info-form input[name="billingEmail"]'
  );
  const billingEmailDd = page.locator('dd[data-field="billingEmail"]');

  async function saveBasicInfo() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hold = async (route: import("@playwright/test").Route) => {
      if (
        route.request().method() === "POST" &&
        route.request().url().includes("dwellings.update") &&
        !route.request().url().includes("updateInvoiceDelivery")
      ) {
        await gate;
        await route.continue();
        return;
      }
      await route.continue();
    };
    await page.route("**/*", hold);
    await page.locator("#basic-info-form button[type=submit]").click();
    await expect(page.locator("[data-mutation-summary]")).toHaveText(
      "1 change saving"
    );
    release();
    await expect(page.locator("[data-mutation-summary]")).toHaveText(
      "All changes saved"
    );
    await page.unroute("**/*", hold);
    // A successful save auto-closes the disclosure (see onSuccess in the
    // page's script) -- reopen it so the next fill() has a visible input.
    await page.locator("#basic-info-details summary").click();
  }

  const validEmail = `e2e-${Date.now()}@example.com`;
  await billingEmailInput.fill(validEmail);
  await saveBasicInfo();
  await expect(billingEmailDd).toHaveText(validEmail);

  await billingEmailInput.fill("   ");
  await saveBasicInfo();
  await expect(billingEmailDd).toHaveText("—");
  await page.reload();
  await expect(billingEmailDd).toHaveText("—");
  await page.locator("#basic-info-details summary").click();
  await expect(billingEmailInput).toHaveValue("");

  const paddedEmail = `e2e-padded-${Date.now()}@example.com`;
  await billingEmailInput.fill(`  ${paddedEmail}  `);
  await saveBasicInfo();
  await page.reload();
  await expect(billingEmailDd).toHaveText(paddedEmail);
  await page.locator("#basic-info-details summary").click();
  await expect(billingEmailInput).toHaveValue(paddedEmail);
  await page.locator("#basic-info-details summary").click();

  const emailCheckbox = page.locator(
    '[data-delivery-form] input[name="invoiceByEmail"]'
  );
  const paperCheckbox = page.locator(
    '[data-delivery-form] input[name="invoiceByPaper"]'
  );
  const deliverySave = page.locator("[data-delivery-save]");
  const deliveryKpi = page.locator('[data-kpi="invoice-delivery"] p');

  const initialPaperChecked = await paperCheckbox.isChecked();
  const initialKpi = (await deliveryKpi.textContent())?.trim() ?? "";
  await expect(deliverySave).toBeDisabled();

  // Toggle invoiceByPaper to a genuinely different value while keeping invoiceByEmail true
  // (satisfies the schema constraint: invoiceByEmail OR invoiceByPaper)
  if (initialPaperChecked) {
    await paperCheckbox.uncheck();
  } else {
    await paperCheckbox.check();
  }
  await expect(deliverySave).toBeEnabled();

  let deliveryRequests = 0;
  const onDeliveryRequest = (request: import("@playwright/test").Request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("dwellings.updateInvoiceDelivery")
    ) {
      deliveryRequests += 1;
    }
  };
  page.on("request", onDeliveryRequest);

  let releaseDelivery!: () => void;
  const deliveryGate = new Promise<void>((resolve) => {
    releaseDelivery = resolve;
  });
  const holdDeliveryRequest = async (
    route: import("@playwright/test").Route
  ) => {
    if (
      route.request().method() === "POST" &&
      route.request().url().includes("dwellings.updateInvoiceDelivery")
    ) {
      await deliveryGate;
      await route.continue();
      return;
    }
    await route.continue();
  };
  await page.route("**/*", holdDeliveryRequest);
  await deliverySave.click();

  // Pending-only tier: controls disabled, no optimistic display update
  await expect(deliverySave).toBeDisabled();
  await expect(emailCheckbox).toBeDisabled();
  await expect(paperCheckbox).toBeDisabled();
  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "1 change saving"
  );
  await expect(deliveryKpi).toHaveText(initialKpi);

  releaseDelivery();
  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "All changes saved"
  );
  await page.unroute("**/*", holdDeliveryRequest);
  page.off("request", onDeliveryRequest);

  await expect(page.locator(".mutation-toasts")).toContainText(
    "Delivery preferences saved"
  );
  await expect(deliverySave).toBeDisabled();
  await expect(emailCheckbox).toBeEnabled();
  await expect(paperCheckbox).toBeEnabled();
  if (initialPaperChecked) {
    await expect(paperCheckbox).not.toBeChecked();
    await expect(deliveryKpi).toHaveText("Email");
  } else {
    await expect(paperCheckbox).toBeChecked();
    await expect(deliveryKpi).toHaveText("Email, Paper");
  }
  expect(deliveryRequests).toBe(1);

  await page.reload();
  if (initialPaperChecked) {
    await expect(paperCheckbox).not.toBeChecked();
    await expect(deliveryKpi).toHaveText("Email");
  } else {
    await expect(paperCheckbox).toBeChecked();
    await expect(deliveryKpi).toHaveText("Email, Paper");
  }
  await expect(deliverySave).toBeDisabled();

  // Induce a delivery save failure while checkboxes are dirty:
  // controls re-enable, user's selection is preserved, and Save ends up ENABLED deterministically.
  if (initialPaperChecked) {
    await paperCheckbox.check();
  } else {
    await paperCheckbox.uncheck();
  }
  await expect(deliverySave).toBeEnabled();

  const failDeliveryRequest = async (
    route: import("@playwright/test").Route
  ) => {
    if (
      route.request().method() === "POST" &&
      route.request().url().includes("dwellings.updateInvoiceDelivery")
    ) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          type: "AstroActionError",
          code: "BAD_REQUEST",
          message: "Could not save delivery preferences",
        }),
      });
      return;
    }
    await route.continue();
  };
  await page.route("**/*", failDeliveryRequest);
  await deliverySave.click();

  await expect.poll(() => mutationStatuses(page)).toContain("error");
  await expect(page.locator(".mutation-toasts")).toContainText(
    "Could not save delivery preferences"
  );
  await expect(deliverySave).toBeEnabled();
  await expect(emailCheckbox).toBeEnabled();
  await expect(paperCheckbox).toBeEnabled();
  if (initialPaperChecked) {
    await expect(paperCheckbox).toBeChecked();
  } else {
    await expect(paperCheckbox).not.toBeChecked();
  }
  await page.unroute("**/*", failDeliveryRequest);

  await page
    .locator(
      ".mutation-toasts .mutation-item[data-status='error'] .mutation-dismiss"
    )
    .click();
  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "All changes saved"
  );
  await expect.poll(() => mutationStatuses(page)).not.toContain("error");

  // Revert back to the saved state to leave the form clean
  if (initialPaperChecked) {
    await paperCheckbox.uncheck();
  } else {
    await paperCheckbox.check();
  }
  await expect(deliverySave).toBeDisabled();

  const pageErrors: Error[] = [];
  const onPageError = (err: Error) => pageErrors.push(err);
  page.on("pageerror", onPageError);

  await page.locator("#basic-info-details summary").click();
  const navBillingName = `Nav Persisted ${Date.now()}`;
  const navArea = (10 + (Date.now() % 9000) / 100).toFixed(2);
  await page
    .locator('#basic-info-form input[name="billingName"]')
    .fill(navBillingName);
  await page.locator('#basic-info-form input[name="areaM2"]').fill(navArea);

  let releaseNavBasicInfo!: () => void;
  const navBasicInfoGate = new Promise<void>((resolve) => {
    releaseNavBasicInfo = resolve;
  });
  let navUpdateRequests = 0;
  const onNavUpdateRequest = (request: import("@playwright/test").Request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("dwellings.update") &&
      !request.url().includes("updateInvoiceDelivery")
    ) {
      navUpdateRequests += 1;
    }
  };
  page.on("request", onNavUpdateRequest);

  const holdNavBasicInfoRequest = async (
    route: import("@playwright/test").Route
  ) => {
    if (
      route.request().method() === "POST" &&
      route.request().url().includes("dwellings.update") &&
      !route.request().url().includes("updateInvoiceDelivery")
    ) {
      await navBasicInfoGate;
      await route.continue();
      return;
    }
    await route.continue();
  };
  await page.route("**/*", holdNavBasicInfoRequest);
  await page.locator("#basic-info-form button[type=submit]").click();

  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "1 change saving"
  );
  await page.locator(`.admin-sidebar a[href="${base}/dwellings"]`).click();
  await page.locator(`a[href="${dwellingBHref}"]`).first().click();
  await expect(page).toHaveURL(dwellingBHref!);
  await expect(page.locator("[data-dwelling-detail]")).toBeVisible();
  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "1 change saving"
  );
  expect(pageErrors).toEqual([]);

  const bKpiArea = await page.locator('[data-kpi="area"] p').textContent();
  const bKpiResident = await page
    .locator('[data-kpi="resident-count"] p')
    .textContent();
  const bBillingName = await page
    .locator('dd[data-field="billingName"]')
    .textContent();
  const bAreaM2 = await page.locator('dd[data-field="areaM2"]').textContent();
  const bFormBillingName = await page
    .locator('#basic-info-form input[name="billingName"]')
    .inputValue();
  const bFormAreaM2 = await page
    .locator('#basic-info-form input[name="areaM2"]')
    .inputValue();

  expect(bBillingName).not.toBe(navBillingName);
  expect(bAreaM2).not.toBe(navArea);

  releaseNavBasicInfo();
  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "All changes saved"
  );
  await expect(page.locator(".mutation-toasts")).toContainText("Changes saved");
  await page.unroute("**/*", holdNavBasicInfoRequest);
  page.off("request", onNavUpdateRequest);
  expect(navUpdateRequests).toBe(1);
  expect(pageErrors).toEqual([]);

  await expect(page.locator('[data-kpi="area"] p')).toHaveText(bKpiArea ?? "");
  await expect(page.locator('[data-kpi="resident-count"] p')).toHaveText(
    bKpiResident ?? ""
  );
  await expect(page.locator('dd[data-field="billingName"]')).toHaveText(
    bBillingName ?? ""
  );
  await expect(page.locator('dd[data-field="areaM2"]')).toHaveText(
    bAreaM2 ?? ""
  );
  await expect(
    page.locator('#basic-info-form input[name="billingName"]')
  ).toHaveValue(bFormBillingName);
  await expect(
    page.locator('#basic-info-form input[name="areaM2"]')
  ).toHaveValue(bFormAreaM2);

  await page.locator(`.admin-sidebar a[href="${base}/dwellings"]`).click();
  await page.getByRole("link", { name: dwellingNumber, exact: true }).click();
  await expect(page.locator('[data-kpi="area"] p')).toHaveText(`${navArea} m²`);
  await expect(page.locator('dd[data-field="billingName"]')).toHaveText(
    navBillingName
  );
  await expect(page.locator('dd[data-field="areaM2"]')).toHaveText(navArea);
  expect(pageErrors).toEqual([]);
  page.off("pageerror", onPageError);

  await page.locator("#basic-info-details summary").click();
  await expect(page.locator("#basic-info-details")).toHaveAttribute("open", "");
  const preBillingName =
    (
      await page.locator('dd[data-field="billingName"]').textContent()
    )?.trim() ?? "";
  const preAreaM2 =
    (await page.locator('dd[data-field="areaM2"]').textContent())?.trim() ?? "";
  const preKpiArea =
    (await page.locator('[data-kpi="area"] p').textContent())?.trim() ?? "";
  const preFormBillingName = await page
    .locator('#basic-info-form input[name="billingName"]')
    .inputValue();
  const preFormAreaM2 = await page
    .locator('#basic-info-form input[name="areaM2"]')
    .inputValue();

  expect(preBillingName).toBe(navBillingName);
  expect(preFormBillingName).toBe(navBillingName);
  expect(preAreaM2).toBe(navArea);
  expect(preFormAreaM2).toBe(navArea);

  const rollbackBillingName = `Rollback test ${Date.now()}`;
  const rollbackArea = "91.50";
  await page
    .locator('#basic-info-form input[name="billingName"]')
    .fill(rollbackBillingName);
  await page
    .locator('#basic-info-form input[name="areaM2"]')
    .fill(rollbackArea);

  const dwellingUrlBeforeSubmit = page.url();

  let releaseRollbackGate!: () => void;
  const rollbackGate = new Promise<void>((resolve) => {
    releaseRollbackGate = resolve;
  });
  let rollbackUpdateRequests = 0;
  const holdAndFailBasicInfoRequest = async (
    route: import("@playwright/test").Route
  ) => {
    if (
      route.request().method() === "POST" &&
      route.request().url().includes("dwellings.update") &&
      !route.request().url().includes("updateInvoiceDelivery")
    ) {
      rollbackUpdateRequests += 1;
      await rollbackGate;
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          type: "AstroActionError",
          code: "BAD_REQUEST",
          message: "Could not save dwelling information",
        }),
      });
      return;
    }
    await route.continue();
  };
  await page.route("**/*", holdAndFailBasicInfoRequest);
  await page.locator("#basic-info-form button[type=submit]").click();

  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "1 change saving"
  );
  await expect.poll(() => rollbackUpdateRequests).toBe(1);
  await expect.poll(() => mutationStatuses(page)).toContain("pending");
  await expect(page.locator('dd[data-field="billingName"]')).toHaveText(
    rollbackBillingName
  );
  await expect(page.locator('dd[data-field="areaM2"]')).toHaveText(
    rollbackArea
  );
  await expect(page.locator('[data-kpi="area"] p')).toHaveText(
    `${rollbackArea} m²`
  );

  releaseRollbackGate();

  await expect(page.locator('dd[data-field="billingName"]')).toHaveText(
    preBillingName
  );
  await expect(page.locator('dd[data-field="areaM2"]')).toHaveText(preAreaM2);
  await expect(page.locator('[data-kpi="area"] p')).toHaveText(preKpiArea);

  await expect(
    page.locator('#basic-info-form input[name="billingName"]')
  ).toHaveValue(rollbackBillingName);
  await expect(
    page.locator('#basic-info-form input[name="areaM2"]')
  ).toHaveValue(rollbackArea);
  await expect(
    page.locator("#basic-info-form button[type=submit]")
  ).toBeEnabled();

  const inlineAlert = page.locator(
    '#basic-info-details .edit-disclosure-panel [role="alert"]'
  );
  await expect(inlineAlert).toBeVisible();
  await expect(inlineAlert).toHaveText("Could not save dwelling information");

  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "1 change needs attention"
  );
  await expect.poll(() => mutationStatuses(page)).toContain("error");
  await expect(page.locator(".mutation-toasts")).toContainText(
    "Could not save dwelling information"
  );

  expect(page.url()).toBe(dwellingUrlBeforeSubmit);
  await page.unroute("**/*", holdAndFailBasicInfoRequest);
  expect(rollbackUpdateRequests).toBe(1);

  await page
    .locator(
      ".mutation-toasts .mutation-item[data-status='error'] .mutation-dismiss"
    )
    .click();
  await expect(page.locator("[data-mutation-summary]")).toHaveText(
    "All changes saved"
  );
  await expect.poll(() => mutationStatuses(page)).not.toContain("error");
  await page.locator("#basic-info-details summary").click();

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

test("invoice delivery UI lifecycle: unknown, paper-only, email+paper, unknown+paper, failed, and sent", async ({
  page,
}) => {
  const db = await createDb(dbUrl);
  const supabaseAdmin = createSupabaseAdminClient(
    supabaseUrl,
    supabaseSecretKey
  );

  const createdDwellingIds: string[] = [];
  const createdInvoiceIds: string[] = [];

  let orgId = "";
  let periodId = "";
  let adminUserId = "";

  try {
    // Log in as seeded admin
    const base = await loginAdmin(page);
    orgId = base.replace("/admin/o/", "");

    // Resolve adminUserId from appUsers
    const [adminUser] = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.emailSnapshot, "admin.a@example.com"))
      .limit(1);
    expect(adminUser).toBeDefined();
    adminUserId = adminUser.id;

    // Resolve current open billing period for orgA
    const [curPeriod] = await db
      .select({ id: billingPeriods.id })
      .from(billingPeriods)
      .where(
        and(
          eq(billingPeriods.organizationId, orgId),
          eq(billingPeriods.status, "OPEN")
        )
      )
      .limit(1);
    expect(curPeriod).toBeDefined();
    periodId = curPeriod.id;

    // =========================================================================
    // Scenario 1: UNKNOWN WITHOUT DELIVERY ROW
    // - Invoice with sentAt: null, PREPARED caseStatus
    // - invoice_send_attempts row in UNKNOWN status (reconciled/created directly)
    // - ZERO invoice_deliveries rows
    // Assert: warning notice visible, "Send" NOT present, "Resend" visible & enabled,
    // standalone "Email — Needs attention" note visible.
    // =========================================================================
    const inv1 = await setupPreparedE2EInvoice(
      db,
      supabaseAdmin,
      orgId,
      periodId,
      adminUserId,
      {
        invoiceByEmail: true,
        invoiceByPaper: false,
        billingEmail: `resident.s1.${Date.now()}@example.com`,
      }
    );
    createdDwellingIds.push(inv1.dwelling.id);
    createdInvoiceIds.push(inv1.invoice.id);

    // Direct DB seeding for UNKNOWN attempt without delivery row:
    // Simulated stale attempt reconciled to UNKNOWN (as proven in send-attempts integration tests)
    const claim1 = await claimSendAttempt(db, orgId, inv1.invoice.id);
    await markUnknown(db, claim1.attempt.id, "STALE_DISPATCH_NO_CONFIRMATION");

    const inv1Url = `${base}/periods/${periodId}/invoices/${inv1.invoice.id}`;
    await page.goto(inv1Url);

    // Assert: warning notice is visible with its distinctive text
    const warningNotice = page.locator(".notice.notice-warning[role='alert']");
    await expect(warningNotice).toBeVisible();
    await expect(warningNotice).toContainText(
      "Delivery outcome could not be confirmed"
    );

    // Assert: standalone "Email — Needs attention" note (for zero delivery rows) is visible
    await expect(warningNotice).toContainText("Email — Needs attention");

    // Assert: delivery history section is not rendered when there are zero delivery rows
    await expect(
      page.locator("section", { hasText: "Delivery history" })
    ).toHaveCount(0);

    // Assert: normal "Send" button is NOT present/visible
    await expect(
      page.getByRole("button", { name: "Send", exact: true })
    ).toHaveCount(0);

    // Assert: "Resend" button IS visible and enabled
    const resendBtn1 = page.getByRole("button", {
      name: "Resend",
      exact: true,
    });
    await expect(resendBtn1).toBeVisible();
    await expect(resendBtn1).toBeEnabled();

    // =========================================================================
    // Scenario 2: PAPER ONLY
    // - PREPARED invoice with invoiceByEmail: false, invoiceByPaper: true, billingEmail: null
    // Assert:
    // 1. No electronic "Send" button anywhere on the page
    // 2. "Download PDF" link is present, returns real PDF
    // 3. No "email is missing" blocking validation message appears
    // 4. After opening/fetching PDF, invoice case status is STILL PREPARED, sentAt is null,
    //    and no PAPER invoice_deliveries row appeared from that PDF access
    // 5. "Record paper dispatch" button is visible
    // 6. Click it -> page reload -> "Paper dispatched" static text, case status badge shows SENT
    // 7. Reload again -> still only ONE paper delivery record, does not offer button again
    // =========================================================================
    const inv2 = await setupPreparedE2EInvoice(
      db,
      supabaseAdmin,
      orgId,
      periodId,
      adminUserId,
      {
        invoiceByEmail: false,
        invoiceByPaper: true,
        billingEmail: null,
      }
    );
    createdDwellingIds.push(inv2.dwelling.id);
    createdInvoiceIds.push(inv2.invoice.id);

    const inv2Url = `${base}/periods/${periodId}/invoices/${inv2.invoice.id}`;
    await page.goto(inv2Url);

    // 1. Assert: no electronic "Send" or "Resend" button exists anywhere on the page
    await expect(
      page.getByRole("button", { name: "Send", exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Resend", exact: true })
    ).toHaveCount(0);

    // 2. Assert: "Download PDF" link IS present and returns a real PDF
    const pdfLink2 = page.getByRole("link", { name: "Download PDF" });
    await expect(pdfLink2).toBeVisible();
    const pdfHref2 = await pdfLink2.getAttribute("href");
    expect(pdfHref2).toBeTruthy();
    const pdfResp2 = await page.request.get(pdfHref2!);
    expect(pdfResp2.ok()).toBe(true);
    expect(pdfResp2.headers()["content-type"]).toContain("application/pdf");

    // 3. Assert: no "email is missing" blocking validation message appears
    await expect(page.locator("#email-validation")).toHaveCount(0);
    await expect(page.locator("text=Invoice email is missing")).toHaveCount(0);

    // 4. Assert: after fetching PDF, case status is STILL PREPARED, sentAt is null,
    // and no PAPER delivery row exists
    await expect(page.locator("h1 .status-badge")).toContainText("Prepared");
    const [inv2DbCheck] = await db
      .select({ sentAt: invoices.sentAt })
      .from(invoices)
      .where(eq(invoices.id, inv2.invoice.id));
    expect(inv2DbCheck.sentAt).toBeNull();
    const paperDelsBefore = await db
      .select()
      .from(invoiceDeliveries)
      .where(
        and(
          eq(invoiceDeliveries.invoiceId, inv2.invoice.id),
          eq(invoiceDeliveries.method, "PAPER")
        )
      );
    expect(paperDelsBefore).toHaveLength(0);

    // 5. Assert: "Record paper dispatch" button IS visible
    const recordPaperBtn2 = page.getByRole("button", {
      name: "Record paper dispatch",
      exact: true,
    });
    await expect(recordPaperBtn2).toBeVisible();

    // 6. Click "Record paper dispatch"
    await recordPaperBtn2.click();

    // Assert: after the resulting page reload, exactly one "Paper dispatched" status is shown
    // button replaced by static text, case status badge shows SENT
    await expect(page.locator("h1 .status-badge")).toContainText("Sent");
    await expect(page.getByText("Paper dispatched")).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Record paper dispatch",
        exact: true,
      })
    ).toHaveCount(0);

    // 7. Reload the page again and confirm there is still only ONE paper delivery record
    // and the page does not offer to record it again
    await page.reload();
    await expect(page.locator("h1 .status-badge")).toContainText("Sent");
    await expect(page.getByText("Paper dispatched")).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Record paper dispatch",
        exact: true,
      })
    ).toHaveCount(0);

    const paperDelsAfter = await db
      .select()
      .from(invoiceDeliveries)
      .where(
        and(
          eq(invoiceDeliveries.invoiceId, inv2.invoice.id),
          eq(invoiceDeliveries.method, "PAPER")
        )
      );
    expect(paperDelsAfter).toHaveLength(1);

    // =========================================================================
    // Scenario 3: EMAIL + PAPER
    // - PREPARED invoice with valid billingEmail, both methods enabled
    // - Before any send: assert "Send", "Download PDF", "Record paper dispatch" all visible
    // - Force definitive email failure (direct DB seed: Mailpit accepts all mail so real SMTP rejection is impractical)
    // - After failure: assert invoice remains PREPARED, single retry action ("Send", not two competing buttons)
    // - Click "Record paper dispatch": invoice becomes SENT, exactly one PAPER delivery row,
    //   earlier FAILED email row still shown as FAILED in delivery history (not overwritten)
    // =========================================================================
    const inv3 = await setupPreparedE2EInvoice(
      db,
      supabaseAdmin,
      orgId,
      periodId,
      adminUserId,
      {
        invoiceByEmail: true,
        invoiceByPaper: true,
        billingEmail: `resident.s3.${Date.now()}@example.com`,
      }
    );
    createdDwellingIds.push(inv3.dwelling.id);
    createdInvoiceIds.push(inv3.invoice.id);

    const inv3Url = `${base}/periods/${periodId}/invoices/${inv3.invoice.id}`;
    await page.goto(inv3Url);

    // Before send: assert "Send", "Download PDF", "Record paper dispatch" are all independently visible
    await expect(
      page.getByRole("button", { name: "Send", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Download PDF" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Record paper dispatch",
        exact: true,
      })
    ).toBeVisible();

    // Force definitive email failure via direct DB seeding:
    // Because the local Mailpit SMTP server accepts all recipient addresses indiscriminately,
    // creating a definitive rejection through the live SMTP path is impractical at E2E layer.
    // Direct DB seeding establishes the canonical FAILED attempt + FAILED delivery row.
    const claim3 = await claimSendAttempt(db, orgId, inv3.invoice.id);
    await markFailed(db, claim3.attempt.id, "SMTP_REJECTED");
    await db.insert(invoiceDeliveries).values({
      organizationId: orgId,
      invoiceId: inv3.invoice.id,
      attemptId: claim3.attempt.id,
      method: "EMAIL",
      destinationEmail: `resident.s3.${Date.now()}@example.com`,
      provider: "smtp",
      status: "FAILED",
      errorCode: "SMTP_REJECTED",
    });

    await page.reload();

    // Assert: invoice remains PREPARED (paper preference did not silently mark it SENT)
    await expect(page.locator("h1 .status-badge")).toContainText("Prepared");

    // Assert: a single clear retry action is present (Send button, not both Send and Resend)
    await expect(
      page.getByRole("button", { name: "Send", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Resend", exact: true })
    ).toHaveCount(0);

    // Click "Record paper dispatch"
    await page
      .getByRole("button", { name: "Record paper dispatch", exact: true })
      .click();

    // Assert: invoice becomes SENT, exactly one PAPER delivery row/status appears
    await expect(page.locator("h1 .status-badge")).toContainText("Sent");
    await expect(page.getByText("Paper dispatched")).toBeVisible();

    // Assert: earlier FAILED email delivery row is still shown as FAILED in delivery history
    const historySection3 = page.locator("section", {
      hasText: "Delivery history",
    });
    await expect(historySection3).toBeVisible();
    const emailRow3 = historySection3.locator("tbody tr", {
      hasText: "Email",
    });
    await expect(emailRow3).toContainText("Failed");
    const paperRow3 = historySection3.locator("tbody tr", {
      hasText: "Paper",
    });
    await expect(paperRow3).toContainText("Sent");

    // =========================================================================
    // Scenario 4: EMAIL UNKNOWN THEN PAPER DISPATCH
    // - Building on UNKNOWN seed with paper ALSO enabled
    // - Click "Record paper dispatch"
    // - Assert: invoice becomes SENT; delivery history still shows EMAIL side as "Needs attention"/UNKNOWN,
    //   never rewritten to Sent or Failed; exactly one PAPER delivery row appears;
    //   no new email was sent (Mailpit message count unchanged).
    // =========================================================================
    const inv4 = await setupPreparedE2EInvoice(
      db,
      supabaseAdmin,
      orgId,
      periodId,
      adminUserId,
      {
        invoiceByEmail: true,
        invoiceByPaper: true,
        billingEmail: `resident.s4.${Date.now()}@example.com`,
      }
    );
    createdDwellingIds.push(inv4.dwelling.id);
    createdInvoiceIds.push(inv4.invoice.id);

    // Direct DB seed of UNKNOWN attempt and delivery row:
    const claim4 = await claimSendAttempt(db, orgId, inv4.invoice.id);
    await markUnknown(db, claim4.attempt.id, "PROVIDER_TIMEOUT");
    await db.insert(invoiceDeliveries).values({
      organizationId: orgId,
      invoiceId: inv4.invoice.id,
      attemptId: claim4.attempt.id,
      method: "EMAIL",
      destinationEmail: `resident.s4.${Date.now()}@example.com`,
      provider: "smtp",
      status: "UNKNOWN",
      errorCode: "PROVIDER_TIMEOUT",
    });

    const inv4Url = `${base}/periods/${periodId}/invoices/${inv4.invoice.id}`;
    await page.goto(inv4Url);

    // Capture Mailpit message count before clicking Record paper dispatch
    const mailpitRespBefore4 = await page.request.get(
      "http://127.0.0.1:54324/api/v1/messages"
    );
    const mailboxBefore4 = (await mailpitRespBefore4.json()) as {
      messages?: unknown[];
    };
    const countBefore4 = mailboxBefore4.messages?.length ?? 0;

    // Click "Record paper dispatch"
    await page
      .getByRole("button", { name: "Record paper dispatch", exact: true })
      .click();

    // Assert: invoice becomes SENT
    await expect(page.locator("h1 .status-badge")).toContainText("Sent");

    // Assert: delivery history still shows EMAIL as "Needs attention", never rewritten to Sent or Failed
    const historySection4 = page.locator("section", {
      hasText: "Delivery history",
    });
    await expect(historySection4).toBeVisible();
    const emailRow4 = historySection4.locator("tbody tr", {
      hasText: "Email",
    });
    await expect(emailRow4).toContainText("Needs attention");
    await expect(emailRow4).not.toContainText("Failed");

    // Assert: exactly one PAPER delivery row appears
    const paperRow4 = historySection4.locator("tbody tr", {
      hasText: "Paper",
    });
    await expect(paperRow4).toContainText("Sent");

    // Assert: no new email was sent as any part of this action
    const mailpitRespAfter4 = await page.request.get(
      "http://127.0.0.1:54324/api/v1/messages"
    );
    const mailboxAfter4 = (await mailpitRespAfter4.json()) as {
      messages?: unknown[];
    };
    const countAfter4 = mailboxAfter4.messages?.length ?? 0;
    expect(countAfter4).toBe(countBefore4);

    // =========================================================================
    // Scenario 5: FAILED
    // - Definitively-FAILED first electronic attempt
    // - Assert exactly ONE electronic retry control is visible (the "Send" button)
    // - Assert there is NOT also a separate "Resend" button visible at the same time
    // =========================================================================
    const inv5 = await setupPreparedE2EInvoice(
      db,
      supabaseAdmin,
      orgId,
      periodId,
      adminUserId,
      {
        invoiceByEmail: true,
        invoiceByPaper: false,
        billingEmail: `resident.s5.${Date.now()}@example.com`,
      }
    );
    createdDwellingIds.push(inv5.dwelling.id);
    createdInvoiceIds.push(inv5.invoice.id);

    // Direct DB seed of definitively-FAILED first electronic attempt
    const claim5 = await claimSendAttempt(db, orgId, inv5.invoice.id);
    await markFailed(db, claim5.attempt.id, "SMTP_REJECTED");
    await db.insert(invoiceDeliveries).values({
      organizationId: orgId,
      invoiceId: inv5.invoice.id,
      attemptId: claim5.attempt.id,
      method: "EMAIL",
      destinationEmail: `resident.s5.${Date.now()}@example.com`,
      provider: "smtp",
      status: "FAILED",
      errorCode: "SMTP_REJECTED",
    });

    const inv5Url = `${base}/periods/${periodId}/invoices/${inv5.invoice.id}`;
    await page.goto(inv5Url);

    // Assert exactly ONE electronic retry control is visible (the "Send" button)
    const sendBtn5 = page.getByRole("button", {
      name: "Send",
      exact: true,
    });
    await expect(sendBtn5).toBeVisible();
    await expect(sendBtn5).toBeEnabled();

    // Assert there is NOT also a separate "Resend" button visible at the same time
    await expect(
      page.getByRole("button", { name: "Resend", exact: true })
    ).toHaveCount(0);

    // =========================================================================
    // Scenario 6: SENT
    // - Normal already-SENT invoice (send for real through UI with real Mailpit address)
    // Assert:
    // 1. Normal first "Send" button is gone
    // 2. "Resend" is available
    // 3. If paper was also enabled, paper control correctly reflects whichever paper-dispatch
    //    state applies (not yet recorded -> button still offered, independent of email SENT state)
    // =========================================================================
    const sentBillingEmail = `e2e-sent-${Date.now()}@example.com`;
    const inv6 = await setupPreparedE2EInvoice(
      db,
      supabaseAdmin,
      orgId,
      periodId,
      adminUserId,
      {
        invoiceByEmail: true,
        invoiceByPaper: true,
        billingEmail: sentBillingEmail,
      }
    );
    createdDwellingIds.push(inv6.dwelling.id);
    createdInvoiceIds.push(inv6.invoice.id);

    const inv6Url = `${base}/periods/${periodId}/invoices/${inv6.invoice.id}`;
    await page.goto(inv6Url);

    // Assert Send button is present initially
    const sendBtn6 = page.getByRole("button", {
      name: "Send",
      exact: true,
    });
    await expect(sendBtn6).toBeVisible();
    await expect(sendBtn6).toBeEnabled();

    // Send for real through the browser UI
    await sendBtn6.click();

    // Assert page updates to SENT
    await expect(page.locator("h1 .status-badge")).toContainText("Sent");

    // Verify Mailpit actually received the real SMTP email
    await expect
      .poll(async () => {
        const resp = await page.request.get(
          "http://127.0.0.1:54324/api/v1/messages"
        );
        if (!resp.ok()) return false;
        const data = (await resp.json()) as {
          messages: { To: { Address: string }[]; Subject: string }[];
        };
        return data.messages?.some(
          (m) =>
            m.To?.some((t) => t.Address === sentBillingEmail) &&
            m.Subject?.includes(inv6.invoice.invoiceNumber)
        );
      })
      .toBe(true);

    // Assert: normal first "Send" button is gone
    await expect(
      page.getByRole("button", { name: "Send", exact: true })
    ).toHaveCount(0);

    // Assert: "Resend" button is available
    const resendBtn6 = page.getByRole("button", {
      name: "Resend",
      exact: true,
    });
    await expect(resendBtn6).toBeVisible();
    await expect(resendBtn6).toBeEnabled();

    // Assert: paper control correctly reflects not-yet-recorded state (button still offered,
    // independent of email SENT state)
    await expect(
      page.getByRole("button", {
        name: "Record paper dispatch",
        exact: true,
      })
    ).toBeVisible();
  } finally {
    await cleanupTestDwellingsAndInvoices(
      db,
      createdDwellingIds,
      createdInvoiceIds
    );
    await db.$client.end();
  }
});
