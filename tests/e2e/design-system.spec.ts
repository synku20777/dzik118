import { expect, test, type Locator, type Page } from "@playwright/test";

// The page shows one topic at a time; the URL fragment picks it.
async function openTopic(page: Page, id: string) {
  await page.evaluate((id) => {
    location.hash = id;
  }, id);
  await expect(page.locator(`.ds-main > #${id}`)).toBeVisible();
}

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
  await expect(page.locator("main h1:visible")).toHaveCount(1);
  await expect(page.locator("[data-component]")).toHaveCount(22);

  await openTopic(page, "form-field");
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

  await openTopic(page, "button");
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

  const topics = await page
    .locator(".ds-nav nav a")
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).hash.slice(1))
    );
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const topic of topics) {
      await openTopic(page, topic);
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
        `horizontal overflow in #${topic} at ${width}px: ${JSON.stringify(overflow)}`
      ).toBe(true);
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await openTopic(page, "color");
  await page.evaluate(() => window.scrollTo(0, 0));
  const sidebar = page.locator(".ds-sidebar");
  const before = await sidebar.boundingBox();
  await page.locator(".palette-chip").last().scrollIntoViewIfNeeded();
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
  await page.goto("/design-system#color");
  const readout = page.locator('[data-color-value="--color-canvas"]');
  const initial = await readout.textContent();
  await page.locator("[data-theme-toggle]").click();
  await expect(readout).not.toHaveText(initial!);
  await expect(readout).toHaveText(
    await page
      .locator('[data-swatch="--color-canvas"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor)
  );
  await openTopic(page, "form-field");
  const input = page.locator("#specimen-email");
  await input.focus();
  await page.keyboard.press("Tab");
  await expect(page.locator('select[name="cycle"]')).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator('input[name="reminders"]')).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator('input[name="reminders"]')).not.toBeChecked();
  for (const selector of ["[data-theme-toggle]", ".copy-button:visible"]) {
    const size = await page.locator(selector).first().boundingBox();
    expect(size!.height).toBeGreaterThanOrEqual(44);
    expect(size!.width).toBeGreaterThanOrEqual(44);
  }
  const reminderSwitch = page.locator(
    '.toggle-specimen input[name="specimen-switch-off"]'
  );
  await expect(reminderSwitch).toHaveAttribute("role", "switch");
  await reminderSwitch.click();
  await expect(reminderSwitch).toBeChecked();
  await reminderSwitch.click();
  await expect(reminderSwitch).not.toBeChecked();
  const switchTrack = page.locator(
    '.toggle-specimen input[name="specimen-switch-off"] + .toggle-switch-track'
  );
  const switchBox = await switchTrack.boundingBox();
  expect(switchBox!.height).toBeGreaterThanOrEqual(24);
  const savedTheme = await page.evaluate(
    () => document.documentElement.dataset.theme
  );
  // Measure resting colors, not the hover left by the clicks above.
  await page.mouse.move(0, 0);
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    // Poll: a theme change repaints the track a frame later.
    await expect
      .poll(() => contrastRatio(switchTrack, "borderColor"), {
        message: `${theme} unchecked switch border contrast`,
      })
      .toBeGreaterThanOrEqual(3);
    const checkedTrack = page.locator(
      '.toggle-specimen input[name="specimen-switch-on"] + .toggle-switch-track'
    );
    const trackContrast = () =>
      checkedTrack.evaluate((el) => {
        const lum = (color: string) => {
          const [r, g, b] = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((n) => {
              const v = n / 255;
              return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const probe = document.createElement("span");
        probe.style.backgroundColor = "var(--color-surface)";
        document.body.appendChild(probe);
        const surfaceBg = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const a = lum(getComputedStyle(el).backgroundColor);
        const b = lum(surfaceBg);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
    await expect
      .poll(trackContrast, {
        message: `${theme} checked switch track contrast`,
      })
      .toBeGreaterThanOrEqual(3);
    for (const track of [switchTrack, checkedTrack]) {
      const thumbRatio = () =>
        track.evaluate((el) => {
          const thumb = el.querySelector<HTMLElement>(".toggle-switch-thumb")!;
          const lum = (color: string) => {
            const [r, g, b] = color
              .match(/[\d.]+/g)!
              .slice(0, 3)
              .map(Number)
              .map((n) => {
                const v = n / 255;
                return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
              });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const a = lum(getComputedStyle(thumb).backgroundColor);
          const b = lum(getComputedStyle(el).backgroundColor);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
      await expect
        .poll(thumbRatio, { message: `${theme} switch thumb contrast` })
        .toBeGreaterThanOrEqual(3);
    }
  }
  await page.evaluate((value) => {
    if (value) document.documentElement.dataset.theme = value;
    else delete document.documentElement.dataset.theme;
  }, savedTheme);
  await openTopic(page, "disclosure");
  await page.locator(".disclosure summary").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".disclosure").first()).toHaveAttribute("open", "");
});

test("button variants retain semantic press feedback and disabled affordance", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design-system#button");
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
    // Measure resting fills, not the hover state left by the previous theme.
    await page.mouse.move(0, 0);
    for (const variant of ["btn-primary", "btn-secondary", "btn-danger"]) {
      const button = page.locator(`.button-variants .${variant}`).first();
      await expect
        .poll(() => contrastRatio(button, "color"), {
          message: `${theme} ${variant} text`,
        })
        .toBeGreaterThanOrEqual(4.5);
    }
    for (const name of ["Cancel changes", "Remove example", "More actions"]) {
      const button = page.locator(".button-variants").getByRole("button", {
        name,
        exact: true,
      });
      const restingFill = await button.evaluate(
        (element) => getComputedStyle(element).backgroundColor
      );
      await button.hover();
      await expect(button).toHaveCSS("background-color", restingFill);
      await expect(button).toHaveCSS("box-shadow", /4px/);
    }
    const danger = page.locator(".button-variants .btn-danger").first();
    const resolve = (token: string) =>
      page.evaluate((token) => {
        const probe = document.createElement("span");
        probe.style.backgroundColor = `var(${token})`;
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      }, token);
    await danger.hover();
    await expect(danger).toHaveCSS(
      "background-color",
      await resolve("--color-destructive-hover")
    );
    await page.mouse.down();
    try {
      await expect(danger).toHaveCSS(
        "background-color",
        await resolve("--color-destructive-active")
      );
    } finally {
      await page.mouse.up();
    }
  }
});

test("hovering the block-link card marks its link and keeps the card fill", async ({
  page,
}) => {
  await page.goto("/design-system#link");
  const card = page.locator(".block-link-specimen");
  const link = card.getByRole("link", { name: "Dwelling 12" });
  for (const theme of ["light", "dark"]) {
    await page.mouse.move(0, 0);
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    const restingFill = await card.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    );
    await expect(link).toHaveCSS("text-decoration-line", "none");
    await card.hover({ position: { x: 16, y: 16 } });
    await expect(link).toHaveCSS("text-decoration-line", "underline");
    await expect(card).toHaveCSS("background-color", restingFill);
  }
});

