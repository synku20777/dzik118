import { expect, test } from "@playwright/test";

test("design system is isolated, responsive, and interactive", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  const response = await page.goto(
    process.env.DESIGN_SYSTEM_URL ?? "/design-system"
  );
  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow"
  );
  await expect(page.locator("#overview h1")).toHaveCount(1);
  await expect(page.locator("[data-component]")).toHaveCount(3);

  const inputContrast = () =>
    page.locator("#specimen-email").evaluate((element) => {
      const channels = (value: string) =>
        value
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
      const luminance = (value: string) => {
        const [red, green, blue] = channels(value).map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.03928
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };
      const style = getComputedStyle(element);
      const values = [
        luminance(style.borderColor),
        luminance(style.backgroundColor),
      ];
      return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
    });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    expect(
      await inputContrast(),
      `${theme} input boundary contrast`
    ).toBeGreaterThanOrEqual(3);
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });

  const interactiveButton = page.locator('[data-preview-state="default"]');
  const initialBackground = await interactiveButton.evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  await interactiveButton.hover();
  await expect
    .poll(() =>
      interactiveButton.evaluate(
        (element) => getComputedStyle(element).backgroundColor
      )
    )
    .not.toBe(initialBackground);
  await interactiveButton.focus();
  await expect(interactiveButton).toBeFocused();
  expect(
    await interactiveButton.evaluate(
      (element) => getComputedStyle(element).outlineStyle
    )
  ).not.toBe("none");

  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => ({
      fits: document.documentElement.scrollWidth <= window.innerWidth + 1,
      offenders: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter(
          (element) =>
            element.getBoundingClientRect().right > window.innerWidth + 1
        )
        .slice(0, 5)
        .map((element) => `${element.tagName}.${element.className}`),
    }));
    expect(
      overflow.fits,
      `horizontal overflow at ${width}px: ${overflow.offenders}`
    ).toBe(true);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const sidebar = page.locator(".ds-sidebar");
  const before = await sidebar.boundingBox();
  await page.locator("#audit").scrollIntoViewIfNeeded();
  const after = await sidebar.boundingBox();
  expect(Math.abs((before?.y ?? 0) - (after?.y ?? 0))).toBeLessThan(2);
  expect(errors).toEqual([]);
});
