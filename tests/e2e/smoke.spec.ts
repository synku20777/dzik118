import { test, expect } from "@playwright/test";

test("home page smoke test", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Property Billing/i);
});
