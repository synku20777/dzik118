// POST /api/v1/internal/ses-events (ADR 0008). Amazon SNS calls this URL with
// the bounce and complaint events that SES publishes. A permanent bounce or a
// complaint puts the address on the suppressed list, and invoices stop going
// to it. There is no admin session here, so the URL carries a shared secret
// (`?key=`) and the body must come from the one configured topic.
//
// Checks, in order: the secret in the URL, the topic ARN, and the SNS message
// signature (src/lib/email/sns-signature.ts). The signature is the one that
// cannot be forged by someone who only learns the URL.
import type { APIRoute } from "astro";
import { SES_EVENTS_SECRET, SES_SNS_TOPIC_ARN } from "astro:env/server";
import { describeError } from "../../../../domain/errors";
import { suppressEmail } from "../../../../domain/email/suppression";
import { withRequestDb } from "../../../../lib/db-request";
import { parseSesMessage } from "../../../../lib/email/ses-events";
import { secretsMatch } from "../../../../lib/http/secrets";
import {
  verifySnsSignature,
  type SnsMessage,
} from "../../../../lib/email/sns-signature";

const MAX_BODY_BYTES = 256 * 1024;
// SNS confirms a subscription by a GET to a URL on its own domain.
const SNS_SUBSCRIBE_URL = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//;

export const POST: APIRoute = async ({ request, url }) => {
  if (
    !SES_EVENTS_SECRET ||
    !SES_SNS_TOPIC_ARN ||
    !(await secretsMatch(url.searchParams.get("key") ?? "", SES_EVENTS_SECRET))
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  // Refuse a large body before it is read into memory, then check the real
  // size in bytes of what was read.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }
  let body: SnsMessage;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (body.TopicArn !== SES_SNS_TOPIC_ARN) {
    return new Response("Forbidden", { status: 403 });
  }
  // The secret can leak (a URL appears in logs), so it is not enough alone.
  // The message must also carry a valid SNS signature.
  if (!(await verifySnsSignature(body))) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    if (body.Type === "SubscriptionConfirmation") {
      if (
        typeof body.SubscribeURL === "string" &&
        SNS_SUBSCRIBE_URL.test(body.SubscribeURL)
      ) {
        await fetch(body.SubscribeURL);
      }
      return new Response("OK", { status: 200 });
    }

    if (body.Type === "Notification") {
      const event = parseSesMessage(body.Message);
      if (event) {
        for (const email of event.emails) {
          await withRequestDb((db) =>
            suppressEmail(db, {
              email,
              reason: event.reason,
              detail: event.detail,
            })
          );
        }
      }
    }
    return new Response("OK", { status: 200 });
  } catch (error) {
    // A 500 makes SNS retry the message later.
    console.error("ses-events failed", describeError(error));
    return new Response("Error", { status: 500 });
  }
};
