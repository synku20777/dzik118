import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "../../src/db/client";
import { billingPeriods } from "../../src/db/schema/billing";
import { dwellingAccess } from "../../src/db/schema/dwellings";
import { invoices } from "../../src/db/schema/invoices";
import { createOrganization } from "../../src/domain/organizations/organizations";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import { createMeter } from "../../src/domain/organizations/meters";
import { createPeriod } from "../../src/domain/periods/periods";
import { submitAdminReading } from "../../src/domain/periods/readings";
import { createRule } from "../../src/domain/billing/rules";
import {
  generateInvoice,
  prepareInvoice,
} from "../../src/domain/billing/generation";
import { recordPaperDispatch } from "../../src/domain/billing/sending";
import { recordManualPayment } from "../../src/domain/payments/manual";
import {
  reply,
  resolveConversation,
} from "../../src/domain/messaging/conversations";
import { createSupabaseAdminClient } from "../../src/lib/supabase/admin";
import { cleanupOrganization } from "../integration/_helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);
const adminId = "10000000-0000-4000-8000-0000000000a1";
const residentId = "20000000-0000-4000-8000-000000000001";
let db: Db;
let organizationId: string | undefined;

test.afterAll(async () => {
  if (!db) return;
  try {
    if (organizationId) await cleanupOrganization(db, organizationId);
  } finally {
    await db.$client.end();
  }
});

