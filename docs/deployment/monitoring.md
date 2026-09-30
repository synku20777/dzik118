# Monitoring and alerts

Two alerts exist.

## Scheduled job failure

The app emails the address in `ALERT_EMAIL` when a scheduled job fails. It also
sends the email when auto send could not deliver one or more invoices. The alert
names the organization and hides email addresses and long numbers.

Set the secret in Cloudflare:

```bash
wrangler secret put ALERT_EMAIL
```

Add `ALERT_EMAIL` to GitHub Actions secrets only if the deploy workflow
passes secrets. The deploy workflow does not pass `EMAIL_FROM` or optional
secrets. Follow that pattern. Do not add `ALERT_EMAIL` to the deploy workflow
environment list. Do not add `ALERT_EMAIL` to `.github/workflows/ci.yml`
because it is optional.

The sender must be a verified SES address.

## Site down

Create a free monitor (for example UptimeRobot, Better Stack, or
Healthchecks.io) that requests `https://<your domain>/api/health` every
5 minutes and expects HTTP 200 with the body `{"status":"ok"}`.

A 503 means the database does not answer.

## Bounces and complaints

A bad address bounces again every month. A complaint can hurt the SES sender
reputation. The app handles both: it puts the address on a suppressed list and
stops sending to it. See [ADR 0008](../decisions/0008-bounce-and-complaint-handling.md).
An admin sees the list in **Settings > Suppressed email addresses**.

To turn it on:

1. In the AWS console, open **SNS** and create a **Standard** topic, for
   example `ses-invoice-events`. Create it in the same AWS Region as the SES
   identity. Copy its ARN.
2. Make a long random secret. Set it and the ARN in the Worker:

   ```bash
   wrangler secret put SES_EVENTS_SECRET
   wrangler secret put SES_SNS_TOPIC_ARN
   ```

   The endpoint refuses every request until both exist.

3. Deploy the app.
4. In the topic, create a **subscription**:
   - Protocol: **HTTPS**.
   - Endpoint: `https://<your domain>/api/v1/internal/ses-events?key=<SES_EVENTS_SECRET>`.

   The app confirms the subscription by itself. The subscription status
   changes to **Confirmed** in a few seconds.
5. In the AWS console, open **SES > Verified identities**, and open the
   identity that sends the invoices. On the **Notifications** tab, choose
   **Edit**. Set both **Bounce feedback** and **Complaint feedback** to the
   SNS topic. Leave **Include original email headers** off.
6. Check it. Send one invoice to a test dwelling whose billing email is
   `bounce@simulator.amazonses.com`. SES reports a permanent bounce, and the
   address appears on the suppressed list. The address can only be suppressed
   after an organization has emailed it once.

Limits:

- The app checks three things: the secret in the URL, the topic ARN, and the
  SNS message signature. A leaked URL alone cannot forge an event. Keep the URL
  private anyway.
- Only a permanent bounce and a complaint are used. The app ignores a
  temporary bounce.
- Auto send skips a suppressed address and does not send an alert for it. Open
  the suppressed list from time to time.

## Audit trail

Every audit row stores the request ID, and the IP as a hash. The response also
has an `X-Request-Id` header. A person who reports a problem can give that ID.
Set `AUDIT_HASH_SECRET` to a long random value to store the IP hash. Without it
the hash column stays empty. The app never stores a plain IP.

## What is not covered

A single failing request appears only in the Cloudflare Workers logs. If the
scheduled job does not run at all, no email is sent. Check the Cron Trigger past
events in the Cloudflare dashboard.

## Cloudflare note

Cloudflare Health Checks email needs the Pro plan, and Cloudflare has no
built-in alert for a failed Cron Trigger, so this guide does not use them.
