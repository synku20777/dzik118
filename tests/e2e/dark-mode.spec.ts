import { expect, test } from "@playwright/test";

test("dark mode toggle and persistence", async ({ page }) => {
  await page.goto("/login");

  // Meta color-scheme tag is present
  const meta = page.locator('meta[name="color-scheme"]');
  await expect(meta).toHaveAttribute("content", /light|dark/);

  // Theme toggle button is present
  const toggle = page.locator("[data-theme-toggle]");
  await expect(toggle).toBeVisible();

  // Click to toggle theme to dark
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(meta).toHaveAttribute("content", "dark");

  const storedAfterFirstClick = await page.evaluate(() =>
    localStorage.getItem("color-scheme")
  );
  expect(storedAfterFirstClick).toBe("dark");

  // Reload page to verify persistence without FOUC
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(meta).toHaveAttribute("content", "dark");

  // Click again to toggle theme back to light
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(meta).toHaveAttribute("content", "light");

  const storedAfterSecondClick = await page.evaluate(() =>
    localStorage.getItem("color-scheme")
  );
  expect(storedAfterSecondClick).toBe("light");
});
