// Shared EmailService construction for Astro Actions (see _db.ts for why
// this reads astro:env/server here rather than inside the domain
// functions that use it). Selects SES whenever real AWS credentials are
// configured (always true in a real deployment); falls back to the local
// SMTP-to-Mailpit adapter otherwise, since local dev's .dev.vars never
// sets a real AWS key -- mirrors ADMIN_REQUIRE_AAL2's "safe local default,
// must be the real thing in production" pattern.
import {
  AWS_SES_ACCESS_KEY_ID,
  AWS_SES_REGION,
  AWS_SES_SECRET_ACCESS_KEY,
  EMAIL_FROM,
} from "astro:env/server";
import { createSesEmailService } from "../lib/email/ses";
import { createSmtpEmailService } from "../lib/email/smtp";
import type { EmailService } from "../lib/email/service";

export function getEmailService(): EmailService {
  if (AWS_SES_ACCESS_KEY_ID && AWS_SES_SECRET_ACCESS_KEY) {
    return createSesEmailService({
      accessKeyId: AWS_SES_ACCESS_KEY_ID,
      secretAccessKey: AWS_SES_SECRET_ACCESS_KEY,
      region: AWS_SES_REGION,
      fromAddress: EMAIL_FROM,
    });
  }
  return createSmtpEmailService({
    host: "127.0.0.1",
    port: 54325,
    fromAddress: EMAIL_FROM,
  });
}
