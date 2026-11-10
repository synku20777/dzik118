import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

// Layout matrix for the core views (docs/product/DESIGN_SYSTEM.md, Patterns):
// login, dashboard, dwellings list and detail, payments, current month, setup
// wizard, invoice view and the resident portal, at 320/390/768/1024/1440px in
// both themes. Read-only. Failures are collected so one run lists them all.
//
// Per view, width and theme it checks: no horizontal overflow, target size
// (24px everywhere per WCAG 2.5.8, 44px on a coarse pointer per the design
// system), and a visible focus indicator for the first tab stops of the main
// content. Disclosures are opened first; dialogs, drawers and the contents of
// the invoice iframe are not audited. Separate tests cover token contrast and
// the breakpoint edges.

const DESKTOP_WIDTHS = [1440, 1024, 768];
const TOUCH_WIDTHS = [390, 320];
const THEMES = ["light", "dark"] as const;

// Each distinct problem once, with every theme and width where it occurs.
type Violations = Map<string, Set<string>>;
const add = (v: Violations, problem: string, where: string) => {
  const seen = v.get(problem) ?? new Set<string>();
  seen.add(where);
  v.set(problem, seen);
};
const report = (v: Violations) =>
  [...v].map(
    ([problem, where]) => problem + "  [" + [...where].join(", ") + "]"
  );

async function loginAdmin(page: Page): Promise<string> {
  await page.goto("/login?lang=en");
  await page.locator("#admin-email").fill("admin.a@example.com");
  await page.locator("#admin-password").fill("ChangeMe123!");
  await page.locator("#admin-login-form button").click();
  await page.waitForURL(/\/admin\/(organizations|o\/.+\/dashboard)/);
  if (new URL(page.url()).pathname === "/admin/organizations") {
    await page.locator('main a[href$="/dashboard"]').first().click();
    await page.waitForURL(/\/admin\/o\/.+\/dashboard/);
  }
  return new URL(page.url()).pathname.replace(/\/dashboard$/, "");
}

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

// One admin login per run: the auth rate limit is 5 per minute and shared with
// the sign-in link request, so every test reuses this session.
let adminSession: Promise<{ state: StorageState; base: string }> | undefined;
function adminSessionFor(browser: Browser) {
  adminSession ??= (async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const base = await loginAdmin(page);
    const state = await context.storageState();
    await context.close();
    return { state, base };
  })();
  return adminSession;
}

const MAILBOX = "http://127.0.0.1:54324/api/v1";
interface MailSummary {
  ID: string;
  To: { Address: string }[];
}
const mailFor = async (request: APIRequestContext) =>
  ((await (await request.get(`${MAILBOX}/messages`)).json()).messages ??
    []) as MailSummary[];

async function loginResident(
  page: Page,
  request: APIRequestContext
): Promise<void> {
  // Only a message that arrives after this request can hold a live token.
  const before = new Set((await mailFor(request)).map((m) => m.ID));
  await page.goto("/login?lang=en");
  await page.locator("#resident-email").fill("resident1@example.com");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page).toHaveURL(/sent=1/);
  let message: MailSummary | undefined;
  for (let attempt = 0; attempt < 20 && !message; attempt++) {
    message = (await mailFor(request)).find(
      (m) =>
        !before.has(m.ID) &&
        m.To.some((to) => to.Address === "resident1@example.com")
    );
    if (!message) await page.waitForTimeout(500);
  }
  if (!message) throw new Error("no new sign-in email for resident1");
  const mail = await (
    await request.get(`${MAILBOX}/message/${message.ID}`)
  ).json();
  const html = mail.HTML as string;
  const href =
    html.match(/href="([^"]*\/auth\/confirm[^"]*)"/)?.[1] ??
    html.match(/href="([^"]+)"/)![1];
  const link = new URL(href.replaceAll("&amp;", "&"));
  await page.goto(link.pathname + link.search);
  await page.getByRole("button", { name: "Confirm sign-in" }).click();
  await page.waitForURL(/\/portal\/dwellings(?:\/.*)?$/);
}

