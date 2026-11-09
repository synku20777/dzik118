import { expect, test } from "@playwright/test";

test("setup wizard: compact phone trail, aligned legends, errors keep input", async ({
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

  // The section heading sits above its divider, not on it.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/setup/organization?lang=en`);
  const fieldset = page.locator("fieldset.border-t");
  const legend = fieldset.locator("legend");
  expect((await legend.boundingBox())!.y).toBeGreaterThan(
    (await fieldset.boundingBox())!.y
  );

  // A rejected save keeps what was typed and marks the field.
  await page
    .locator("#organization-form, main form")
    .first()
    .evaluate((f) => {
      (f as HTMLFormElement).noValidate = true;
    });
  await page.locator("#name").fill("Typed name");
  await page.locator("#email").fill("not-an-email");
  await page.locator("main form button[type=submit]").click();
  await expect(page.locator("#email")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#email")).toBeFocused();
  await expect(page.locator("#email")).toHaveValue("not-an-email");
  await expect(page.locator("#name")).toHaveValue("Typed name");
});
