import { expect, test } from "@playwright/test";

test("setup wizard: compact phone trail and organization errors keep input", async ({
  page,
}) => {
  await page.goto("/login?lang=en");
  await page.locator("#admin-email").fill("admin.a@example.com");
  await page.locator("#admin-password").fill("ChangeMe123!");
  await page.locator("#admin-login-form button").click();
  await page.waitForURL(/\/admin\/(organizations|o\/.+\/dashboard)/);
  if (new URL(page.url()).pathname === "/admin/organizations") {
    await page.locator('main a[href$="/dashboard"]').first().click();
    await page.waitForURL(/\/dashboard/);
  }
  const base = new URL(page.url()).pathname.replace(/\/dashboard$/, "");

  // Phones: the six steps are one row, never a tall grid, with no overflow.
  await page.setViewportSize({ width: 390, height: 800 });
  for (const step of [
    "organization",
    "dwellings",
    "period",
    "charges",
    "meters",
  ]) {
    await page.goto(`${base}/setup/${step}?lang=en`);
    const trail = await page.locator(".setup-steps").boundingBox();
    expect(trail!.height).toBeLessThan(60);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/setup/organization?lang=en`);
  const form = page.locator("#organization-form");
  const invoiceDetails = form.getByRole("region", { name: "Invoice details" });
  const bankName = invoiceDetails.getByLabel("Bank name");
  const iban = invoiceDetails.getByLabel("IBAN");
  await expect(bankName).toBeVisible();
  await expect(iban).toBeVisible();
  const requiredFields = form.locator("input[required]");
  expect(
    await requiredFields.evaluateAll((fields) =>
      fields.map((field) => field.id)
    )
  ).toEqual(["name", "addressLine1", "bankName", "iban"]);
  for (const field of await requiredFields.all()) {
    expect(
      await field.evaluate((input) => {
        const label = (input as HTMLInputElement).labels![0];
        const marker = getComputedStyle(label, "::after");
        return [marker.content, marker.borderRadius];
      })
    ).toEqual(['""', "50%"]);
  }
  await expect(form.locator(".btn-primary")).toHaveText("Save and continue");

  await bankName.fill("");
  expect(
    await bankName.evaluate(
      (input: HTMLInputElement) => input.validity.valueMissing
    )
  ).toBe(true);
  // Bypass browser validation to exercise server validation without saving data.
  await form.evaluate((f) => {
    (f as HTMLFormElement).noValidate = true;
  });
  await bankName.fill("   ");
  await page.locator("#name").fill("Typed name");
  await page.locator("#email").fill("not-an-email");
  const invalidIban = "A".repeat(51);
  await iban.fill(invalidIban);
  await form.getByRole("button", { name: "Save and continue" }).click();
  await expect(bankName).toHaveAttribute("aria-describedby", "bankName-error");
  await expect(bankName).toBeFocused();
  await expect(page.locator("#email")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#email")).toHaveValue("not-an-email");
  await expect(page.locator("#name")).toHaveValue("Typed name");
  await expect(iban).toHaveValue(invalidIban);
  await expect(iban).toHaveAttribute("aria-describedby", "iban-error");
  await expect(page.locator("#iban-error")).toBeVisible();
});
