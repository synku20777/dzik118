import { expect, test } from "@playwright/test";

test("Dwelling detail reads as one summary, filters by section and stays readable at every width", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/login?lang=en");
  await page.locator("#admin-email").fill("admin.a@example.com");
  await page.locator("#admin-password").fill("ChangeMe123!");
  await page.locator("#admin-login-form button").click();
  await page.waitForURL(/\/admin\/(organizations|o\/.+\/dashboard)/);
  if (new URL(page.url()).pathname === "/admin/organizations") {
    await page.locator('main a[href$="/dashboard"]').first().click();
    await page.waitForURL(/\/admin\/o\/.+\/dashboard/);
  }
  const base = new URL(page.url()).pathname.replace(/\/dashboard$/, "");
  await page.goto(`${base}/dwellings?lang=en`);
  const href = await page
    .locator("tbody a.row-link-target")
    .first()
    .getAttribute("href");
  expect(href).toBeTruthy();
  const detail = `${href}?lang=en`;
  await page.goto(detail);

  await expect(page.locator("main h1")).toHaveCount(1);
  // One summary surface; the area and resident values are the only <p> in
  // their stat, so a save updates the value and not the label.
  const stats = page.locator(".dwelling-summary .summary-stat");
  await expect(stats).toHaveCount(4);
  for (const kpi of ["area", "resident-count", "invoice-delivery"])
    await expect(page.locator(`[data-kpi="${kpi}"] p`)).toHaveCount(1);

  // Six tabs; portal access is a panel in Overview, not a tab.
  await expect(page.getByRole("tab")).toHaveCount(6);
  await expect(page.getByRole("tab", { name: /Residents/ })).toHaveCount(0);
  await expect(page.locator("#portal-access-title")).toHaveText(
    "Portal access"
  );
  // The meters count describes the real list.
  const metersTab = page.getByRole("tab", { name: /Meters/ });
  const activeMeters = await page
    .locator("#meters-list-region .meter-row[data-archived='false']")
    .count();
  await expect(metersTab.locator(".tab-count")).toHaveText(
    String(activeMeters)
  );

  // A tab shows only its own panel, and ?tab= survives a reload.
  await metersTab.click();
  await expect(metersTab).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/[?&]tab=meters/);
  await expect(page.locator("[data-tabpanel]:visible")).toHaveCount(1);
  await expect(page.locator("#panel-meters")).toBeVisible();
  await page.reload();
  await expect(metersTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#panel-overview")).toBeHidden();

  // A meter caption never repeats its title; the decorative unit tile is
  // still readable as text.
  for (const row of await page.locator(".meter-row").all()) {
    const title = (await row.locator("strong").first().textContent())!.trim();
    const caption = (await row
      .locator(".item-body > span")
      .first()
      .textContent())!.trim();
    expect(caption.split(" · ")[0]).not.toBe(title.replace(/ \(.*\)$/, ""));
    await expect(row.locator(".item-body .sr-only")).toContainText(/\(.+\)/);
  }

  // Editors open in place: no open editor covers another visible control.
  const covered = () =>
    page.evaluate(() => {
      const editor = document.querySelector("[data-editor]:not([hidden])");
      if (!editor) return ["no editor open"];
      return [...document.querySelectorAll("main a, main button, main input")]
        .filter((el) => !editor.contains(el))
        .filter((el) => {
          const box = el.getBoundingClientRect();
          if (!box.height || box.bottom < 0 || box.top > innerHeight)
            return false;
          const hit = document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2
          );
          return !!hit && editor.contains(hit);
        })
        .map((el) => el.textContent!.trim());
    });
  await page.locator('[data-editor-open="meter"]').click();
  await expect(page.locator("#editor-meter")).toBeVisible();
  await expect(page.locator("#editor-meter select#type")).toBeFocused();
  expect(await covered()).toEqual([]);
  // Opening a second editor closes the first.
  const rowEdit = page.locator("[data-meter-actions] [data-editor-open]");
  if ((await rowEdit.count()) > 0) {
    await rowEdit.first().click();
    await expect(page.locator("#editor-meter")).toBeHidden();
    expect(await covered()).toEqual([]);
    // Escape closes it and returns focus to the control that opened it.
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-editor]:visible")).toHaveCount(0);
    await expect(rowEdit.first()).toBeFocused();
  }

  // A value the server rejects stays in the field, marked, with the error
  // inside the editor (the submit is refused, so nothing is saved).
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.locator('[data-editor-open="basic"]').click();
  await expect(page.locator("#occupantName")).toBeFocused();
  expect(await covered()).toEqual([]);
  await page.locator("#billingEmail").fill("resident@x");
  await page.locator("#basic-info-form button[type=submit]").click();
  await expect(page.locator("#editor-basic .notice-danger")).toBeVisible();
  await expect(page.locator("#billingEmail")).toHaveValue("resident@x");
  await expect(page.locator("#billingEmail")).toHaveAttribute(
    "aria-invalid",
    "true"
  );
  // Cancel puts the saved value back and closes without asking.
  await page.locator("#editor-basic [data-editor-cancel]").click();
  await expect(page.locator("#editor-basic")).toBeHidden();
  await expect(page.locator('[data-editor-open="basic"]')).toBeFocused();
  await page.locator('[data-editor-open="basic"]').click();
  await expect(page.locator("#billingEmail")).not.toHaveValue("resident@x");
  await page.keyboard.press("Escape");

  // Audit entries are sentences, never raw codes.
  await page.getByRole("tab", { name: "History" }).click();
  const actions = await page.locator(".audit-action").allTextContents();
  for (const action of actions) expect(action).not.toMatch(/[A-Z]+_[A-Z]+/);
  if (actions.length > 6)
    await expect(page.locator(".audit-more summary")).toContainText(
      `(${actions.length - 6})`
    );

  // Keyboard: one tab stop, arrows move and select, End wraps to the last.
  await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.getByRole("tab", { name: "Overview" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Account balance" })
  ).toBeFocused();
  await expect(
    page.getByRole("tab", { name: "Account balance" })
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Overview" })).toBeFocused();
  await page.keyboard.press("ArrowLeft"); // wraps to the last tab
  await expect(page.getByRole("tab", { name: "History" })).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "History" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute(
    "aria-selected",
    "true"
  );

  // A key that only exists on Object.prototype opens nothing and hides
  // nothing.
  await page.goto(`${href}?lang=en&edit=toString`);
  await expect(page.locator("#panel-overview")).toBeVisible();
  await expect(page.locator("[data-editor]:visible")).toHaveCount(0);

  // Ledger text in Latvian, on a dwelling that has ledger entries (the
  // ledger's own dwelling links only list those).
  await page.goto(`${base}/payments/ledger?lang=en`);
  const ledgerDwelling = await page
    .locator('a[href*="/payments/ledger?dwelling="]')
    .first()
    .getAttribute("href")
    .then((link) => new URL(link!, page.url()).searchParams.get("dwelling")!);
  await page.goto(
    `${base}/dwellings/${ledgerDwelling}?lang=lv&tab=account-balance`
  );
  const ledgerTexts = await page
    .locator(".ledger-description")
    .allTextContents();
  expect(ledgerTexts.length).toBeGreaterThan(0);
  for (const text of ledgerTexts)
    expect(text.trim()).not.toMatch(
      /^(Current charges|Late fee|Bank payment|Cash payment|Reversal of|Manual)/
    );

  // Without the script every tab link is its own keyboard stop.
  const plain = await page
    .context()
    .browser()!
    .newContext({
      javaScriptEnabled: false,
      storageState: await page.context().storageState(),
    });
  const noScript = await plain.newPage();
  await noScript.goto(`http://localhost:4321${href}?lang=en`);
  await expect(noScript.locator('[role="tab"][tabindex="-1"]')).toHaveCount(0);
  await expect(noScript.locator("[data-delivery-save]")).toBeEnabled();
  await plain.close();

  // Latvian: the portal panel's new name.
  await page.goto(`${href}?lang=lv`);
  await expect(page.locator("#portal-access-title")).toHaveText(
    "Portāla piekļuve"
  );

  for (const locale of ["en", "lv", "ru"]) {
    for (const tab of ["overview", "account-balance", "meters"]) {
      await page.goto(`${href}?lang=${locale}&tab=${tab}`);
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (value) => (document.documentElement.dataset.theme = value),
          theme
        );
        for (const width of [1440, 1024, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          await expect
            .poll(() =>
              page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
              )
            )
            .toBe(true);
        }
      }
    }
  }

  await page.goto(detail);
  for (const [theme, width, file] of [
    ["light", 1440, "dwelling-light.png"],
    ["dark", 1440, "dwelling-dark.png"],
    ["dark", 390, "dwelling-mobile.png"],
  ] as const) {
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme
    );
    await page.screenshot({
      path: testInfo.outputPath(file),
      fullPage: true,
      animations: "disabled",
    });
  }
});
