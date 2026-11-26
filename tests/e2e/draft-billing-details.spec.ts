import { expect, test } from "@playwright/test";
import { createDb } from "../../src/db/client";
import {
  generateInvoice,
  getInvoice,
} from "../../src/domain/billing/generation";
import { createRule } from "../../src/domain/billing/rules";
import { createDwelling } from "../../src/domain/organizations/dwellings";
import { createOrganization } from "../../src/domain/organizations/organizations";
import { createPeriod } from "../../src/domain/periods/periods";
import {
  cleanupOrganization,
  requireDatabaseUrl,
} from "../integration/_helpers";

test("saving a missing billing address promotes draft regeneration", async ({
  page,
}) => {
  const dbUrl = requireDatabaseUrl();
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(dbUrl).hostname
  );
  const db = await createDb(dbUrl);
  const adminId = "10000000-0000-4000-8000-0000000000a1";
  let organizationId: string | undefined;
  try {
    const org = await createOrganization(
      db,
      {
        name: "Draft billing details browser fixture",
        addressLine1: "1 Main Street",
        bankName: "Test Bank",
        iban: "DE89370400440532013000",
      },
      adminId
    );
    organizationId = org.id;
    const dwelling = await createDwelling(
      db,
      org.id,
      {
        number: "2",
        occupantName: "Test Resident",
        billingEmail: "resident@example.com",
      },
      adminId
    );
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
    const period = await createPeriod(
      db,
      org.id,
      {
        year: 2026,
        month: 11,
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        invoiceIssueDate: "2026-11-30",
        invoiceDueDate: "2026-12-14",
      },
      adminId
    );
    const invoice = await generateInvoice(
      db,
      org.id,
      period.id,
      dwelling.id,
      adminId
    );

    await page.goto("/login?lang=en");
    await page.locator("#admin-email").fill("admin.a@example.com");
    await page.locator("#admin-password").fill("ChangeMe123!");
    await page.locator("#admin-login-form button").click();
    await page.waitForURL(/\/admin\/(organizations|o\/.+\/dashboard)/);
    const periodPath = `/admin/o/${org.id}/periods/${period.id}`;
    await page.goto(`${periodPath}?status=DRAFT`);
    const row = page
      .getByRole("row")
      .filter({ hasText: invoice.invoiceNumber });
    await expect(row.getByText("Billing address missing")).toBeVisible();
    await row.getByRole("button", { name: "Add billing address" }).click();
    const address = page.getByRole("textbox", { name: "Billing address" });
    await expect(address).toBeFocused();
    await expect(address).toHaveAttribute("aria-required", "true");
    await expect(address).toHaveValue("");
    const billingAddress = "2 Side Street, Apt 2";
    await address.fill(billingAddress);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(row.getByText("Billing address missing")).toHaveCount(0);
    await row.getByRole("button", { name: "Regenerate invoice" }).click();
    await expect(
      row.getByRole("link", { name: "Review invoice" })
    ).toBeVisible();
    const regenerated = await getInvoice(db, org.id, invoice.id);
    expect(regenerated.invoice.recipientSnapshot).toMatchObject({
      billingAddress,
    });
  } finally {
    try {
      if (organizationId) await cleanupOrganization(db, organizationId);
    } finally {
      await db.$client.end();
    }
  }
});