const withLang = (path: string) =>
  path + (path.includes("?") ? "&" : "?") + "lang=en";

/** Runs in the page: overflow and target-size violations. */
function auditLayout(page: Page, coarse: boolean): Promise<string[]> {
  return page.evaluate((coarse) => {
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > innerWidth + 1) {
      out.push(`overflow: scrollWidth ${doc.scrollWidth} > ${innerWidth}`);
    }
    const describe = (el: Element) => {
      const text = (el.textContent ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 28);
      const cls = typeof el.className === "string" ? el.className : "";
      return `<${el.tagName.toLowerCase()} class="${cls.slice(0, 50)}"> ${text}`;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return (
        r.width > 0 &&
        r.height > 0 &&
        cs.visibility !== "hidden" &&
        cs.display !== "none" &&
        !el.closest("[hidden], [inert], .sr-only, .skip-link") &&
        !el.closest("dialog:not([open])") &&
        !el.closest("details:not([open]) > :not(summary)")
      );
    };
    const minimum = coarse ? 44 : 24;
    const selector =
      "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button]";
    // Controls must meet the full minimum. A text link only needs WCAG 2.5.8:
    // 24px, or no other target within a 24px circle around it.
    const isControl = (el: Element) =>
      el.matches(
        "button, input, select, textarea, summary, [role=button], a.btn-primary, a.btn-secondary, a.btn-danger, a.btn-ghost, a.icon-btn"
      );
    const targets = [...document.querySelectorAll(selector)].filter(visible);
    const boxOf = (el: Element) => {
      const checkable =
        el instanceof HTMLInputElement &&
        (el.type === "checkbox" || el.type === "radio");
      const label = checkable ? el.labels?.[0] : undefined;
      const a = el.getBoundingClientRect();
      if (!label) return a;
      const b = label.getBoundingClientRect();
      const left = Math.min(a.left, b.left);
      const top = Math.min(a.top, b.top);
      return new DOMRect(
        left,
        top,
        Math.max(a.right, b.right) - left,
        Math.max(a.bottom, b.bottom) - top
      );
    };
    // WCAG 2.5.8 spacing: a 24px circle centred on the target must not touch
    // another target. Against a target that is itself under 24px the two
    // circles must not overlap (centres 24px apart); against a larger one the
    // circle must clear its box.
    const crowded = (el: Element, box: DOMRect) => {
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      return targets.some((other) => {
        if (other === el || other.contains(el) || el.contains(other))
          return false;
        const o = other.getBoundingClientRect();
        if (Math.min(o.width, o.height) < 24) {
          const ox = o.left + o.width / 2;
          const oy = o.top + o.height / 2;
          return Math.hypot(cx - ox, cy - oy) < 24;
        }
        const nx = Math.max(o.left, Math.min(cx, o.right));
        const ny = Math.max(o.top, Math.min(cy, o.bottom));
        return (cx - nx) ** 2 + (cy - ny) ** 2 < 12 ** 2;
      });
    };
    // Exempt only a link set inside a sentence: its parent has more text.
    const inSentence = (el: Element) => {
      const own = (el.textContent ?? "").trim().length;
      const around = (el.parentElement?.textContent ?? "").trim().length;
      return around > own + 3;
    };
    for (const el of targets) {
      const cs = getComputedStyle(el);
      // A stretched row link (.row-link-target) is activated by the whole row.
      if (el.tagName === "A" && cs.display === "inline" && inSentence(el))
        continue;
      if (el.matches(".row-link-target")) continue;
      const box = boxOf(el);
      // A checkbox or radio without a label is held to 2.5.8 (24px or
      // spacing); with a label, label plus box is the target.
      const bare =
        el instanceof HTMLInputElement &&
        (el.type === "checkbox" || el.type === "radio") &&
        !el.labels?.length;
      const need = isControl(el) && !bare ? minimum : 24;
      // 1px of tolerance for subpixel layout (a 44px control can measure 43.4).
      const small = box.width < need - 1 || box.height < need - 1;
      if (
        small &&
        (isControl(el) && !bare && coarse ? true : crowded(el, box))
      ) {
        out.push(
          `target ${Math.round(box.width)}x${Math.round(box.height)} < ${need}: ${describe(el)}`
        );
      }
    }
    return out;
  }, coarse);
}