test("the selected toggle tab lifts above the track and follows keyboard selection", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design-system#tabs");
  const track = page.getByRole("radiogroup", { name: "Show amounts" });
  const selected = track.locator("label:has(input:checked)");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    const { canvas, paper, trackFill } = await track.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--color-surface)";
      document.body.append(probe);
      const paper = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        canvas: getComputedStyle(document.body).backgroundColor,
        paper,
        trackFill: getComputedStyle(element).backgroundColor,
      };
    });
    await expect(selected).not.toHaveCSS("background-color", trackFill);
    await expect(selected).not.toHaveCSS("box-shadow", "none");
    expect(await contrastRatio(selected, "color")).toBeGreaterThanOrEqual(4.5);
    if (theme === "light") {
      expect(trackFill).not.toBe(canvas);
      expect(trackFill).not.toBe(paper);
      await expect(selected).not.toHaveCSS("background-color", canvas);
      await expect(selected).not.toHaveCSS("background-color", paper);
    }
  }
  await track.getByRole("radio", { name: "With VAT", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(track.getByRole("radio", { name: "Without VAT" })).toBeChecked();
  await expect(track.locator("label").first()).toHaveCSS("box-shadow", "none");
  await expect(track.locator("label").last()).not.toHaveCSS(
    "box-shadow",
    "none"
  );
});

test("organization disclosure fits a scrolling sidebar and closes with Escape", async ({
  page,
}) => {
  await page.goto("/design-system#organization-switcher");
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
  await page.goto("/design-system#form-field");
  await expect(page.locator(".status-badge").first()).toHaveCSS(
    "outline-style",
    "solid"
  );
  const offSwitch = page.locator(
    '.toggle-specimen input[name="specimen-switch-off"]'
  );
  const offTrack = page.locator(
    '.toggle-specimen input[name="specimen-switch-off"] + .toggle-switch-track'
  );
  const onTrack = page.locator(
    '.toggle-specimen input[name="specimen-switch-on"] + .toggle-switch-track'
  );
  await expect(offTrack).toHaveCSS("forced-color-adjust", "none");
  const switchDuration = await offTrack.evaluate((el) =>
    parseFloat(getComputedStyle(el).transitionDuration)
  );
  expect(switchDuration).toBeLessThanOrEqual(0.001);
  expect(
    await offTrack.evaluate((el) => getComputedStyle(el).backgroundColor)
  ).not.toBe(
    await onTrack.evaluate((el) => getComputedStyle(el).backgroundColor)
  );
  await offSwitch.focus();
  await expect(offTrack).toHaveCSS("outline-style", "solid");
  await expect(offTrack).toHaveCSS("outline-width", "2px");
});

