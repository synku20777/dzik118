import { expect, test, type Page } from "@playwright/test";

// Read-only: nothing here confirms, reverses or records a payment.
async function login(page: Page): Promise<string> {
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

// "€1,234.50" / "1 234,50 €" -> 1234.5
const amount = (text: string | null) => {
  const digits = (text ?? "").replace(/[^\d,.-]/g, "");
  const normalized = /,\d{1,2}$/.test(digits)
    ? digits.replace(/\./g, "").replace(",", ".")
    : digits.replace(/,/g, "");
  return Math.abs(Number(normalized));
};

test("Payments reads as review queue plus history, and every payment explains itself", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const base = await login(page);

  await page.goto(`${base}/payments?lang=en`);
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator(".metric-strip .metric")).toHaveCount(4);
  await expect(page.locator("#review")).toBeVisible();
  // Fields: text sits clear of the border; a select keeps room for its arrow.
  const padding = (selector: string) =>
    page.locator(selector).evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        left: parseFloat(style.paddingLeft),
        right: parseFloat(style.paddingRight),
      };
    });
  expect((await padding("#payments-q")).left).toBeGreaterThanOrEqual(10);
  expect((await padding("#payments-q")).right).toBeGreaterThanOrEqual(10);
  expect((await padding("#payments-status")).left).toBeGreaterThanOrEqual(10);
  expect((await padding("#payments-status")).right).toBeGreaterThanOrEqual(30);
  // The header actions are one joined group: shared edges, outer corners only.
  const group = page.getByRole("group", { name: "Payment actions" });
  await expect(group).toHaveCount(1);
  const radii = await group.locator("> *").evaluateAll((els) =>
    els.map((el) => {
      const target = el.matches("details") ? el.querySelector("summary")! : el;
      const style = getComputedStyle(target);
      return [style.borderTopLeftRadius, style.borderTopRightRadius];
    })
  );
  expect(radii).toHaveLength(3);
  expect(radii[0][0]).not.toBe("0px");
  expect(radii[0][1]).toBe("0px");
  expect(radii[1]).toEqual(["0px", "0px"]);
  expect(radii[2][0]).toBe("0px");
  expect(radii[2][1]).not.toBe("0px");
  await expect(page.locator("#history")).toBeVisible();

  // Every history row names its dwelling and links to its trail.
  const rows = page.locator("#history tbody tr");
  const total = await rows.count();
  expect(total).toBeGreaterThan(0);
  for (const row of await rows.all()) {
    await expect(row.locator('a[href*="/payments/"]').first()).toBeVisible();
  }

  // Search narrows; the count line says by how much; clearing restores it.
  const firstDwelling = (
    await rows.first().locator("td").nth(1).textContent()
  )?.trim();
  await page.locator("#payments-q").fill(firstDwelling!);
  await page.locator(".filter-submit").click();
  await expect(page).toHaveURL(/q=/);
  const narrowed = await page.locator("#history tbody tr").count();
  expect(narrowed).toBeGreaterThan(0);
  expect(narrowed).toBeLessThanOrEqual(total);
  await page.locator(".clear-filters").click();
  await expect(page.locator("#history tbody tr")).toHaveCount(total);

  // Older links (?view=) still land on the right filter.
  await page.goto(`${base}/payments?view=CONFIRMED&lang=en`);
  await expect(page.locator("#payments-status")).toHaveValue("received");
  for (const status of await page
    .locator("#history tbody tr")
    .evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-status"))))
    expect(status).toBe("CONFIRMED");
  await page.goto(`${base}/payments?status=reversed&lang=en`);
  for (const status of await page
    .locator("#history tbody tr")
    .evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-status"))))
    expect(status).toBe("REVERSED");

  // "Record a payment" opens inside the viewport at every width.
  for (const width of [1440, 768, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/payments?lang=en`);
    await page.locator(".btn-group summary").first().click();
    const panel = (await page.locator(".edit-disclosure-panel").boundingBox())!;
    expect(panel.x, `panel left at ${width}`).toBeGreaterThanOrEqual(0);
    expect(
      panel.x + panel.width,
      `panel right at ${width}`
    ).toBeLessThanOrEqual(width);
  }

  // On a phone each payment is a card: the money leads, actions close it.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`${base}/payments?lang=en`);
  const card = page.locator("#history tbody tr").first();
  const top = async (col: string) =>
    (await card.locator(`td[data-col="${col}"]`).boundingBox())!.y;
  expect(
    Math.abs((await top("dwelling")) - (await top("amount")))
  ).toBeLessThan(8);
  expect(Math.abs((await top("from")) - (await top("status")))).toBeLessThan(
    12
  );
  expect(await top("applied")).toBeGreaterThan(await top("from"));
  expect(await top("actions")).toBeGreaterThan(await top("applied"));
  // Labels are dropped except the two that name a bare value: "Dwelling" (so the
  // card does not lead with just "4") and "Applied to".
  const label = (col: string) =>
    card
      .locator(`td[data-col="${col}"]`)
      .evaluate((el) => getComputedStyle(el, "::before").display);
  expect(await label("from")).toBe("none");
  expect(await label("amount")).toBe("none");
  expect(await label("date")).toBe("none");
  expect(await label("dwelling")).not.toBe("none");
  expect(await label("applied")).not.toBe("none");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/payments?lang=en`);

  // The trail.
  await page.goto(`${base}/payments?lang=en`);
  await page
    .locator('#history tbody tr a[href*="/payments/"]:not([href*="ledger"])')
    .first()
    .click();
  await expect(page).toHaveURL(/\/payments\/[0-9a-f-]{36}/);
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator(".metric-strip .metric")).toHaveCount(4);
  expect(await page.locator(".trail li").count()).toBeGreaterThan(0);
  // Oldest first.
  const times = await page
    .locator(".trail time")
    .evaluateAll((els) => els.map((el) => el.getAttribute("datetime")!));
  expect([...times].sort()).toEqual(times);
  await expect(
    page.getByRole("heading", { name: "Where the money went" })
  ).toBeVisible();
  // What was applied plus what stayed as credit never exceeds what arrived.
  const metrics = await page.locator(".metric-value").allTextContents();
  const [received, applied, credit] = metrics.map(amount);
  expect(applied + credit).toBeLessThanOrEqual(received + 0.005);

  await page.screenshot({
    path: testInfo.outputPath("payment-trail.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("The ledger, the dwelling page and the payment trail agree on the money", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const base = await login(page);

  await page.goto(`${base}/payments/ledger?lang=en`);
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator(".metric-strip .metric")).toHaveCount(3);
  const rowCount = await page.locator("tbody tr").count();
  expect(rowCount).toBeGreaterThan(0);
  // Debits and credits in the strip are over every matching entry; net is
  // the size of their difference (the sign is shown in words beside it).
  const [debits, credits, net] = (
    await page.locator(".metric-value").allTextContents()
  ).map(amount);
  expect(Math.abs(Math.abs(credits - debits) - net)).toBeLessThan(0.006);

  // One dwelling: the statement carries a running balance...
  const dwellingId = await page
    .locator('a[href*="/payments/ledger?dwelling="]')
    .first()
    .getAttribute("href")
    .then((href) => new URL(href!, page.url()).searchParams.get("dwelling")!);
  await page.goto(`${base}/payments/ledger?dwelling=${dwellingId}&lang=en`);
  await expect(page.locator(".metric-strip .metric")).toHaveCount(4);
  await expect(page.locator("th", { hasText: "Balance" })).toBeVisible();
  const newestBalance = amount(
    await page.locator("tbody tr").first().locator("td").nth(4).textContent()
  );
  const closing = amount(
    await page.locator(".metric-strip .metric-value").last().textContent()
  );
  expect(Math.abs(newestBalance - closing)).toBeLessThan(0.006);

  // ...and it is the same balance the dwelling page shows.
  await page.goto(`${base}/dwellings/${dwellingId}?lang=en`);
  const dwellingBalance = amount(
    await page.locator(".summary-stat .summary-value").first().textContent()
  );
  expect(Math.abs(dwellingBalance - closing)).toBeLessThan(0.006);
  // The statement link sits with the ledger, on the Account balance tab.
  await page.getByRole("tab", { name: "Account balance" }).click();
  await page.getByRole("link", { name: "Full statement" }).click();
  await expect(page).toHaveURL(new RegExp(`dwelling=${dwellingId}`));

  // A date filter changes the rows, never the balance of a row.
  const balancesBefore = await page
    .locator("tbody tr")
    .evaluateAll((trs) => trs.map((tr) => tr.children[4]?.textContent));
  await page.goto(
    `${base}/payments/ledger?dwelling=${dwellingId}&from=2026-09-01&lang=en`
  );
  const balancesAfter = await page
    .locator("tbody tr")
    .evaluateAll((trs) => trs.map((tr) => tr.children[4]?.textContent));
  expect(balancesBefore.slice(0, balancesAfter.length)).toEqual(balancesAfter);

  // A dwelling id from another building never leaks: it shows the whole ledger.
  await page.goto(
    `${base}/payments/ledger?dwelling=00000000-0000-4000-8000-000000000000&lang=en`
  );
  await expect(page.locator(".metric-strip .metric")).toHaveCount(3);

  await page.goto(`${base}/payments/ledger?dwelling=${dwellingId}&lang=en`);
  await page.screenshot({
    path: testInfo.outputPath("ledger-statement.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("Payments pages fit every width, language and theme", async ({ page }) => {
  test.setTimeout(240_000);
  const base = await login(page);
  await page.goto(`${base}/payments?lang=en`);
  const trail = await page
    .locator('#history tbody tr a[href*="/payments/"]:not([href*="ledger"])')
    .first()
    .getAttribute("href");
  const paths = [`${base}/payments`, `${base}/payments/ledger`, trail!];
  for (const locale of ["en", "lv", "ru"]) {
    for (const path of paths) {
      await page.goto(`${path}?lang=${locale}`);
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (value) => (document.documentElement.dataset.theme = value),
          theme
        );
        for (const width of [1440, 1024, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          await expect
            .poll(
              () =>
                page.evaluate(
                  () => document.documentElement.scrollWidth <= innerWidth + 1
                ),
              { message: `${path} ${locale} ${theme} ${width}` }
            )
            .toBe(true);
        }
      }
    }
  }
});
