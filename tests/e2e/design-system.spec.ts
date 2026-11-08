import { expect, test, type Locator } from "@playwright/test";

async function contrastRatio(
  locator: Locator,
  foreground: "color" | "borderColor" | "outlineColor"
) {
  return locator.evaluate((element, property) => {
    const luminance = (color: string) => {
      const [r, g, b] = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((n) => {
          const v = n / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
      return r * 0.2126 + g * 0.7152 + b * 0.0722;
    };
    const style = getComputedStyle(element);
    const values = [
      luminance(style[property]),
      luminance(style.backgroundColor),
    ];
    return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
  }, foreground);
}

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
  await expect(page.locator("h1")).toHaveCount(1);
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

  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => ({
      fits: document.documentElement.scrollWidth <= window.innerWidth + 1,
      documentWidth: document.documentElement.scrollWidth,
      scrollX: window.scrollX,
      offenders: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter(
          (element) =>
            element.getBoundingClientRect().right + window.scrollX >
              window.innerWidth + 1 ||
            (element.scrollWidth > element.clientWidth + 1 &&
              getComputedStyle(element).overflowX === "visible")
        )
        .slice(0, 5)
        .map((element) => `${element.tagName}.${element.className}`),
    }));
    expect(
      overflow.fits,
      `horizontal overflow at ${width}px: ${JSON.stringify(overflow)}`
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

test("product fields retain focus, error and boundary contrast in either theme", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  const input = page.locator("#admin-email");
  for (const theme of ["light", "dark"] as const) {
    // An explicit choice must win even when the OS prefers the opposite.
    await page.emulateMedia({
      colorScheme: theme === "dark" ? "light" : "dark",
    });
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await input.evaluate((el) => el.removeAttribute("aria-invalid"));
    await page.locator("#admin-password").focus();
    await expect
      .poll(() => contrastRatio(input, "borderColor"), {
        message: `${theme} field boundary`,
      })
      .toBeGreaterThanOrEqual(3);
    await input.focus();
    await expect(input).toHaveCSS("outline-style", "solid");
    await expect
      .poll(() => contrastRatio(input, "outlineColor"), {
        message: `${theme} focus`,
      })
      .toBeGreaterThanOrEqual(3);
    await input.evaluate((el) => el.setAttribute("aria-invalid", "true"));
    const border = await input.evaluate((el) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--color-destructive)";
      document.body.appendChild(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return { actual: getComputedStyle(el).borderColor, expected };
    });
    await expect(input, `${theme} invalid field`).toHaveCSS(
      "border-color",
      border.expected
    );
  }
});

test("live token readouts follow the theme and controls remain keyboard operable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design-system");
  const readout = page.locator('[data-color-value="--color-canvas"]');
  const initial = await readout.textContent();
  await page.locator("[data-theme-toggle]").click();
  await expect(readout).not.toHaveText(initial!);
  await expect(readout).toHaveText(
    await page
      .locator('[data-swatch="--color-canvas"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor)
  );
  const input = page.locator("#specimen-email");
  await input.focus();
  await page.keyboard.press("Tab");
  await expect(page.locator('select[name="cycle"]')).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator('input[name="reminders"]')).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator('input[name="reminders"]')).not.toBeChecked();
  for (const selector of ["[data-theme-toggle]", ".copy-button"]) {
    const size = await page.locator(selector).first().boundingBox();
    expect(size!.height).toBeGreaterThanOrEqual(44);
    expect(size!.width).toBeGreaterThanOrEqual(44);
  }
  await page.locator(".disclosure summary").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".disclosure").first()).toHaveAttribute("open", "");
});

test("button variants retain semantic press feedback and disabled affordance", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design-system");
  const disabled = page.getByRole("button", { name: "Unavailable action" });
  await expect(disabled).toBeDisabled();
  await expect(disabled).toHaveCSS("opacity", "0.45");
  await expect(disabled).toHaveCSS("cursor", "not-allowed");
  const disabledBackground = await disabled.evaluate(
    (el) => getComputedStyle(el).backgroundColor
  );
  await disabled.hover();
  await expect(disabled).toHaveCSS("background-color", disabledBackground);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    for (const variant of ["btn-primary", "btn-secondary", "btn-danger"]) {
      const button = page.locator(`.button-variants .${variant}`).first();
      expect(
        await contrastRatio(button, "color"),
        `${theme} ${variant} text`
      ).toBeGreaterThanOrEqual(4.5);
    }
    const danger = page.getByRole("button", {
      name: "Remove example",
      exact: true,
    });
    await danger.hover();
    const hoverColor = await danger.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--color-destructive)";
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    await expect(danger).toHaveCSS("color", hoverColor);
    await page.mouse.down();
    try {
      await expect(danger).toHaveCSS("color", hoverColor);
    } finally {
      await page.mouse.up();
    }
  }
});

test("organization disclosure fits a scrolling sidebar and closes with Escape", async ({
  page,
}) => {
  await page.goto("/design-system");
  await page.setViewportSize({ width: 1024, height: 500 });
  const switcher = page.locator(
    ".organization-specimen .organization-switcher"
  );
  await switcher.locator("summary").click();
  await expect(switcher).toHaveAttribute("open", "");
  const fits = await page
    .locator(".organization-specimen")
    .evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);
  await switcher.locator("a").first().focus();
  await page.keyboard.press("Escape");
  await expect(switcher).not.toHaveAttribute("open", "");
  await expect(switcher.locator("summary")).toBeFocused();
});

test("reduced motion and forced colors retain visible field focus", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.goto("/login");
  const input = page.locator("#admin-email");
  await input.focus();
  await expect(input).toHaveCSS("outline-style", "solid");
  await expect(input).toHaveCSS("outline-width", "2px");
  const toggle = page.locator("[data-theme-toggle]");
  const duration = await toggle.evaluate((el) =>
    parseFloat(getComputedStyle(el).transitionDuration)
  );
  expect(duration).toBeLessThanOrEqual(0.001);
  await page.goto("/design-system");
  await expect(page.locator(".status-badge").first()).toHaveCSS(
    "outline-style",
    "solid"
  );
});

test("display roles honor their tracking token when combined with type utilities", async ({
  page,
}) => {
  await page.goto("/design-system");
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--tracking-display", "0.04em")
  );
  const spacing = await page
    .locator(".empty-state .font-display")
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        actual: parseFloat(style.letterSpacing),
        expected: parseFloat(style.fontSize) * 0.04,
      };
    });
  expect(spacing.actual).toBeCloseTo(spacing.expected, 2);
});

test.describe("coarse pointer geometry", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 320, height: 700 },
  });

  test("compact actions expand to usable touch targets", async ({ page }) => {
    await page.goto("/design-system");
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches)
    ).toBe(true);
    for (const selector of [
      ".btn-sm",
      "[data-theme-toggle]",
      ".icon-btn-danger",
    ]) {
      const size = await page.locator(selector).first().boundingBox();
      expect(size!.height).toBeGreaterThanOrEqual(44);
      expect(size!.width).toBeGreaterThanOrEqual(44);
    }
  });
});
