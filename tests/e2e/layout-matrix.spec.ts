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
// system), and, at desktop widths, a visible focus indicator for the first
// tab stops. Separate tests cover token contrast and the breakpoint edges.

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

async function loginResident(
  page: Page,
  request: APIRequestContext
): Promise<void> {
  await page.goto("/login?lang=en");
  await page.locator("#resident-email").fill("resident1@example.com");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page).toHaveURL(/sent=1/);
  let message: { ID: string } | undefined;
  for (let attempt = 0; attempt < 20 && !message; attempt++) {
    const mailbox = await (
      await request.get("http://127.0.0.1:54324/api/v1/messages")
    ).json();
    message = mailbox.messages.find((m: { To: { Address: string }[] }) =>
      m.To.some((to) => to.Address === "resident1@example.com")
    );
    if (!message) await page.waitForTimeout(500);
  }
  if (!message) throw new Error("no sign-in email for resident1");
  const mail = await (
    await request.get(`http://127.0.0.1:54324/api/v1/message/${message.ID}`)
  ).json();
  const link = new URL(
    mail.HTML.match(/href="([^"]+)"/)[1].replaceAll("&amp;", "&")
  );
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
    const crowded = (el: Element, box: DOMRect) => {
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      return targets.some((other) => {
        if (other === el || other.contains(el) || el.contains(other))
          return false;
        const o = other.getBoundingClientRect();
        const nx = Math.max(o.left, Math.min(cx, o.right));
        const ny = Math.max(o.top, Math.min(cy, o.bottom));
        return (cx - nx) ** 2 + (cy - ny) ** 2 < 12 ** 2;
      });
    };
    for (const el of targets) {
      const cs = getComputedStyle(el);
      // A link inside a sentence is exempt (2.5.8); a stretched row link
      // (.row-link-target) is activated by the whole row.
      if (el.tagName === "A" && cs.display === "inline") continue;
      if (el.matches(".row-link-target")) continue;
      const box = boxOf(el);
      // A checkbox or radio without a label is held to 2.5.8 (24px or
      // spacing); with a label, label plus box is the target.
      const bare =
        el instanceof HTMLInputElement &&
        (el.type === "checkbox" || el.type === "radio") &&
        !el.labels?.length;
      const need = isControl(el) && !bare ? minimum : 24;
      const small = box.width < need - 0.5 || box.height < need - 0.5;
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

/** Tabs through the first stops and reports any without a focus indicator. */
async function auditFocus(page: Page, stops = 14): Promise<string[]> {
  const out: string[] = [];
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
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
      const ring = cs.boxShadow !== "none";
      const label = `${el.tagName.toLowerCase()}${el instanceof HTMLInputElement ? `[${el.type}]` : ""}.${String(el.className).slice(0, 40)} ${el.getAttribute("name") ?? ""}`;
      return { ok: outline || ring, label };
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
    for (const view of views) {
      await page.goto(withLang(view.path));
      await page.waitForLoadState("load");
      for (const theme of THEMES) {
        await setTheme(page, theme);
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          const found = await auditLayout(page, coarse);
          for (const message of found) {
            add(violations, `${view.name}: ${message}`, `${theme} ${width}`);
          }
        }
        if (!coarse) {
          await page.setViewportSize({ width: 1440, height: 900 });
          for (const message of await auditFocus(page)) {
            add(violations, `${view.name}: ${message}`, `${theme} 1440`);
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
  test.setTimeout(600_000);
  const violations: Violations = new Map();

  // Unauthenticated: the login page.
  await sweep(
    browser,
    undefined,
    [{ name: "login", path: "/login" }],
    violations
  );

  const base = await loginAdmin(page);
  const state = await page.context().storageState();
  const link = async (path: string, prefix: string) => {
    await page.goto(withLang(path));
    return page
      .locator(
        `main a[href^="${prefix}"]:not([href*="import"]):not([href*="export"]):not([href$="/new"])`
      )
      .first()
      .getAttribute("href");
  };

  const dwelling = await link(`${base}/dwellings`, `${base}/dwellings/`);
  const period = await link(`${base}/periods`, `${base}/periods/`);
  const views: View[] = [
    { name: "dashboard", path: `${base}/dashboard` },
    { name: "dwellings", path: `${base}/dwellings` },
    { name: "payments", path: `${base}/payments` },
    { name: "periods", path: `${base}/periods` },
    { name: "setup organization", path: `${base}/setup/organization` },
    { name: "setup charges", path: `${base}/setup/charges` },
  ];
  if (dwelling) views.push({ name: "dwelling detail", path: dwelling });
  if (period) {
    views.push({ name: "current month", path: period });
    const invoice = await link(period, `${period}/invoices/`);
    if (invoice) views.push({ name: "invoice view", path: invoice });
  }
  await sweep(browser, state, views, violations);

  expect(report(violations)).toEqual([]);
});

test("resident portal holds its layout at every width and theme", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(600_000);
  const violations: Violations = new Map();
  await loginResident(page, request);
  if (new URL(page.url()).pathname === "/portal/dwellings") {
    await page.locator('main a[href^="/portal/dwellings/"]').first().click();
    await page.waitForURL(/\/portal\/dwellings\/.+/);
  }
  const home = new URL(page.url()).pathname;
  const state = await page.context().storageState();
  await page.goto(withLang(`${home}/invoices`));
  const invoice = await page
    .locator('main a[href^="/portal/invoices/"]')
    .first()
    .getAttribute("href");
  const views: View[] = [
    { name: "portal home", path: home },
    { name: "portal invoices", path: `${home}/invoices` },
    { name: "portal profile", path: "/portal/profile" },
  ];
  if (invoice) views.push({ name: "portal invoice", path: invoice });
  await sweep(browser, state, views, violations);
  expect(report(violations)).toEqual([]);
});

test("the shell switches exactly at the lg and sm breakpoints", async ({
  page,
}) => {
  const base = await loginAdmin(page);
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
  if ((await stacked.count()) > 0) {
    await page.setViewportSize({ width: 639, height: 900 });
    await expect(stacked).toHaveCSS("display", "block");
    await page.setViewportSize({ width: 640, height: 900 });
    await expect(stacked).not.toHaveCSS("display", "block");
  }
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
