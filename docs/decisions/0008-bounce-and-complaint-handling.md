# 0008 - Bounce and complaint handling

**Status:** Accepted
**Date:** 2026-09-30
**Phase:** J (Payments) / Operations

## Context

Invoices go out by email through Amazon SES. A bad address bounces every month,
because the next auto send tries it again. A recipient can also mark an invoice
as spam. SES watches bounce and complaint rates. A high rate can suspend the
sending account, and then no organization can send invoices.

## Decision

- SES publishes bounce and complaint events to an SNS topic. SNS calls
  `POST /api/v1/internal/ses-events`.
- The endpoint accepts a request only when all three checks pass:
  - the URL has the shared secret in `?key=` (`SES_EVENTS_SECRET`), compared in
    constant time;
  - the body comes from the one topic in `SES_SNS_TOPIC_ARN`;
  - the body carries a valid SNS signature (`src/lib/email/sns-signature.ts`).
    The app builds the string to sign as AWS documents, fetches the signing
    certificate only from an `sns.<region>.amazonaws.com` address, and checks the
    RSA signature with WebCrypto (signature versions 1 and 2).
  If either setting is missing, the endpoint refuses every request.
- Only two events matter: a **permanent** bounce and a **complaint**. A
  temporary bounce and every other event are ignored, because the next send can
  still work.
- SES reports an address, not an organization. The app puts the address on the
  suppressed list of every organization that has emailed an invoice to it.
  An address that no organization used is ignored.
- Table `suppressed_emails`: one row per organization and lowercase address,
  with the reason and a short detail. Each new row writes an audit event.
- `sendInvoice` and resend refuse a suppressed address before any provider call.
  The message says to change the billing email or remove the address from the
  list.
- Auto send skips a suppressed address and does not count it as a failure. A
  daily alert for the same address would be noise. The address is on the list
  that an admin can open.
- An admin lists and removes entries on **Settings > Suppressed email
  addresses**. Removing an entry writes an audit event.

## Limits

- The secret is in the URL, and Cloudflare can log a URL. A leaked secret alone
  cannot forge an event, because the signature check also has to pass. Treat the
  secret as a second layer.
- A replayed old message is valid. It can only add an address that SES already
  reported, so the app does not check the message age.
- An address is suppressed only for organizations that emailed it before the
  event. A new organization that adds the same address later still tries it
  once.
- A complaint is not proof of abuse. An admin can remove an entry when the
  resident asks to get invoices again.

## Consequences

- One more public endpoint, guarded by a secret.
- AWS needs an SNS topic, a subscription, and notification settings on the SES
  identity. No configuration set is needed. The steps are in
  [monitoring.md](../deployment/monitoring.md).