/**
 * Tabs through the first stops of the main content (not the sidebar, which
 * comes first in the DOM) and reports any without a focus indicator.
 */
async function auditFocus(page: Page, stops = 12): Promise<string[]> {
  const out: string[] = [];
  await page.evaluate(() => {
    const main =
      document.getElementById("main-content") ?? document.querySelector("main");
    if (!main) return;
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
    main.focus();
  });
  for (let i = 0; i < stops; i++) {
    await page.keyboard.press("Tab");
    const result = await page.evaluate(async () => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => resolve(null))
      );
      const el = document.activeElement;
      // Native inner parts (a date field's picker button) draw their own focus.
      if (!el || el === document.body || el.tagName === "IFRAME") return null;
      if (!el.matches(":focus-visible")) return null;
      const cs = getComputedStyle(el);
      const outline =
        cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2;
      // A resting shadow is not a focus indicator: the outline must be drawn.
      const label = `${el.tagName.toLowerCase()}${el instanceof HTMLInputElement ? `[${el.type}]` : ""}.${String(el.className).slice(0, 40)} ${el.getAttribute("name") ?? ""}`;
      return { ok: outline, label };
    });
    if (result && !result.ok) out.push(`no focus indicator: ${result.label}`);
  }
  return out;
}

async function setTheme(page: Page, theme: string) {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
  }, theme);
}

interface View {
  name: string;
  path: string;
}

async function sweep(
  browser: Browser,
  storageState: Awaited<ReturnType<BrowserContext["storageState"]>> | undefined,
  views: View[],
  violations: Violations
) {
  for (const coarse of [false, true]) {
    const widths = coarse ? TOUCH_WIDTHS : DESKTOP_WIDTHS;
    const context = await browser.newContext({
      storageState,
      hasTouch: coarse,
      isMobile: coarse,
      viewport: { width: widths[0], height: 900 },
    });
    const page = await context.newPage();
    await page.goto("/login?lang=en");
    const pointerIsCoarse = await page.evaluate(
      () => matchMedia("(pointer: coarse)").matches
    );
    if (pointerIsCoarse !== coarse) {
      add(
        violations,
        `emulation: (pointer: coarse) is ${pointerIsCoarse}`,
        "-"
      );
    }
    for (const view of views) {
      const response = await page.goto(withLang(view.path));
      await page.waitForLoadState("load");
      // Guard against auditing a redirect (for example the login page) under
      // another view's name.
      const landed = new URL(page.url()).pathname;
      if (
        !response ||
        response.status() >= 400 ||
        landed !== view.path.split("?")[0]
      ) {
        add(
          violations,
          `${view.name}: expected ${view.path}, got ${landed} (${response?.status()})`,
          "-"
        );
        continue;
      }
      // Open every disclosure so the controls inside them are audited too.
      // Dialogs and drawers need an interaction and are not covered.
      await page.evaluate(() =>
        document
          .querySelectorAll("main details:not([open])")
          .forEach((d) => d.setAttribute("open", ""))
      );
      // Let fonts and any open-state transitions settle before measuring.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      for (const theme of THEMES) {
        await setTheme(page, theme);
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          await page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => resolve(null))
              )
          );
          const found = [
            ...(await auditLayout(page, coarse)),
            ...(await auditFocus(page)),
          ];
          for (const message of found) {
            add(violations, `${view.name}: ${message}`, `${theme} ${width}`);
          }
        }
      }
    }
    await context.close();
  }
}