test("display roles honor their tracking token when combined with type utilities", async ({
  page,
}) => {
  await page.goto("/design-system#empty-state");
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
    await page.goto("/design-system#button");
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches)
    ).toBe(true);
    for (const [topic, selectors] of [
      ["button", [".btn-sm", "[data-theme-toggle]", ".icon-btn-sm"]],
      ["form-field", [".toggle-switch"]],
    ] as const) {
      await openTopic(page, topic);
      for (const selector of selectors) {
        const size = await page.locator(selector).first().boundingBox();
        expect(size!.height, selector).toBeGreaterThanOrEqual(44);
        expect(size!.width, selector).toBeGreaterThanOrEqual(44);
      }
    }
  });
});

test("the sidebar opens one topic at a time and marks it", async ({ page }) => {
  await page.goto("/design-system");
  await expect(page.locator("#overview")).toBeVisible();
  await expect(page.locator("#notice")).toBeHidden();
  const link = page.locator('.ds-nav a[href="#notice"]');
  await link.click();
  await expect(page.locator("#notice")).toBeVisible();
  await expect(page.locator("#overview")).toBeHidden();
  await expect(link).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveTitle(/^Notice – /);
  await expect(page.locator("#notice h1")).toBeFocused();
  await page.goBack();
  await expect(page.locator("#overview")).toBeVisible();
  // A subsection fragment opens its topic; old fragments still land.
  await page.goto("/design-system#shells");
  await expect(page.locator("#layout")).toBeVisible();
  const shells = await page.locator("#shells").boundingBox();
  const topbar = await page.locator(".ds-topbar").boundingBox();
  expect(shells!.y).toBeGreaterThanOrEqual(topbar!.y + topbar!.height);
  // The skip link keeps the open topic.
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  await expect(page.locator("#layout")).toBeVisible();
  // Reloading that URL shows Overview, not every topic.
  await page.reload();
  await expect(page.locator("#overview")).toBeVisible();
  await expect(page.locator("main h1:visible")).toHaveCount(1);
  await page.goto("/design-system#components");
  await expect(page.locator("#button")).toBeVisible();
});

test("below 70rem the topics sit behind a Contents menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/design-system");
  const menu = page.locator(".ds-nav");
  await expect(menu).not.toHaveAttribute("open", "");
  await menu.locator("summary").click();
  await menu.locator('a[href="#radius"]').click();
  await expect(page.locator("#radius")).toBeVisible();
  await expect(menu).not.toHaveAttribute("open", "");
  // Re-picking the open topic changes no hash but still closes the menu.
  await menu.locator("summary").click();
  await menu.locator('a[href="#radius"]').click();
  await expect(menu).not.toHaveAttribute("open", "");
  // So does any other jump, such as the brand link.
  await menu.locator("summary").click();
  await page.locator(".ds-topbar .brand").click();
  await expect(page.locator("#overview")).toBeVisible();
  await expect(menu).not.toHaveAttribute("open", "");
  // The skip link lands below both sticky bars.
  await page.goto("/design-system#radius");
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  const title = await page.locator("#radius h1").boundingBox();
  const bars = await page.locator(".ds-sidebar").boundingBox();
  expect(title!.y).toBeGreaterThanOrEqual(bars!.y + bars!.height - 1);
});

