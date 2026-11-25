import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  invoiceStatusBadge,
  invoiceStatusCodes,
} from "../../src/lib/ui/invoice-status";

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
  await expect(page.locator("[data-component]")).toHaveCount(36);

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

test("setup progress keeps the next step and row states visible on phones", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(process.env.DESIGN_SYSTEM_URL ?? "/design-system");
  await openTopic(page, "setup-progress");

  const panel = page.getByRole("region", { name: "Finish setting up" });
  const steps = panel.getByRole("list", { name: "Setup steps done: 1 of 5" });
  const current = steps.getByRole("link", { name: "Dwellings Next step" });
  await expect(steps.getByRole("listitem")).toHaveCount(5);
  await expect(current).toHaveAttribute("aria-current", "step");
  await expect(steps.locator("[aria-current]")).toHaveCount(1);
  await expect(steps.getByText("Done", { exact: true })).toBeVisible();
  await expect(steps.getByText("To do", { exact: true }).last()).toBeVisible();

  await panel.getByRole("link", { name: "Continue setup" }).focus();
  await page.keyboard.press("Tab");
  await expect(steps.getByRole("link").first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(current).toBeFocused();
  await expect(current).toHaveCSS("outline-style", "solid");
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
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/design-system#color");
  const readout = page.locator('[data-color-value="--color-canvas"]');
  const initial = await readout.textContent();
  const chromeColor = page.locator('meta[name="theme-color"]');
  await expect(chromeColor.first()).toHaveAttribute("content", "#eee8de");
  await expect(chromeColor.last()).toHaveAttribute("content", "#0e1517");
  await page.locator("[data-theme-toggle]").click();
  await expect(chromeColor.first()).toHaveAttribute("content", "#0e1517");
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

test("billing workbench exercises real queue controls with local sample data", async ({
  page,
}) => {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto("/design-system?lang=en&drawer=readings&dwelling=12#table");
  await expect(page.locator("#admin-context-drawer")).not.toBeVisible();
  await expect(page.locator("#table")).toBeVisible();
  await page.goto("/design-system?lang=en#workbench");
  const previewUrl = page.url();
  const queue = page.locator("#workbench-specimen .case-queue");
  const readingCase = queue.locator('tr[data-dwelling-id="12"]');
  await expect(readingCase).toHaveCSS("display", "table-row");
  await page.getByRole("button", { name: "Narrow queue" }).click();
  await expect(readingCase).toHaveCSS("display", "grid");
  await readingCase.getByRole("button", { name: "1 more problem" }).click();
  await readingCase
    .getByRole("link", { name: "Check tariff dates for this period" })
    .click();
  await expect(page.locator("#period-tariffs")).toHaveAttribute("open", "");

  await queue.getByRole("searchbox").fill("not in the queue");
  await queue.getByRole("searchbox").press("Enter");
  await expect(
    queue.getByText("No billing cases match these filters.")
  ).toBeVisible();
  await queue.getByRole("link", { name: "Clear filters" }).first().click();
  await queue
    .getByRole("checkbox", { name: "Select invoice for dwelling 14" })
    .check();
  await queue
    .getByRole("checkbox", { name: "Select invoice for dwelling 16" })
    .check();
  await expect(page.locator("#bulk-selection-status")).toHaveText(
    "2 invoices selected. Ready to prepare: 1. Ready to send: 0."
  );
  await queue.getByRole("button", { name: "Prepare eligible" }).click();
  await expect(page.locator("[data-queue-action-result]")).toHaveText(
    "Preview: 1 invoice prepared."
  );

  await readingCase
    .getByRole("button", { name: "Enter readings", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Meter readings" });
  const reading = dialog.locator("#drawer-reading-water");
  await reading.fill("123");
  await expect(page).toHaveURL(previewUrl);
  await dialog.getByRole("button", { name: "Save readings" }).click();
  await expect(reading).toHaveAttribute("aria-invalid", "true");
  await expect(reading).toBeFocused();
  await expect(
    dialog.locator(".field-error").filter({
      hasText: "The current reading is lower than the previous reading.",
    })
  ).toBeVisible();
  await reading.fill("125,100");
  await dialog.getByRole("button", { name: "Save readings" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(previewUrl);
  await expect(readingCase.locator(".readiness-line")).not.toContainText(
    "Cold water meter"
  );
  await expect(readingCase.locator(".readiness-line")).toContainText(
    "Heating allocation"
  );
  await expect(readingCase.locator(".readiness-more")).toHaveCount(0);
  await expect(
    readingCase.getByRole("button", { name: "Enter readings", exact: true })
  ).toBeFocused();
  await queue.getByRole("link", { name: /^Missing data/ }).click();
  await readingCase.getByRole("button", { name: "Heating allocation" }).click();
  await expect(reading).toHaveValue("125.100");
  await expect(dialog.locator('[data-consumption-for="water"]')).toHaveText(
    "1.000"
  );
  await dialog.locator("#drawer-manual-input-heating").fill("10,5");
  await dialog.getByRole("button", { name: "Save readings" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(readingCase).toHaveAttribute("data-status", "READY");
  await expect(readingCase).toBeHidden();
  await expect(
    queue.getByRole("heading", { name: "Billing cases" })
  ).toBeFocused();
  await queue.getByRole("link", { name: "Clear filters" }).first().click();

  const billingCase = queue.locator('tr[data-dwelling-id="14"]');
  const editBilling = billingCase.getByRole("button", {
    name: "Billing details",
    exact: true,
  });
  await editBilling.click();
  const billingDialog = page.getByRole("dialog", { name: "Billing details" });
  const email = billingDialog.getByRole("textbox", { name: "Billing email" });
  const note = billingDialog.getByRole("textbox", {
    name: "Internal note (optional)",
  });
  const saveBilling = billingDialog.getByRole("button", {
    name: "Save changes",
  });
  await email.fill("invalid");
  await saveBilling.click();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toBeFocused();
  await email.fill("fixture@example.test");
  await note.fill("Sample billing note");
  await saveBilling.click();
  await expect(billingDialog).not.toBeVisible();
  await expect(billingCase.locator(".readiness-line")).toHaveCount(0);
  await expect(billingCase.getByRole("checkbox")).toHaveAttribute(
    "data-prepare-eligible",
    "true"
  );
  await editBilling.click();
  await expect(note).toHaveValue("Sample billing note");
  await page.evaluate(() => {
    location.hash = "table";
  });
  await expect(billingDialog).not.toBeVisible();
  await openTopic(page, "workbench");
  await page.setViewportSize({ width: 390, height: 900 });
  await billingCase.getByRole("checkbox").check();
  await expect(queue.locator("#bulk-toolbar")).toHaveCSS("position", "fixed");
  const inlinePadding = () =>
    page.evaluate(() => document.documentElement.style.scrollPaddingBottom);
  await expect.poll(inlinePadding).toMatch(/^[1-9]\d*px$/);
  await openTopic(page, "table");
  await expect.poll(inlinePadding).toBe("");
  await openTopic(page, "workbench");
  await expect.poll(inlinePadding).toMatch(/^[1-9]\d*px$/);
  expect(posts).toEqual([]);
});

test("admin pattern specimens use the real controls with local sample data", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/design-system?lang=en#setup-wizard");
  const wizard = page.locator("#setup-wizard");
  await expect(wizard.locator("[aria-current=step]")).toContainText("Charges");
  await wizard.getByRole("link", { name: "Continue" }).click();
  await expect(wizard.locator("[aria-current=step]")).toContainText(
    "Meters and starting readings"
  );

  await openTopic(page, "tariffs");
  const tariffs = page.locator("#tariffs");
  const tariff = tariffs.locator(".rules-table tbody tr");
  await expect(tariff).toHaveCSS("display", "table-row");
  await tariffs.getByRole("button", { name: "Narrow table" }).click();
  await expect(tariff).toHaveCSS("display", "grid");
  await tariffs.getByRole("link", { name: "Cold water", exact: true }).click();
  const tariffDrawer = tariffs.getByRole("dialog");
  await tariffDrawer
    .getByLabel("Name", { exact: false })
    .first()
    .fill("Cold water test");
  await tariffDrawer.getByLabel("Unit price").fill("4.00");
  await expect(tariffDrawer.locator("[data-gross-preview]")).toHaveText(
    "With VAT: €4.84"
  );
  await tariffDrawer.getByRole("button", { name: "Save changes" }).click();
  await expect(tariff).toContainText("Cold water test");

  await openTopic(page, "invoice-editor");
  const editor = page.locator("#invoice-editor");
  await editor.getByText("English", { exact: true }).click();
  const charges = editor
    .locator(".tpl-block")
    .filter({ hasText: "Charges table" });
  await charges.locator(".tpl-accordion-btn").click();
  const rowOptions = charges.locator(".tpl-overflow-btn").first();
  await rowOptions.click();
  await expect(charges.locator(".tpl-popover").first()).toBeVisible();
  await rowOptions.click();
  await editor.getByRole("button", { name: "Add text block" }).click();
  await expect(editor.locator("#tpl-savebar")).toBeVisible();
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(editor.locator("#tpl-savebar-text")).toHaveText(
    "Template saved."
  );
  await expect(
    editor
      .frameLocator("#tpl-preview")
      .getByText("INV-SAMPLE-00001", { exact: false })
      .first()
  ).toBeVisible();

  await openTopic(page, "meter-list");
  const meters = page.locator("#meter-list");
  await meters.getByRole("button", { name: "Archived" }).click();
  await expect(meters.getByText("Hot water (archived)")).toBeVisible();
  await expect(meters.getByText("Serial 006742")).toBeHidden();

  await openTopic(page, "admin-messages");
  const messages = page.locator("#admin-messages");
  await messages.getByRole("searchbox").fill("September");
  await expect(messages.locator('[data-conversation="18"]')).toBeVisible();
  await expect(messages.locator('[data-conversation="12"]')).toBeHidden();
  await messages.getByRole("searchbox").fill("");
  await messages.getByLabel("Show unread only").check();
  await expect(messages.locator('[data-conversation="18"]')).toBeHidden();
  await messages
    .getByLabel("Reply", { exact: true })
    .fill("The sample reading has been checked.");
  await messages.getByRole("button", { name: "Send sample reply" }).click();
  await expect(
    messages.locator('[data-thread="12"] .message-bubble').last()
  ).toHaveText("The sample reading has been checked.");

  await openTopic(page, "admin-payments");
  const payments = page.locator("#admin-payments");
  await page.setViewportSize({ width: 390, height: 900 });
  const payment = payments.locator(".history-table tbody tr").first();
  await expect(payment).toHaveCSS("display", "grid");
  await payment.getByText("Reverse", { exact: true }).click();
  await payment
    .getByLabel("Reason for reversal")
    .fill("Sample payment entered twice");
  await payment.getByRole("button", { name: "Reverse payment" }).click();
  await page
    .getByRole("dialog", { name: "Reverse this payment?" })
    .getByRole("button", { name: "Reverse payment" })
    .click();
  await expect(payment).toHaveAttribute("data-status", "REVERSED");
  await payments.getByText("Record a payment", { exact: true }).click();
  await payments.getByLabel("Apply to").selectOption("invoice:sample-invoice");
  await payments.getByLabel("Method").selectOption("CASH");
  await payments.getByLabel("Amount").fill("20.00");
  await payments.getByLabel("Date", { exact: true }).fill("2026-09-10");
  await payments.getByLabel("Reason").last().fill("Sample cash payment");
  await payments.getByRole("button", { name: "Record payment" }).click();
  const confirmPayment = page.getByRole("dialog", { name: /^Record / });
  await expect(confirmPayment).toContainText("INV-2026-002");
  await confirmPayment.getByRole("button", { name: "Record payment" }).click();
  await expect(payments.getByText("Sample payment recorded.")).toBeVisible();

  await openTopic(page, "invoice-delivery");
  const delivery = page.locator("#invoice-delivery");
  await expect(
    delivery.getByText("Needs attention", { exact: true })
  ).toBeVisible();
  await expect(
    delivery.getByText("Paper dispatched", { exact: true })
  ).toBeVisible();
  expect(writes).toEqual([]);
});

test("building arrangement and mutation history exercise local recovery actions", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto("/design-system?lang=en#building-view");
  const building = page.locator("#building-view");
  await expect(building.locator("astro-island")).not.toHaveAttribute("ssr", "");
  const arrange = building.getByRole("button", { name: "Arrange" });
  await arrange.press("Enter");
  await expect(
    building.locator(".building-entrance-name-input").first()
  ).toBeFocused();
  await expect(building.locator(".building-strip").first()).toHaveCSS(
    "outline-style",
    "dashed"
  );
  const tile = (id: string) => building.locator(`[data-dwelling-id="${id}"]`);
  const ground = building.locator(".building-floor").last();
  const firstTile = ground.locator(".building-unit").first();
  await expect(firstTile).toHaveAttribute("data-dwelling-id", "b-1");
  await tile("b-1").press("Enter");
  await tile("b-1").press("ArrowRight");
  await expect(firstTile).toHaveAttribute("data-dwelling-id", "b-2");
  await expect(tile("b-1")).toBeFocused();
  const retry = building.locator(".building-status .inline-undo");
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(building.locator(".building-status")).toHaveText(
    "All changes saved"
  );
  await tile("b-1").dragTo(tile("b-3"));
  await expect(ground.locator(".building-unit").last()).toHaveAttribute(
    "data-dwelling-id",
    "b-1"
  );
  await building.getByRole("button", { name: "Undo" }).click();
  await expect(ground.locator(".building-unit").last()).toHaveAttribute(
    "data-dwelling-id",
    "b-3"
  );
  await expect(building.locator(".building-status")).toHaveText(
    "All changes saved"
  );
  await building.getByRole("button", { name: "Done" }).click();
  await expect(arrange).toBeFocused();
  await arrange.press("Enter");
  const reset = building.getByRole("button", { name: "Reset to number order" });
  const confirmation = page.getByRole("dialog", {
    name: "Reset the building to number order?",
  });
  await reset.click();
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(firstTile).toHaveAttribute("data-dwelling-id", "b-2");
  await reset.click();
  await expect(confirmation).toBeVisible();
  await page.evaluate(() => {
    location.hash = "metric-strip";
  });
  await expect(confirmation).toBeHidden();
  await openTopic(page, "building-view");
  await expect(firstTile).toHaveAttribute("data-dwelling-id", "b-2");
  await reset.click();
  await confirmation
    .getByRole("button", { name: "Reset to number order" })
    .click();
  await expect(firstTile).toHaveAttribute("data-dwelling-id", "b-1");
  await expect(building.getByText("Entrance A", { exact: true })).toBeVisible();
  await expect(arrange).toBeFocused();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(arrange).toBeHidden();

  await openTopic(page, "notice");
  const mutation = page.locator("#notice #mutation-status");
  const summary = mutation.locator("summary");
  await expect(summary).toBeHidden();
  const failure = page.getByRole("button", { name: "Simulate save failure" });
  await failure.click();
  await expect(summary).toHaveText("1 change needs attention");
  await summary.press("Enter");
  const history = mutation.getByRole("region", { name: "Recent changes" });
  await expect(history.getByText("The sample save failed.")).toBeVisible();
  await expect(mutation.getByRole("button", { name: "Retry" })).toHaveCount(1);
  await history.getByRole("button", { name: "Retry" }).click();
  await expect(summary).toBeFocused();
  await expect(history.getByText("Saved", { exact: true })).toBeVisible();
  await failure.click();
  await page.getByRole("button", { name: "Simulate unknown outcome" }).click();
  await expect(summary).toHaveText("2 changes need attention");
  await summary.click();
  await expect(history.locator(".mutation-item").first()).toContainText(
    "Add sample meter"
  );
  const unknown = history
    .locator(".mutation-item")
    .filter({ hasText: "Add sample meter" });
  const failed = history
    .locator(".mutation-item")
    .filter({ hasText: "The sample save failed." });
  await unknown.getByRole("button", { name: "Check again" }).click();
  await expect(unknown.getByText("Checking save status…")).toBeVisible();
  await expect(unknown).toHaveAttribute("data-status", "success");
  await expect(failed).toHaveAttribute("data-status", "error");
  await failed.getByRole("button", { name: "Dismiss" }).click();
  await expect(failed).toHaveCount(0);
  await expect(summary).toHaveText("All changes saved");
  expect(writes).toEqual([]);
});

test("resident readings, disclosures, QR and messaging share the portal patterns", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url());
  });
  await page.setViewportSize({ width: 320, height: 950 });
  await page.goto("/design-system?lang=en#resident-portal");
  const resident = page.locator("#resident-portal");
  const meter = resident.getByRole("region", {
    name: "Cold water",
    exact: true,
  });
  const reading = meter.getByLabel("Number shown on the meter");
  const submit = meter.getByRole("button", {
    name: "Submit reading: Cold water",
  });
  await reading.fill("123");
  await submit.click();
  await expect(reading).toHaveAttribute("aria-invalid", "true");
  await expect(reading).toBeFocused();
  await reading.fill("125,125");
  await submit.click();
  await expect(meter.locator("[data-reading-value]")).toHaveText("125.125");
  await expect(meter.locator("[data-reading-received]")).toBeFocused();
  await resident
    .locator("summary")
    .filter({ hasText: "Consumption history" })
    .press("Enter");
  await expect(
    resident.getByText("August 2026 · Cold water · 1.4 m³")
  ).toBeVisible();
  await resident
    .locator("summary")
    .filter({ hasText: "Banking app QR code" })
    .click();
  await expect(
    resident.getByRole("img", { name: "Sample QR code" }).locator("svg")
  ).toBeVisible();
  await resident.getByRole("link", { name: "All invoices" }).press("Enter");
  await expect(
    resident.getByRole("heading", { name: "Recent invoices" })
  ).toBeFocused();
  const message = resident.getByLabel("Your message");
  await message.fill("The sample meter is ready.");
  await message.press("Control+Enter");
  await expect(
    resident.getByRole("log").getByText("The sample meter is ready.")
  ).toBeVisible();
  await expect(message).toBeFocused();
  await message.fill("https://example.test/" + "x".repeat(140));
  await resident.getByRole("button", { name: "Send", exact: true }).click();
  const lastMessage = resident.locator(".resident-chat-bubble").last();
  await expect(lastMessage).toContainText("https://example.test/");
  for (const item of [
    lastMessage,
    resident.locator(".resident-payment-fields dd").first(),
  ])
    expect(
      await item.evaluate(
        (element) => element.scrollWidth - element.clientWidth
      )
    ).toBe(0);
  await openTopic(page, "metric-strip");
  const dwelling = page.locator("#metric-strip .dwelling-summary");
  await expect(dwelling.locator(".summary-stat")).toHaveCount(4);
  const columns = () =>
    dwelling.evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length
    );
  await expect.poll(columns).toBe(2);
  await page.setViewportSize({ width: 1440, height: 950 });
  await expect.poll(columns).toBe(4);
  expect(writes).toEqual([]);
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
      document.body.appendChild(probe);
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
    .locator("#empty-state .empty-state .font-display")
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
    await page.addStyleTag({
      content: "astro-dev-toolbar { display: none !important; }",
    });
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches)
    ).toBe(true);
    for (const [topic, selectors] of [
      ["button", [".btn-sm", "[data-theme-toggle]", ".icon-btn-sm"]],
      ["form-field", [".toggle-switch"]],
      ["period-nav", [".period-nav > a"]],
      ["tabs", [".workflow-filter"]],
      ["notice", [".inline-undo"]],
    ] as const) {
      await openTopic(page, topic);
      for (const selector of selectors) {
        const size = await page.locator(selector).first().boundingBox();
        expect(size!.height, selector).toBeGreaterThanOrEqual(44);
        expect(size!.width, selector).toBeGreaterThanOrEqual(44);
      }
    }
    await openTopic(page, "row-menu");
    await page
      .locator('button.icon-btn[popovertarget="specimen-row-popover"]')
      .click();
    await page
      .locator("#specimen-row-popover")
      .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const rowMenuBtn = await page
      .locator("#specimen-row-popover button")
      .first()
      .boundingBox();
    expect(
      rowMenuBtn!.height,
      "#specimen-row-popover button"
    ).toBeGreaterThanOrEqual(44);

    await openTopic(page, "table");
    const checkBoxTarget = await page
      .locator("#table .check-target")
      .first()
      .boundingBox();
    expect(checkBoxTarget!.height, ".check-target").toBeGreaterThanOrEqual(44);
    expect(checkBoxTarget!.width, ".check-target").toBeGreaterThanOrEqual(44);
    await page.locator("[data-specimen-select]").first().check();
    const clearBtn = await page
      .locator("#specimen-clear-selection")
      .boundingBox();
    expect(
      clearBtn!.height,
      "#specimen-clear-selection"
    ).toBeGreaterThanOrEqual(44);
    await page.locator("#specimen-clear-selection").click();
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

test("record and page action menus exercise their sample actions and restore focus", async ({
  page,
}) => {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/design-system#button");
  await openTopic(page, "row-menu");
  const tariff = page
    .locator("#row-menu")
    .getByLabel("More actions: Cold water");
  await tariff.focus();
  await tariff.press("Enter");
  const turnOff = page.getByRole("button", { name: "Turn off" });
  await turnOff.focus();
  await page.keyboard.press("Escape");
  await expect(turnOff).toBeHidden();
  await expect(tariff).toBeFocused();
  await tariff.press("Enter");
  await turnOff.click();
  await expect(page.locator("#specimen-tariff-status")).toHaveText("Off");
  await expect(tariff).toBeFocused();
  await tariff.press("Enter");
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  const archiveTariff = page.getByRole("dialog", {
    name: "Archive Cold water?",
  });
  await archiveTariff.getByRole("button", { name: "Cancel" }).click();
  await expect(archiveTariff).toBeHidden();
  await expect(page.locator("#specimen-tariff-status")).toHaveText("Off");
  await expect(tariff).toBeFocused();
  await tariff.press("Enter");
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(archiveTariff).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#button$/);
  await expect(archiveTariff).toBeHidden();
  await openTopic(page, "row-menu");
  await expect(page.locator("#specimen-tariff-status")).toHaveText("Off");
  await tariff.press("Enter");
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await archiveTariff
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await expect(page.locator("#specimen-tariff-status")).toHaveText("Archived");
  await expect(tariff).toBeFocused();
  await tariff.press("Enter");
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.locator("#specimen-tariff-status")).toHaveText("Off");

  const message = page.getByLabel("More actions: Water meter replacement");
  await message.click();
  await page.getByRole("link", { name: "Open dwelling", exact: true }).click();
  await expect(page).toHaveURL(/#dwelling-actions$/);
  await expect(message.locator("..")).not.toHaveAttribute("open", "");
  await expect(page.locator("#dwelling-actions")).toBeFocused();

  const wideMenu = page.locator(".more-menu-wide");
  const dwellingActions = wideMenu.locator("summary");
  await dwellingActions.click();
  const panel = wideMenu.locator(":scope > div");
  await expect(panel).toHaveCSS("min-width", "208px");
  await expect(panel.getByText("No open period")).toBeVisible();
  const bounds = (await panel.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  await panel.getByRole("button", { name: "Archive dwelling" }).click();
  const archive = page.getByRole("dialog", { name: "Archive this dwelling?" });
  await expect(archive).toHaveAccessibleDescription(
    /Past invoices and readings/
  );
  await expect(archive.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(archive).toBeHidden();
  await expect(dwellingActions).toBeFocused();
  await dwellingActions.click();
  await panel.getByRole("button", { name: "Archive dwelling" }).click();
  await archive.getByRole("button", { name: "Archive dwelling" }).click();
  await expect(page.locator("#specimen-archive-status")).toContainText(
    "Archived"
  );

  await page.locator('#row-menu a[href="#lock-dialog"]').press("Enter");
  await expect(page.locator("#lock-dialog")).toBeFocused();
  const periodActions = page.getByLabel("Current Month actions");
  await periodActions.click();
  await page.getByRole("button", { name: "Lock period", exact: true }).click();
  const lock = page.getByRole("dialog", { name: "Lock this period?" });
  await expect(lock.getByRole("button", { name: "Cancel" })).toBeFocused();
  // Reopen before the first close event arrives, then dismiss by backdrop.
  await lock.evaluate((dialog) => {
    (dialog as HTMLDialogElement).close();
    document
      .querySelector<HTMLButtonElement>(
        '[data-open-lock-dialog="specimen-lock-period"]'
      )!
      .click();
  });
  await expect(lock).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(lock).toBeHidden();
  await expect(periodActions).toBeFocused();
  await expect(page.locator("#specimen-lock-status")).toHaveText(
    "Sample period open"
  );
  await periodActions.click();
  await page.getByRole("button", { name: "Lock period", exact: true }).click();
  await lock.getByRole("button", { name: "Lock period" }).click();
  await expect(page.locator("#specimen-lock-status")).toHaveText(
    "Sample period locked"
  );
  await expect(periodActions).toBeFocused();
  expect(posts).toEqual([]);
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

test("catalogue entry links and copy buttons use the hover token in both themes", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/design-system");
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") await page.locator("[data-theme-toggle]").click();
    const expected = await page
      .locator('[data-swatch="--color-hover"]')
      .evaluate((swatch) => getComputedStyle(swatch).backgroundColor);
    const foundationLink = page.locator('.ds-entry a[href="#color"]');
    await foundationLink.hover();
    await expect(foundationLink).toHaveCSS("background-color", expected);
    await openTopic(page, "status-badge");
    const copy = page.locator("#status-badge .copy-button");
    await copy.hover();
    await expect(copy).toHaveCSS("background-color", expected);
    await openTopic(page, "overview");
  }
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

test("canceling a case action returns focus to the trigger that opened the shared menu", async ({
  page,
}) => {
  await page.goto("/design-system#table");
  const trigger = page.getByRole("button", {
    name: "Case actions: Dwelling 12",
  });
  await trigger.evaluate((button) => {
    const second = button.cloneNode(true) as HTMLButtonElement;
    second.setAttribute("aria-label", "Other case actions");
    button.setAttribute("popovertargetaction", "show");
    button.parentNode!.insertBefore(second, button.nextSibling);
  });

  const menu = page.locator("#specimen-table-popover-12");
  await menu.evaluate((el) => {
    el.insertAdjacentHTML(
      "beforeend",
      '<form method="dialog" data-confirm="Void this sample draft?"><button>Confirm sample case action</button></form>'
    );
  });
  const second = page.getByRole("button", { name: "Other case actions" });
  await second.press("Enter");
  await expect(menu).toBeVisible();
  // Asking an already open popover to show must leave its opener recorded.
  await trigger.click();
  await expect(menu).toBeVisible();
  await menu
    .getByRole("button", { name: "Confirm sample case action" })
    .click();

  const confirmation = page.getByRole("dialog", {
    name: "Void this sample draft?",
  });
  await expect(confirmation).toBeVisible();
  await expect(menu).toBeHidden();
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(second).toBeFocused();

  await second.press("Enter");
  await menu
    .getByRole("button", { name: "Confirm sample case action" })
    .click();
  await expect(confirmation).toBeVisible();
  await trigger.evaluate((button) => button.remove());
  await second.evaluate((button) => button.replaceWith(button.cloneNode(true)));
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(second).toBeFocused();

  await second.press("Enter");
  await menu
    .getByRole("button", { name: "Confirm sample case action" })
    .click();
  const heading = page.locator("#table h1");
  await confirmation.evaluate((dialog) => {
    (dialog as HTMLDialogElement).close("cancel");
    document.querySelector<HTMLElement>("#table h1")!.focus();
  });
  await expect(confirmation).not.toHaveAttribute("data-asking", "");
  await expect(heading).toBeFocused();
});

test("integrated master patterns render and work interactively", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design-system#box");
  await expect(page.locator("#box")).not.toContainText("with a hairline");
  await expect(page.locator("#box .contained")).toHaveCount(1);

  // KPI breakdown keeps KpiCard alongside Collection & money breakdown, and
  // collapses the ledger below 32rem without closing when the user opens it.
  await openTopic(page, "kpi-card");
  await expect(page.locator("#kpi-card .kpi")).toHaveCount(2);
  await expect(
    page.locator("#kpi-card .collection-card .money-ledger .money-total")
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#kpi-card .collection-card")).toHaveCSS(
    "padding-left",
    "16px"
  );
  await expect(page.locator("#kpi-card .money-ledger")).toBeHidden();
  const refreshLedger = () =>
    page.locator("#specimen-collection-ledger").evaluate((ledger) => {
      const replacement = ledger.cloneNode(true) as HTMLDetailsElement;
      replacement.open = true;
      delete replacement.dataset.collapsed;
      ledger.replaceWith(replacement);
      document.dispatchEvent(new Event("workbench:refreshed"));
      // Let the resize observation run before checking the replacement.
      return new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
    });
  await page.locator("#kpi-card .collection-ledger > summary").click();
  await refreshLedger();
  await expect(
    page.locator("#kpi-card .money-ledger .money-total")
  ).toBeVisible();
  await page.locator("#kpi-card .collection-ledger > summary").click();
  await refreshLedger();
  await expect(page.locator("#kpi-card .money-ledger")).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    page.locator("#kpi-card .money-ledger .money-total")
  ).toBeVisible();

  // Building view renders entrances, stage tiles, borderless trays and view switch.
  await openTopic(page, "building-view");
  await expect(page.locator("#building-view .building-facade")).toBeVisible();
  await expect(
    page.locator("#building-view .building-arrange-start")
  ).toBeVisible();
  await expect(
    page.locator('#building-view .building-unit[data-stage="MISSING_DATA"]')
  ).toHaveCount(1);
  await expect(
    page.locator('#building-view .building-unit[data-stage="OVERDUE"]')
  ).toHaveCount(1);
  await expect(page.locator("#building-view .building-strip")).toHaveCSS(
    "border-top-width",
    "0px"
  );
  await page.locator('#building-view [data-view-target="table"]').click();
  await expect(
    page.locator('#building-view input[type="radio"][value="table"]')
  ).toBeChecked();
  await expect(
    page.locator('#building-view [data-view-panel="building"]')
  ).toBeHidden();
  await page.locator('#building-view [data-view-target="building"]').click();
  await expect(
    page.locator('#building-view input[type="radio"][value="building"]')
  ).toBeChecked();
  await expect(
    page.locator('#building-view [data-view-panel="building"]')
  ).toBeVisible();

  // Notice: real .mutation-summary pills and one-shot interactive inline Undo.
  await openTopic(page, "notice");
  await expect(
    page.locator("#notice .component-row .mutation-summary")
  ).toHaveCount(3);
  await page.locator("#notice [data-specimen-undo]").click();
  await expect(page.locator("#notice [data-specimen-undo-text]")).toHaveText(
    "Cold water tariff restored."
  );
  await expect(page.locator("#notice [data-specimen-undo-text]")).toBeFocused();
  await expect(page.locator("#notice [data-specimen-undo]")).toBeHidden();

  // Modal: context drawer opens and closes on Escape.
  await openTopic(page, "modal");
  await page.locator('[data-open-dialog="specimen-context-drawer"]').click();
  const drawer = page.locator("#specimen-context-drawer");
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  // Table specimens: voided cell, flash trigger, anchored popover link colors,
  // quiet status text, and bulk selection focus + live announcement.
  await openTopic(page, "table");
  await expect(page.locator('#table td[data-void="true"]')).toHaveCSS(
    "text-decoration-line",
    "line-through"
  );
  await page.locator("[data-flash-row-trigger]").click();
  await expect(page.locator("#specimen-flash-row")).toHaveClass(
    /row-changed-still/
  );

  const popoverTrigger = page.locator(
    'button.icon-btn[popovertarget="specimen-table-popover-12"]'
  );
  await popoverTrigger.click();
  const tablePopover = page.locator("#specimen-table-popover-12");
  await expect(tablePopover).toBeVisible();
  const triggerBox = (await popoverTrigger.boundingBox())!;
  const popoverBox = (await tablePopover.boundingBox())!;
  expect(
    Math.min(
      Math.abs(popoverBox.y - (triggerBox.y + triggerBox.height)),
      Math.abs(triggerBox.y - (popoverBox.y + popoverBox.height))
    )
  ).toBeLessThan(24);
  const menuColors = await tablePopover.evaluate((menu) => {
    const resolve = (token: string) => {
      const probe = document.createElement("span");
      probe.style.transition = "none";
      probe.style.color = `var(${token})`;
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const link = menu.querySelector("a:not(.menu-danger)")!;
    const danger = menu.querySelector("a.menu-danger")!;
    return {
      linkColor: getComputedStyle(link).color,
      dangerColor: getComputedStyle(danger).color,
      foreground: resolve("--color-foreground"),
      destructive: resolve("--color-destructive"),
    };
  });
  expect(menuColors.linkColor).toBe(menuColors.foreground);
  expect(menuColors.dangerColor).toBe(menuColors.destructive);
  await page.keyboard.press("Escape");
  await expect(tablePopover).toBeHidden();
  await expect(popoverTrigger).toBeFocused();

  await popoverTrigger.click();
  await expect(tablePopover).toBeVisible();
  await tablePopover.locator('[popovertargetaction="hide"]').click();
  await expect(tablePopover).toBeHidden();
  await expect(popoverTrigger).toBeFocused();

  // At 390px phone width, stacked .table-wrap-visible resets last-row corners to 0px.
  const roundedRows = page.locator(
    "#table .table-wrap-visible.stack-table tbody tr"
  );
  const finalRow = roundedRows.last();
  const previousRow = roundedRows.nth(-2);
  const corners = await finalRow.evaluate((row) => [
    getComputedStyle(row.firstElementChild!).borderBottomLeftRadius,
    getComputedStyle(row.lastElementChild!).borderBottomRightRadius,
  ]);
  for (const corner of corners)
    expect(Number.parseFloat(corner)).toBeGreaterThan(0);
  await finalRow.evaluate(
    (row) => ((row as HTMLTableRowElement).hidden = true)
  );
  await expect(previousRow.locator("td").first()).toHaveCSS(
    "border-bottom-left-radius",
    corners[0]
  );
  await expect(previousRow.locator("td").last()).toHaveCSS(
    "border-bottom-right-radius",
    corners[1]
  );
  await finalRow.evaluate(
    (row) => ((row as HTMLTableRowElement).hidden = false)
  );
  await page.setViewportSize({ width: 390, height: 900 });
  const stackedLastCells = page.locator(
    "#table .table-wrap-visible.stack-table tbody tr:last-child > td"
  );
  await expect(stackedLastCells.first()).toHaveCSS(
    "border-bottom-left-radius",
    "0px"
  );
  await expect(stackedLastCells.last()).toHaveCSS(
    "border-bottom-right-radius",
    "0px"
  );
  await page.setViewportSize({ width: 1440, height: 900 });

  const firstCheckbox = page.locator("[data-specimen-select]").first();
  const selectedRow = firstCheckbox.locator("xpath=ancestor::tr");
  await firstCheckbox.check();
  await expect(selectedRow).toHaveAttribute("data-selected", "");
  const navActiveBg = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--color-nav-active-bg)";
    document.body.appendChild(probe);
    const bg = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return bg;
  });
  await expect(selectedRow).toHaveCSS("background-color", navActiveBg);
  await selectedRow.hover();
  await expect(selectedRow).toHaveCSS("background-color", navActiveBg);
  const specimenBulkToolbar = page.locator("#specimen-bulk-toolbar");
  await expect(specimenBulkToolbar).toBeVisible();
  await expect(specimenBulkToolbar).toHaveCSS("top", "80px");
  await expect(page.locator("#specimen-selected-count")).toHaveText("1");
  await expect(page.locator("#specimen-selection-status")).toHaveText(
    "1 selected"
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(specimenBulkToolbar).toHaveCSS("position", "fixed");
  const mobileToolbarBox = (await specimenBulkToolbar.boundingBox())!;
  expect(mobileToolbarBox.height).toBeLessThan(220);
  expect(mobileToolbarBox.y).toBeGreaterThan(400);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#specimen-clear-selection").click();
  await expect(page.locator("#specimen-bulk-toolbar")).toBeHidden();
  await expect(page.locator("#specimen-selection-status")).toHaveText(
    "Selection cleared"
  );
  await expect(firstCheckbox).toBeFocused();
  await expect(page.locator("#table .status-text")).toBeVisible();

  // The status catalogue documents every status supported by the shared badge.
  await openTopic(page, "status-badge");
  const statusTable = page.getByRole("table", { name: "Status badges" });
  await expect(statusTable.locator("tbody tr")).toHaveCount(
    invoiceStatusCodes.length
  );
  expect(invoiceStatusBadge("DISABLED").icon).toBe("player-pause");
  for (const code of invoiceStatusCodes) {
    const row = statusTable.getByRole("row").filter({
      has: page.getByRole("cell", { name: `status="${code}"`, exact: true }),
    });
    await expect(
      row.getByRole("cell", {
        name: invoiceStatusBadge(code).label,
        exact: true,
      })
    ).toBeVisible();
  }

  // Tabs: workflow-rail filters update aria-current locally.
  await openTopic(page, "tabs");
  const draftFilter = page.locator("#tabs .workflow-filter", {
    hasText: "Draft",
  });
  await draftFilter.click();
  await expect(draftFilter).toHaveAttribute("aria-current", "page");

  // Tooltip: .mid-truncate clips .mid-start and reveals full serial on keyboard focus.
  await openTopic(page, "tooltip");
  const clipped = page.locator("#tooltip .mid-truncate[data-tip-clipped]");
  const isClipped = await clipped
    .locator(".mid-start")
    .evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(isClipped).toBe(true);
  await page.locator("#tooltip .ds-tip").first().focus();
  await page.keyboard.press("Tab");
  await expect(clipped).toBeFocused();
  await expect(page.locator("#app-tooltip[data-visible]")).toContainText(
    "Long meter serial number 2026-88412-04"
  );

  // Resident portal: fixture-local invoice links and real clipboard copy.
  await openTopic(page, "resident-portal");
  const invoiceHrefs = await page
    .locator("#resident-portal .resident-list a")
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  expect(invoiceHrefs.length).toBeGreaterThan(0);
  for (const href of invoiceHrefs) {
    expect(href).toMatch(/^#resident-portal\//);
  }
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const copyBtn = page.getByRole("button", { name: "Copy: IBAN", exact: true });
  await copyBtn.click();
  await expect(copyBtn).toHaveAttribute("data-copied", "");
  await expect(
    page.locator("#resident-portal [data-copy-status]")
  ).toContainText("Copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "LV80UNLA0050012345678"
  );

  // Pagination disables Previous via a non-focusable role=link span.
  await openTopic(page, "pagination");
  const disabledPrev = page.locator(
    '#pagination span[role="link"][aria-disabled="true"]'
  );
  await expect(disabledPrev).toHaveCount(1);
  await expect(disabledPrev).not.toHaveAttribute("tabindex", /.*/);

  // Forced-colors mode keeps the active bottom border distinct from focus outline.
  await page.emulateMedia({ forcedColors: "active" });
  await openTopic(page, "tabs");
  const activeWorkflowTab = page.locator(
    '#tabs .workflow-filter[aria-current="page"]'
  );
  await expect(activeWorkflowTab).toHaveCSS("border-bottom-width", "3px");
  await expect(activeWorkflowTab).toHaveCSS("outline-style", "none");
  await activeWorkflowTab.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(activeWorkflowTab).toHaveCSS("outline-style", "solid");
});