test("admin and auth views hold their layout at every width and theme", async ({
  page,
  browser,
}) => {
  test.setTimeout(900_000);
  const violations: Violations = new Map();

  // Unauthenticated: the login page.
  await sweep(
    browser,
    undefined,
    [{ name: "login", path: "/login" }],
    violations
  );

  const { state, base } = await adminSessionFor(browser);
  const authed = await browser.newContext({ storageState: state });
  const probe = await authed.newPage();
  const link = async (path: string, prefix: string) => {
    await probe.goto(withLang(path));
    const href = await probe
      .locator(
        `main a[href^="${prefix}"]:not([href*="import"]):not([href*="export"]):not([href$="/new"])`
      )
      .first()
      .getAttribute("href", { timeout: 5_000 });
    expect(href, `a link starting ${prefix} on ${path}`).toBeTruthy();
    return href!;
  };
  const dwelling = await link(`${base}/dwellings`, `${base}/dwellings/`);
  const period = await link(`${base}/periods`, `${base}/periods/`);
  const invoice = await link(period, `${period}/invoices/`);
  await authed.close();
  void page;

  const views: View[] = [
    { name: "dashboard", path: `${base}/dashboard` },
    { name: "dwellings", path: `${base}/dwellings` },
    { name: "dwelling detail", path: dwelling },
    { name: "payments", path: `${base}/payments` },
    { name: "periods", path: `${base}/periods` },
    { name: "current month", path: period },
    { name: "invoice view", path: invoice },
    { name: "setup organization", path: `${base}/setup/organization` },
    { name: "setup charges", path: `${base}/setup/charges` },
  ];
  await sweep(browser, state, views, violations);

  expect(report(violations)).toEqual([]);
});

test("resident portal holds its layout at every width and theme", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(900_000);
  const violations: Violations = new Map();
  await loginResident(page, request);
  if (new URL(page.url()).pathname === "/portal/dwellings") {
    await page.locator('main a[href^="/portal/dwellings/"]').first().click();
    await page.waitForURL("**/portal/dwellings/*");
  }
  const home = new URL(page.url()).pathname;
  const state = await page.context().storageState();
  await page.goto(withLang(`${home}/invoices`));
  const invoice = await page
    .locator('main a[href^="/portal/invoices/"]')
    .first()
    .getAttribute("href", { timeout: 5_000 });
  expect(invoice, "a resident invoice link").toBeTruthy();
  const views: View[] = [
    { name: "portal home", path: home },
    { name: "portal invoices", path: `${home}/invoices` },
    { name: "portal profile", path: "/portal/profile" },
    { name: "portal invoice", path: invoice! },
  ];
  await sweep(browser, state, views, violations);
  expect(report(violations)).toEqual([]);
});

test("the shell and panes switch exactly at their breakpoints", async ({
  browser,
}) => {
  const { state, base } = await adminSessionFor(browser);
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();
  const settle = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    );

  // The persistent sidebar starts at lg (70rem = 1120px).
  await page.goto(withLang(`${base}/dashboard`));
  const sidebar = page.locator(".admin-sidebar");
  const mobileBar = page.locator(".admin-mobile");
  await page.setViewportSize({ width: 1119, height: 900 });
  await expect(sidebar).toBeHidden();
  await expect(mobileBar).toBeVisible();
  await page.setViewportSize({ width: 1120, height: 900 });
  await expect(sidebar).toBeVisible();
  await expect(mobileBar).toBeHidden();

  // Tables stack into labelled cards only below sm (40rem).
  await page.goto(withLang(`${base}/dwellings`));
  const stacked = page.locator(".stack-table tbody tr").first();
  await expect(
    stacked,
    "a stack-table row on the dwellings list"
  ).toBeVisible();
  await page.setViewportSize({ width: 639, height: 900 });
  await expect(stacked).toHaveCSS("display", "block");
  await page.setViewportSize({ width: 640, height: 900 });
  await expect(stacked).not.toHaveCSS("display", "block");

  // The dwelling two-pane layout follows its own area, not the screen: it
  // needs 60rem. At 1120 the sidebar leaves less than that.
  const href = await page
    .locator(
      `main a[href^="${base}/dwellings/"]:not([href*="import"]):not([href*="export"]):not([href$="/new"])`
    )
    .first()
    .getAttribute("href", { timeout: 5_000 });
  expect(href, "a dwelling link").toBeTruthy();
  await page.goto(withLang(href!));
  const columns = () =>
    page
      .locator(".dwelling-grid")
      .evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length
      );
  for (const [width, expected] of [
    [1440, 2],
    [1120, 1],
    [900, 1],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await settle();
    expect(await columns(), `dwelling grid columns at ${width}px`).toBe(
      expected
    );
  }
  await context.close();
});