test("residents can copy the remaining balance, save readings and chat with the administrator", async ({
  page,
  browser,
}, testInfo) => {
  const dbUrl = process.env.DATABASE_URL!;
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(dbUrl).hostname
  );
  db = await createDb(dbUrl);
  const org = await createOrganization(
    db,
    {
      name: "Resident portal browser fixture",
      addressLine1: "1 Test Street",
      bankName: "Test Bank",
      iban: "DE89370400440532013000",
      bic: "DEUTDEFF",
    },
    adminId
  );
  organizationId = org.id;
  const dwelling = await createDwelling(
    db,
    org.id,
    {
      number: "42",
      billingName: "Test Resident",
      billingAddress: "1 Test Street, 42",
      invoiceByEmail: false,
      invoiceByPaper: true,
    },
    adminId
  );
  await db
    .insert(dwellingAccess)
    .values({ dwellingId: dwelling.id, userId: residentId });
  const meters = [];
  for (const type of ["COLD_WATER", "HOT_WATER", "ELECTRICITY"] as const) {
    meters.push(
      await createMeter(
        db,
        org.id,
        dwelling.id,
        {
          type,
          unit: type === "ELECTRICITY" ? "kWh" : "m³",
          serialNumber: type,
        },
        adminId
      )
    );
  }
  await createRule(
    db,
    org.id,
    {
      code: "FEE",
      name: "Fee",
      calculationType: "FIXED",
      unit: "month",
      unitPrice: "50.00",
      effectiveFrom: "2020-01-01",
    },
    adminId
  );
  const year = new Date().getUTCFullYear() + 1;
  const prior = await createPeriod(
    db,
    org.id,
    {
      year,
      month: 1,
      startsOn: `${year}-01-01`,
      endsOn: `${year}-01-31`,
      invoiceIssueDate: `${year}-01-31`,
      invoiceDueDate: `${year}-02-14`,
    },
    adminId
  );
  for (const meter of meters)
    await submitAdminReading(db, org.id, prior.id, meter.id, "10.000", adminId);
  const generated = await generateInvoice(
    db,
    org.id,
    prior.id,
    dwelling.id,
    adminId
  );
  const invoice = await prepareInvoice(db, org.id, generated.id, adminId);
  await recordPaperDispatch(db, org.id, invoice.id, adminId);
  await recordManualPayment(
    db,
    org.id,
    {
      invoiceId: invoice.id,
      amount: "20.00",
      bookingDate: new Date().toISOString().slice(0, 10),
      reason: "Browser fixture",
      method: "CASH",
    },
    adminId
  );
  const period = await createPeriod(
    db,
    org.id,
    {
      year,
      month: 2,
      startsOn: `${year}-02-01`,
      endsOn: `${year}-02-28`,
      readingDeadline: `${year}-02-28`,
      invoiceIssueDate: `${year}-02-28`,
      invoiceDueDate: `${year}-03-14`,
    },
    adminId
  );
  const home = `/portal/dwellings/${dwelling.id}`;
  const detail = `/portal/invoices/${invoice.id}?dwellingId=${dwelling.id}`;

  const supabase = createSupabaseAdminClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: "resident1@example.com",
  });
  if (error) throw error;
  await page.goto(
    `/auth/confirm?token_hash=${data.properties.hashed_token}&type=email&lang=en`
  );
  await page.getByRole("button", { name: "Confirm sign-in" }).click();
  await page.waitForURL(/\/portal\//);
  await page.goto(`${home}?lang=en`);
  // The bill is still reachable when the next month's invoice does not exist.
  await expect(page.locator("#bill-heading")).toHaveText("Latest bill");
  await expect(page.locator(".resident-amount")).toHaveText("€30.00");
  await expect(page.getByRole("link", { name: "How to pay" })).toHaveAttribute(
    "href",
    detail
  );
  await page.screenshot({
    path: testInfo.outputPath("resident-home.png"),
    fullPage: true,
    style: "astro-dev-toolbar { display: none !important; }",
  });

  await page.goto(detail + "&lang=en");
  await expect(page.locator(".resident-payment-fields")).toContainText(
    "DE89370400440532013000"
  );
  await expect(page.locator('[data-copy-value="30.00"]')).toHaveCount(1);
  await expect(page.locator('[data-copy-value="50.00"]')).toHaveCount(0);
  await expect(page.locator(".notice-warning")).toContainText(
    "Pay only the amount still due"
  );
  await page.screenshot({
    path: testInfo.outputPath("resident-payment.png"),
    fullPage: true,
    style: "astro-dev-toolbar { display: none !important; }",
  });
  await expect(
    page.locator("#invoice-preview-frame").contentFrame().locator(".payment-qr")
  ).toHaveCount(0);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy: IBAN", exact: true }).click();
  await expect(page.locator("[data-copy-status]")).toContainText("Copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "DE89370400440532013000"
  );
  // Clipboard denial gives a usable manual-copy fallback.
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error("Denied");
    };
  });
  await page.getByRole("button", { name: "Copy: IBAN", exact: true }).click();
  await expect(page.locator("[data-copy-status]")).toContainText(
    "Could not copy"
  );

  await page.goto(`${home}?lang=en`);
  const fields = page.locator(
    '[data-resident-reading] input[name="currentValue"]'
  );
  await expect(fields).toHaveCount(3);
  await db
    .update(billingPeriods)
    .set({ readingDeadline: "2020-01-01" })
    .where(eq(billingPeriods.id, period.id));
  await page.reload();
  await expect(page.locator("#readings")).toContainText(
    "The reading deadline has passed"
  );
  await expect(fields).toHaveCount(0);
  await db
    .update(billingPeriods)
    .set({ readingDeadline: `${year}-02-28` })
    .where(eq(billingPeriods.id, period.id));
  await page.reload();
  await expect(fields).toHaveCount(3);
  await fields.nth(1).fill("17,250");
  await fields.first().fill("9");
  await fields.first().press("Enter");
  await expect(page.locator(".form-inline-error")).toBeVisible();
  await expect(fields.first()).toHaveValue("9");
  await expect(fields.first()).toHaveAttribute("aria-invalid", "true");
  await expect(fields.first()).toBeFocused();
  await fields.first().fill("12,345");
  expect(
    await fields.first().evaluate((el: HTMLInputElement) => el.checkValidity())
  ).toBe(true);
  await fields.first().press("Enter");
  await expect(page.locator("[data-resident-reading]")).toHaveCount(2);
  await expect(fields.first()).toHaveValue("17,250");
  await expect(
    page.locator("[data-reading-received]:visible").first()
  ).toContainText("12.345");
  await fields.first().press("Enter");
  await expect(page.locator("[data-resident-reading]")).toHaveCount(1);

  // Native POST works without JavaScript and redirects after a successful save.
  const native = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  try {
    const plain = await native.newPage();
    await plain.goto(`http://localhost:4321${home}?lang=en`);
    await plain.locator('input[name="currentValue"]').fill("22,125");
    await plain
      .locator('[data-resident-reading] button[type="submit"]')
      .click();
    await expect(plain).toHaveURL(new RegExp(`${dwelling.id}#readings$`));
    await expect(plain.locator("[data-all-readings]")).toBeVisible();
    await plain.reload();
    await expect(plain.locator("[data-resident-reading]")).toHaveCount(0);
  } finally {
    await native.close();
  }
  await page.reload();
  await expect(page.locator("[data-all-readings]")).toBeVisible();
  const saved = await db.$client.query(
    "select current_value from meter_readings where period_id = $1 order by current_value",
    [period.id]
  );
  expect(saved.rows.map((row) => row.current_value)).toEqual([
    "12.345",
    "17.250",
    "22.125",
  ]);

  // Sign out is in the header on every page, not at the foot of Profile.
  await expect(
    page.locator("header").getByRole("button", { name: "Sign out" })
  ).toBeVisible();
  await page.goto("/portal/profile?lang=en");
  await expect(
    page.locator("main").getByRole("button", { name: "Sign out" })
  ).toHaveCount(0);

  // One chat with one message box and no Subject field. A message joins the
  // open conversation; the first one names it.
  const mine = page.locator('.resident-chat-msg[data-from="me"]');
  await page.goto(`${home}/messages?lang=en`);
  await expect(page.locator("[data-chat-empty]")).toBeVisible();
  await expect(page.locator('main [name="subject"]')).toHaveCount(0);
  const box = page.getByLabel("Your message");
  await expect(box).toHaveValue("");
  await box.fill("Is the water off on Friday?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(mine).toHaveCount(1);
  await expect(page.locator("[data-chat-empty]")).toHaveCount(0);
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  await box.fill("Second question");
  await box.press("Control+Enter");
  await expect(mine).toHaveCount(2);
  const threads = () =>
    db.$client.query(
      "select id, subject, status from conversations where dwelling_id = $1 order by created_at",
      [dwelling.id]
    );
  expect((await threads()).rows).toMatchObject([
    { subject: "Is the water off on Friday?", status: "OPEN" },
  ]);
  // The administrator's answer is on the other side. Resolving leaves a line
  // in the chat, and the next message starts a new conversation.
  const threadId = (await threads()).rows[0].id;
  await reply(
    db,
    threadId,
    "Yes, from 10 to 12.",
    {
      userId: adminId,
      email: "admin@example.com",
      organizationIds: [org.id],
      dwellingIds: [],
    },
    "ADMIN"
  );
  await resolveConversation(db, org.id, threadId, adminId);
  await page.reload();
  await expect(
    page.locator('.resident-chat-msg[data-from="admin"]')
  ).toContainText("Yes, from 10 to 12.");
  await expect(page.locator(".resident-chat-event")).toContainText("resolved");
  await page.screenshot({
    path: testInfo.outputPath("resident-chat.png"),
    fullPage: true,
    style: "astro-dev-toolbar { display: none !important; }",
  });
  // The native form works without JavaScript and redirects after sending.
  const plainChat = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  try {
    const plain = await plainChat.newPage();
    await plain.goto(`http://localhost:4321${home}/messages?lang=en`);
    await plain.getByLabel("Your message").fill("Thank you");
    await plain.getByRole("button", { name: "Send" }).click();
    await expect(plain).toHaveURL(new RegExp(`${dwelling.id}/messages$`));
    await expect(
      plain.locator('.resident-chat-msg[data-from="me"]')
    ).toHaveCount(3);
  } finally {
    await plainChat.close();
  }
  expect((await threads()).rows).toMatchObject([
    { status: "RESOLVED" },
    { subject: "Thank you", status: "NEW" },
  ]);

  for (const locale of ["en", "lv", "ru"]) {
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript(
        (value) => localStorage.setItem("color-scheme", value),
        theme
      );
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const path of [
          home,
          `${home}/invoices`,
          `${home}/messages`,
          `${home}/payments`,
          "/portal/profile",
          detail,
        ]) {
          await page.goto(
            path + (path.includes("?") ? "&" : "?") + `lang=${locale}`
          );
          await page.evaluate(() => document.fonts.ready);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1
            ),
            `${path} ${locale} ${theme} ${width}`
          ).toBe(true);
          await expect(page.locator("main h1")).toHaveCount(1);
          // The page starts at the same left edge as the tabs above it.
          if (path !== "/portal/profile") {
            expect(
              Math.abs(
                (await page.locator(".resident-nav").boundingBox())!.x -
                  (await page.locator("main h1").boundingBox())!.x
              ),
              `${path} ${locale} ${theme} ${width} alignment`
            ).toBeLessThan(1);
          }
          for (const button of await page
            .locator("main .btn-primary:visible, main .btn-secondary:visible")
            .all()) {
            expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(
              48
            );
          }
        }
      }
    }
  }

  await db
    .update(invoices)
    .set({ paymentSnapshot: { iban: 123 } })
    .where(eq(invoices.id, invoice.id));
  const damaged = await page.goto(detail + "&lang=en");
  expect(damaged?.status()).toBe(200);
  await expect(page.getByRole("alert")).toContainText(
    "stored details are damaged"
  );
  await expect(
    page.locator(".resident-payment-fields, .resident-qr, [data-copy-value]")
  ).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Navigation", exact: true })
  ).toBeVisible();
  await expect(
    page.locator("#invoice-preview-frame").contentFrame().locator("body")
  ).toContainText("stored details are damaged");
  await db
    .update(invoices)
    .set({ paymentSnapshot: invoice.paymentSnapshot })
    .where(eq(invoices.id, invoice.id));
  const nextDraft = await generateInvoice(
    db,
    org.id,
    period.id,
    dwelling.id,
    adminId
  );
  expect(nextDraft.previousOutstanding).toBe("30.00");
  const nextInvoice = await prepareInvoice(db, org.id, nextDraft.id, adminId);
  await recordPaperDispatch(db, org.id, nextInvoice.id, adminId);
  // Same issue dates still select the later-created published bill consistently.
  await db
    .update(invoices)
    .set({ issueDate: invoice.issueDate })
    .where(eq(invoices.id, nextInvoice.id));
  const nextDetail = `/portal/invoices/${nextInvoice.id}?dwellingId=${dwelling.id}`;
  await page.goto(`${home}?lang=en`);
  await expect(page.getByRole("link", { name: "How to pay" })).toHaveAttribute(
    "href",
    nextDetail
  );
  await page.goto(detail + "&lang=en");
  await expect(page.locator("main h1")).toHaveText("Invoice");
  await expect(
    page.locator(".resident-payment-fields, [data-copy-value], .resident-qr")
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open latest bill", exact: true })
  ).toHaveAttribute("href", nextDetail);
  await expect(page.locator(".notice-warning")).toContainText(
    "Do not pay this older bill separately"
  );
  await page.goto(nextDetail + "&lang=en");
  await expect(page.locator(".resident-amount")).toHaveText("€80.00");
  await expect(page.locator('[data-copy-value="80.00"]')).toHaveCount(1);
  await recordManualPayment(
    db,
    org.id,
    {
      invoiceId: nextInvoice.id,
      amount: "80.00",
      bookingDate: new Date().toISOString().slice(0, 10),
      reason: "Browser fixture settlement",
      method: "CASH",
    },
    adminId
  );
  await page.goto(nextDetail + "&lang=en");
  await expect(page.locator(".resident-amount")).toHaveText("€0.00");
  await expect(page.locator(".resident-payment-fields")).toHaveCount(0);
  await expect(page.locator(".resident-qr")).toHaveCount(0);
  // The old allocation stays open even after its debt is settled through the new bill.
  await page.goto(detail + "&lang=en");
  await expect(page.locator("[data-copy-value], .resident-qr")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open latest bill", exact: true })
  ).toBeVisible();
  await db
    .update(billingPeriods)
    .set({ status: "LOCKED" })
    .where(eq(billingPeriods.id, period.id));
  await page.goto(`${home}?lang=en`);
  await expect(page.locator("#readings")).toContainText(
    "There is no open reading period"
  );
  await expect(page.locator("[data-resident-reading]")).toHaveCount(0);
});