test("dropdowns, dialogs, checkboxes and tooltips behave as documented", async ({
  page,
}) => {
  await page.goto("/design-system#button");
  // Hover grows a ring in the button's own colour, and only on hover.
  const primary = page.locator(".button-variants .btn-primary").first();
  const danger = page.locator(".button-variants .btn-danger").first();
  await page.mouse.move(0, 0);
  await expect(primary).toHaveCSS("box-shadow", "none");
  await primary.hover();
  await expect
    .poll(() => primary.evaluate((el) => getComputedStyle(el).boxShadow))
    .toContain("4px");
  const primaryRing = await primary.evaluate(
    (el) => getComputedStyle(el).boxShadow
  );
  await danger.hover();
  await expect
    .poll(() => danger.evaluate((el) => getComputedStyle(el).boxShadow))
    .toContain("4px");
  expect(
    await danger.evaluate((el) => getComputedStyle(el).boxShadow)
  ).not.toBe(primaryRing);

  // A dropdown closes on Escape and gives focus back to its button.
  await openTopic(page, "dropdown");
  const dropdown = page.locator(".ds-main > #dropdown .dropdown").first();
  await dropdown.locator("summary").click();
  await expect(dropdown.locator(".dropdown-panel")).toBeVisible();
  await dropdown.locator(".dropdown-item").first().focus();
  await page.keyboard.press("Escape");
  await expect(dropdown).not.toHaveAttribute("open", "");
  await expect(dropdown.locator("summary")).toBeFocused();
  // Picking an item closes it.
  await dropdown.locator("summary").click();
  await dropdown.locator("button.dropdown-item").click();
  await expect(dropdown).not.toHaveAttribute("open", "");
  // An outside click closes it too.
  await dropdown.locator("summary").click();
  await page.locator(".ds-main > #dropdown h1").click();
  await expect(dropdown).not.toHaveAttribute("open", "");

  // Dialogs open from their button and close with Escape or Close.
  await openTopic(page, "modal");
  await page.getByRole("button", { name: "Open modal card" }).click();
  const card = page.locator("#specimen-modal-card");
  await expect(card).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await page.getByRole("button", { name: "Open full-screen modal" }).click();
  const full = page.locator("#specimen-modal-full");
  await expect(full).toBeVisible();
  await full.getByRole("button", { name: "Close" }).click();
  await expect(full).toBeHidden();

  // A checked box fills with the primary colour; the mixed one shows its bar.
  await openTopic(page, "checkbox");
  const primaryColor = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--color-primary)";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  await expect(page.locator('input[name="specimen-check-on"]')).toHaveCSS(
    "background-color",
    primaryColor
  );
  // Radios are circles with a dot, not squares with a tick.
  const radio = page.locator('input[name="specimen-delivery"]').first();
  await expect(radio).toHaveCSS("border-radius", "50%");
  await expect(radio).toHaveCSS("width", "18px");
  expect(
    await radio.evaluate((el) => getComputedStyle(el, "::before").maskImage)
  ).toBe("none");
  expect(
    await page
      .locator("[data-indeterminate]")
      .evaluate((el: HTMLInputElement) => el.indeterminate)
  ).toBe(true);

  // A toned tooltip carries its tone.
  await openTopic(page, "tooltip");
  await page.locator("[data-tip-tone]").hover();
  await expect(page.locator("#app-tooltip[data-visible]")).toHaveAttribute(
    "data-tone",
    "warning"
  );
});

test("data-confirm asks in a modal card before submitting", async ({
  page,
}) => {
  await page.goto("/design-system#modal");
  await page.getByRole("button", { name: "Remove resident" }).click();
  const dialog = page.locator("#confirm-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("h2")).toHaveText(
    "Remove anna.berzina@example.lv?"
  );
  // The confirm button repeats the action and keeps its danger tone; focus
  // starts on the safe choice.
  const ok = dialog.locator("[data-confirm-ok]");
  await expect(ok).toHaveText("Remove resident");
  await expect(ok).toHaveClass("btn-danger");
  await expect(dialog.locator("[data-confirm-cancel]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("a confirmation answers only its own question", async ({ page }) => {
  await page.goto("/design-system#modal");
  const button = page.getByRole("button", { name: "Remove resident" });
  const dialog = page.locator("#confirm-dialog");
  let submits = 0;
  await page.exposeFunction("countSubmit", () => submits++);
  await page.evaluate(() => {
    document
      .querySelector(".confirm-specimen")!
      .addEventListener("submit", () =>
        (window as unknown as { countSubmit: () => void }).countSubmit()
      );
  });
  // Cancel, then ask again before the first close event has fired: the second
  // question is dropped rather than answered by the first one's close.
  await button.click();
  await page.evaluate(() => {
    document.querySelector<HTMLDialogElement>("#confirm-dialog")!.close();
    document
      .querySelector<HTMLButtonElement>(".confirm-specimen button")!
      .click();
  });
  await expect(dialog).toBeHidden();
  expect(submits).toBe(0);
  // Asked again afterwards, it opens and one "yes" submits once.
  await button.click();
  await dialog.locator("[data-confirm-ok]").click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => submits).toBe(1);
});
