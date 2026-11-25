import { expect, test, type Page } from "@playwright/test";
import { createDb, type Db } from "../../src/db/client";
import { createOrganization } from "../../src/domain/organizations/organizations";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import { createPeriod } from "../../src/domain/periods/periods";
import { createRule } from "../../src/domain/billing/rules";
import {
  generateInvoice,
  prepareInvoice,
} from "../../src/domain/billing/generation";
import { cleanupOrganization } from "../integration/_helpers";

// An email whose delivery outcome is UNKNOWN stays unsent until an admin
// confirms it arrived. The button posts a plain form, so this also proves the
// middleware's redirect after a successful form action on a real server.
test.setTimeout(180_000);
const adminId = "10000000-0000-4000-8000-0000000000a1";
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

async function login(page: Page) {
  await page.goto("/login?lang=en");
  await page.locator("#admin-email").fill("admin.a@example.com");
  await page.locator("#admin-password").fill("ChangeMe123!");
  await page.locator("#admin-login-form button").click();
  await page.waitForURL(/\/admin\//);
}

test("an admin marks an invoice with an unconfirmed email as delivered", async ({
  page,
}) => {
  const dbUrl = process.env.DATABASE_URL!;
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(dbUrl).hostname
  );
  db = await createDb(dbUrl);
  const org = await createOrganization(
    db,
    {
      name: `Unknown delivery fixture ${Date.now()}`,
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
      number: "7",
      billingName: "Test Resident",
      billingAddress: "1 Test Street, 7",
      billingEmail: "resident7@example.com",
    },
    adminId
  );
  const period = await createPeriod(
    db,
    org.id,
    {
      year: 2026,
      month: 3,
      startsOn: "2026-03-01",
      endsOn: "2026-03-31",
      invoiceIssueDate: "2026-03-31",
      invoiceDueDate: "2026-04-14",
    },
    adminId
  );
  await createRule(
    db,
    org.id,
    {
      name: "Fee",
      code: "fee",
      calculationType: "FIXED",
      unit: "month",
      unitPrice: "10.00",
      vatRate: "21.0000",
      effectiveFrom: "2025-01-01",
    },
    adminId
  );
  const generated = await generateInvoice(
    db,
    org.id,
    period.id,
    dwelling.id,
    adminId
  );
  const invoice = await prepareInvoice(db, org.id, generated.id, adminId);
  // What sendInvoice leaves behind when the provider's answer is ambiguous.
  const {
    rows: [attempt],
  } = await db.$client.query(
    `insert into invoice_send_attempts (organization_id, invoice_id, status, error_code, completed_at)
     values ($1, $2, 'UNKNOWN', 'FAKE_AMBIGUOUS', now()) returning id`,
    [org.id, invoice.id]
  );
  await db.$client.query(
    `insert into invoice_deliveries (organization_id, invoice_id, attempt_id, method, destination_email, provider, status, error_code)
     values ($1, $2, $3, 'EMAIL', 'resident7@example.com', 'smtp', 'UNKNOWN', 'FAKE_AMBIGUOUS')`,
    [org.id, invoice.id, attempt.id]
  );

  await login(page);
  const invoicePath = `/admin/o/${org.id}/periods/${period.id}/invoices/${invoice.id}`;
  await page.goto(`${invoicePath}?lang=en`);
  const warning = page.getByText("Delivery outcome could not be confirmed.");
  await expect(warning).toBeVisible();

  await page.getByRole("button", { name: "Mark as delivered" }).click();
  // data-confirm asks in the app's modal card, not the browser's dialog.
  await page.locator("#confirm-dialog [data-confirm-ok]").click();

  // Redirected back with a GET, carrying the success message.
  await expect(page.getByText("Invoice marked as delivered.")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(invoicePath);
  expect(new URL(page.url()).searchParams.has("_action")).toBe(false);
  await expect(warning).toHaveCount(0);
  // Delivered by email now, so Resend (not a no-op Send) is offered.
  await expect(page.getByRole("button", { name: "Resend" })).toBeVisible();

  // A refresh is a plain GET: no resubmission, and the message is gone.
  let resubmitPrompt = false;
  page.on("dialog", (dialog) => {
    resubmitPrompt = true;
    void dialog.dismiss();
  });
  await page.reload();
  await expect(page.getByText("Invoice marked as delivered.")).toHaveCount(0);
  expect(resubmitPrompt).toBe(false);

  const {
    rows: [state],
  } = await db.$client.query(
    `select a.status as attempt, c.status as case_status, i.sent_at is not null as sent
       from invoice_send_attempts a
       join invoices i on i.id = a.invoice_id
       join billing_cases c on c.id = i.billing_case_id
      where a.id = $1`,
    [attempt.id]
  );
  expect(state).toEqual({ attempt: "SENT", case_status: "SENT", sent: true });
});