test("semantic token pairs meet WCAG AA in both themes", async ({ page }) => {
  await page.goto("/design-system");
  const failures: string[] = [];
  for (const theme of THEMES) {
    await setTheme(page, theme);
    const result = await page.evaluate(async () => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => resolve(null))
      );
      const probe = document.createElement("span");
      document.body.appendChild(probe);
      const resolve = (token: string): [number, number, number, number] => {
        probe.style.color = `var(${token})`;
        const value = getComputedStyle(probe).color;
        const nums = value.match(/-?[\d.]+/g)?.map(Number) ?? [0, 0, 0];
        if (value.startsWith("color(")) {
          return [nums[0] * 255, nums[1] * 255, nums[2] * 255, nums[3] ?? 1];
        }
        return [nums[0], nums[1], nums[2], nums[3] ?? 1];
      };
      const over = (
        top: [number, number, number, number],
        under: number[]
      ): [number, number, number] => [
        top[0] * top[3] + under[0] * (1 - top[3]),
        top[1] * top[3] + under[1] * (1 - top[3]),
        top[2] * top[3] + under[2] * (1 - top[3]),
      ];
      const lum = ([r, g, b]: number[]) => {
        const f = (c: number) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a: number[], b: number[]) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const opaque = (token: string) => resolve(token).slice(0, 3);
      const surface = resolve("--color-surface");
      const canvas = resolve("--color-canvas");
      const rows: { pair: string; ratio: number; min: number }[] = [];
      const text = (fg: string, bg: string, min = 4.5) => {
        const under = bg === "--color-surface" ? surface : canvas;
        rows.push({
          pair: `${fg} on ${bg}`,
          ratio: ratio(over(resolve(fg), under), opaque(bg)),
          min,
        });
      };
      for (const fg of [
        "--color-foreground",
        "--color-muted",
        "--color-primary",
        "--color-destructive",
        "--color-success",
        "--color-warning",
      ]) {
        text(fg, "--color-surface");
        text(fg, "--color-canvas");
      }
      for (const tone of [
        "neutral",
        "info",
        "success",
        "warning",
        "danger",
        "positive",
      ]) {
        const bg = over(resolve(`--tone-${tone}-bg`), surface);
        rows.push({
          pair: `--tone-${tone}-text on --tone-${tone}-bg`,
          ratio: ratio(over(resolve(`--tone-${tone}-text`), bg), bg),
          min: 4.5,
        });
      }
      rows.push({
        pair: "--color-on-primary on --color-primary",
        ratio: ratio(opaque("--color-on-primary"), opaque("--color-primary")),
        min: 4.5,
      });
      for (const token of ["--color-input-border", "--color-focus-ring"]) {
        for (const bg of ["--color-surface", "--color-canvas"]) {
          rows.push({
            pair: `${token} on ${bg}`,
            ratio: ratio(opaque(token), opaque(bg)),
            min: 3,
          });
        }
      }
      probe.remove();
      return rows;
    });
    for (const row of result) {
      if (row.ratio < row.min) {
        failures.push(
          `${theme}: ${row.pair} ${row.ratio.toFixed(2)} < ${row.min}`
        );
      }
    }
  }
  expect(failures, failures.join("\n")).toEqual([]);
});
