import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createDb } from "../../src/db/client";
import { createSupabaseAdminClient } from "../../src/lib/supabase/admin";

// Admin forgot-password flow against local Supabase + Mailpit. Uses its own
// disposable admin (random email/id), removed afterwards -- never touches the
// demo admins' passwords. Needs DATABASE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY.
test.setTimeout(120_000);

const MAILPIT = "http://127.0.0.1:54324/api/v1";
const dbUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

async function messagesTo(email: string) {
  const res = await fetch(
    `${MAILPIT}/search?query=${encodeURIComponent(`to:${email}`)}`
  );
  const body = (await res.json()) as {
    messages: { ID: string; Subject: string }[];
  };
  return body.messages;
}

async function waitForMail(email: string, subject: RegExp) {
  for (let i = 0; i < 30; i++) {
    const hit = (await messagesTo(email)).find((m) => subject.test(m.Subject));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no "${subject}" mail for ${email}`);
}

test("admin can reset a forgotten password", async ({ page }) => {
  if (!dbUrl || !supabaseUrl || !secretKey) {
    throw new Error("DATABASE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY required");
  }
  const id = randomUUID();
  const email = `reset-${id.slice(0, 8)}@example.com`;
  const residentId = randomUUID();
  const residentEmail = `reset-res-${residentId.slice(0, 8)}@example.com`;
  const oldPassword = "oldpass123";
  const newPassword = "newpass456";
  const db = await createDb(dbUrl);
  const admin = createSupabaseAdminClient(supabaseUrl, secretKey);

  try {
    for (const [uid, mail, role] of [
      [id, email, "ADMIN"],
      [residentId, residentEmail, "RESIDENT"],
    ] as const) {
      const created = await admin.auth.admin.createUser({
        id: uid,
        email: mail,
        password: oldPassword,
        email_confirm: true,
      });
      if (created.error) throw created.error;
      await db.$client.query(
        "insert into app_users (id, role, email_snapshot) values ($1, $2, $3)",
        [uid, role, mail]
      );
    }

    const requestReset = async (mail: string) => {
      await page.goto("/forgot-password?lang=en");
      await page.locator("#email").fill(mail);
      await page.getByRole("button", { name: "Send reset link" }).click();
      await expect(page.locator("[role=status]")).toContainText("reset link");
    };

    // Residents and unknown addresses: same neutral page, no email.
    await requestReset(residentEmail);
    await requestReset(`nobody-${id.slice(0, 8)}@example.com`);
    await new Promise((r) => setTimeout(r, 2000));
    expect(await messagesTo(residentEmail)).toHaveLength(0);

    // Supabase's recovery endpoint is public: a link that exists for a
    // resident must still not lead to a password form.
    const residentLink = await admin.auth.admin.generateLink({
      type: "recovery",
      email: residentEmail,
    });
    await page.goto(
      `/auth/confirm?type=recovery&token_hash=${residentLink.data.properties?.hashed_token}`
    );
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/forgot-password\?error=1/);

    // The admin gets a link.
    await requestReset(email);
    const mail = await waitForMail(email, /Reset your password/);
    const detail = (await (
      await fetch(`${MAILPIT}/message/${mail.ID}`)
    ).json()) as { HTML: string };
    const link = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(detail.HTML)?.[1];
    expect(link).toContain("type=recovery");
    const url = link!.replaceAll("&amp;", "&");

    // Direct visit to the reset form without a verified link is refused.
    await page.goto("/reset-password");
    await expect(page).toHaveURL(/\/forgot-password/);

    // Opening the link only shows a button (scanners must not burn it).
    await page.goto(url);
    await expect(page.locator("h1")).toHaveText("Reset your password");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/reset-password/);

    const submit = async (pw: string, confirm: string) => {
      await page.locator("#new-password").fill(pw);
      await page.locator("#confirm-password").fill(confirm);
      // Bypass the browser's own minlength check to exercise the server rule.
      await page
        .locator("form")
        .evaluate((f) => ((f as HTMLFormElement).noValidate = true));
      await page.getByRole("button", { name: "Change password" }).click();
    };
    await submit("short", "short");
    await expect(page.locator("[role=alert]")).toContainText("at least 8");
    await submit("abcdefgh", "abcdefgX");
    await expect(page.locator("[role=alert]")).toContainText("do not match");

    await submit(newPassword, newPassword);
    await expect(page).toHaveURL(/\/login\?reset=1/);
    await expect(page.locator("[role=status]")).toContainText(
      "Password updated"
    );

    // The notification mail was sent.
    await waitForMail(email, /password has been changed/i);

    // New password works, old one does not.
    await page.locator("#admin-email").fill(email);
    await page.locator("#admin-password").fill(oldPassword);
    await page.locator("#admin-login-form button").click();
    await expect(page).toHaveURL(/\/login\?error=1/);
    await page.locator("#admin-email").fill(email);
    await page.locator("#admin-password").fill(newPassword);
    await page.locator("#admin-login-form button").click();
    await page.waitForURL(/\/admin/);

    // An ordinary password session cannot use the reset form or endpoint,
    // even with a forged cookie.
    await page.goto("/reset-password");
    await expect(page).toHaveURL(/\/forgot-password/);
    await page
      .context()
      .addCookies([
        { name: "pw_reset", value: "1", url: "http://localhost:4321" },
      ]);
    const forged = await page.request.post("/api/v1/auth/set-password", {
      form: { password: "hackedpass1", confirm: "hackedpass1" },
      headers: { origin: "http://localhost:4321" },
      maxRedirects: 0,
    });
    expect(forged.status()).toBe(303);
    expect(forged.headers().location).toContain("/forgot-password?error=1");

    // A used link no longer works.
    await page.context().clearCookies();
    await page.goto(url);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/forgot-password\?error=1/);
  } finally {
    for (const uid of [id, residentId]) {
      await db.$client.query("delete from app_users where id = $1", [uid]);
      await admin.auth.admin.deleteUser(uid);
    }
    await db.$client.end();
  }
});
