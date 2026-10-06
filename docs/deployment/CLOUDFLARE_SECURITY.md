# Namkopa Cloudflare protection

Applied October 3, 2026 on the Free Website plan. This changes infrastructure
settings and deployment access; app authentication, database/schema, and invoice
behavior are unchanged. App MFA remains a separate follow-up.

## Resources and recorded state

- Account: `81a1d4cff6d57963d98d8e847bb6c0b3`.
- Zone: `2a3bd97bc827676d093647ecee871be6` (`namkopa.com`).
- App Worker: `property-billing`, domain `app.namkopa.com`.
- Website Worker: `namkopa-website`, domain `namkopa.com`.
- Before: [baseline](cloudflare-security-baseline-2026-10-03.json).
- After: [applied state](cloudflare-security-applied-2026-10-03.json).

Both snapshots contain public DNS and permission metadata, never credentials.

| Protection | Verified state |
| --- | --- |
| Cloudflare owner MFA | Enrolled by owner; member API reports MFA enabled |
| Account member policy | `enforce_twofactor: true` |
| Always Use HTTPS | `on` |
| Minimum TLS / TLS 1.3 | `1.2` / `on` |
| DNSSEC | `active`; DS published at Namecheap and chain validated |
| Free Managed Ruleset | Dashboard says **Always active**; actual managed blocks observed |
| Website Workers hostname / previews | Disabled live; both explicitly disabled in website `wrangler.jsonc` |
| App legacy Workers hostname | Preserved as a path/query-preserving redirect; previews disabled |
| Bot Fight Mode | Left off |

The security key is active. Authenticator-app backup enrollment is still pending
the owner's private device interaction; the Mobile App Authentication card showed
only **Add** at the final factor check. Recovery codes were not read or recorded.
Namecheap's dashboard still showed registrar 2FA disabled;
enabling it is a separate owner credential step.

## Custom edge rules

### External scheduled jobs

Ruleset `e9a53a8d8b8841899ec55d1e413061f0`, phase
`http_request_firewall_custom`; rule `fd8fdbf42a8c4651b0f5b677c024bace`.
Action **block**, enabled, expression:

```text
(http.host eq "app.namkopa.com" and http.request.uri.path in {"/api/v1/internal/scheduled-jobs" "/api/v1/internal/scheduled-jobs/"})
```

Do not block all `/api/v1/internal/*`. `/api/v1/internal/ses-events` is the public
Amazon SNS callback for SES bounces/complaints and must remain reachable. It
retains its app secret, topic ARN, and signature checks.

The Cron wrapper in `scripts/postbuild-wire-scheduled.mjs` calls
`astroWorker.fetch` directly with `https://internal/api/v1/internal/scheduled-jobs`
and the internal secret. This is a direct handler call, not a network request
through Cloudflare's edge. The Worker still checks the secret.

### Authentication bursts

Ruleset `ade2c44e2a04459391c73c2d13128ee3`, phase `http_ratelimit`;
rule `d654297f500b4c5a90334df712603381`. Action **block**, enabled:

```text
(http.request.uri.path in {"/api/v1/auth/admin-login" "/api/v1/auth/request-link" "/api/v1/auth/request-reset"})
```

10 requests per 10 seconds, 10-second mitigation, characteristics `ip.src` and
`cf.colo.id`. The Free plan permits path matching, but not host/method matching,
so this exact-path rule applies across the zone. Marketing has no endpoints at
these paths. It does not match resident or invoice pages.

Counters are distributed by data center and enforcement can lag slightly; this
is not an exact global cap. Existing Worker auth and invoice-token limits remain.
See [Cloudflare's plan limits](https://developers.cloudflare.com/waf/rate-limiting-rules/).

## DNSSEC and mail

Namecheap's Advanced DNS DNSSEC section now contains the generated DS:

```text
2371 13 2 94DBE6F8297B0B9508DABB5598EB45CF77E58E292B203BD52B51FED01D837680
```

Algorithm ECDSA/SHA-256 (13), digest SHA-256 (2). Google DNS returned status 0
and authenticated-data `AD: true` for the DS, MX, SPF TXT, and app AAAA records.
DNS records compare unchanged against the pre-change baseline. Cloudflare
Email Routing MX priorities remain 14/75/94, SPF and DKIM preserved.

## Deployment credentials

The original user and account API-token inventories were empty. Local Wrangler
used a broader OAuth session. The owner created `namkopa-deploy`, account token
ID `381591913bd01b5bc9b501ee69f0a128`, after reviewing its policy:

- **Individual Workers Editor** for existing `property-billing` and
  `namkopa-website` only.
- **Workers Routes Write** for `namkopa.com` only, for the domains declared in
  the Wrangler configurations.
- Expires **January 2, 2027**. Rotate before expiry.
- No DNS, WAF, billing, account administration, or direct database permissions.

DNS/security administration uses the MFA-protected dashboard. No additional
persistent administration token was created. If API administration is needed
later, use a separate zone-scoped token for only the required settings/rules.
Worker bindings do not require permission to manage their underlying products.
See [Workers authorization](https://developers.cloudflare.com/workers/authorization/)
and [resource scopes](https://developers.cloudflare.com/workers/authorization/workers/).

The owner entered the token at the helper's masked prompt. It is saved at
`%LOCALAPPDATA%/Namkopa/Cloudflare/deploy-token.xml` as a Windows DPAPI-encrypted
SecureString, outside Git. It is decryptable by the same Windows user/machine;
this does not protect against compromise of that user's session. The helper
provides the token only to its deployment subprocess, then restores the prior
process environment.

Read-only checks verified active token status, both Workers' deployment histories,
and zone routes. Wrangler deployment-history reads succeeded with the token.
Only after verification, `wrangler logout` revoked the local broad OAuth login.
No production deployment was performed to test write access. The policy was
reviewed in the dashboard; the next deployment should follow the normal runbook.

From the app checkout in PowerShell 7:

```powershell
# Private initial setup / rotation; read-only checks before encrypted save:
pwsh -NoProfile -File scripts/cloudflare-deploy.ps1 -Action Setup
# Verify access without deploying:
pwsh -NoProfile -File scripts/cloudflare-deploy.ps1 -Action Verify
# Future deployments, after the normal project checks and backups:
pwsh -NoProfile -File scripts/cloudflare-deploy.ps1 -Action Deploy -Project App
pwsh -NoProfile -File scripts/cloudflare-deploy.ps1 -Action Deploy -Project Website
```

App deploy retains Worker-secret preflight and existing build/migration gates.
Website deploy uses the sibling `namkopa-website` checkout, including any pending
changes there. Plain `npm run deploy` in a different shell does not load this
encrypted credential automatically. Do not log in with broad Wrangler OAuth as
a workaround; use the helper or your secret manager to supply the scoped token.

The GitHub workflow already reads `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` from secrets. The `production` environment API lookup
returned 404, so hosted CI secrets were not inspected, updated, or assumed absent.
If configuring hosted deployment, the owner must store this scoped token there
privately; never commit it or print it in Actions logs.

## Validation and limitations

- HTTP requests for both sites return 301 to HTTPS with paths/queries intact.
- TLS 1.2-only app request passed; HTTPS app health/login and EN/LV/RU marketing
  pages respond successfully. Existing legacy redirects passed the domain check.
- Unauthenticated `/admin` and `/portal` still redirect to `/login`.
  `/forgot-password` renders; reset without a session redirects there.
- Invalid magic link redirects to the existing error page; invalid invoice and
  PDF tokens reach the Worker and return 404, rather than an edge challenge.
- External scheduled-jobs GET returns edge 403 with no app request ID. SES
  callback GET reaches the Worker and returns its expected unsupported-method 404.
- A burst of 18 harmless GETs across the three auth paths, followed by another
  GET, produced edge 429s. No login credentials or emails were submitted. Normal
  requests reach the Worker after the temporary block expires.
- The extracted Cron wrapper passed a stubbed controlled test of target URL,
  POST/secret forwarding, successful completion, and failure propagation.
  No production scheduled jobs or invoices were executed.
- Website production build passed; generated Wrangler config has
  `workers_dev: false` and `preview_urls: false`. No website code was deployed;
  live hostname exposure was already disabled.
- The Windows helper passed controlled checks for encrypted readback, rejected
  credentials not being saved, and environment restoration on deployment failure.
- Actual successful manager login, resident email delivery/redemption, password
  reset, and a valid invoice PDF download still require an owner/test-account
  smoke test. Public reachability and invalid-link behavior do not prove these
  complete authenticated flows.

## Seven-day rollout review

Evidence from subsequent runs is recorded in
[rollout reviews](CLOUDFLARE_SECURITY_REVIEWS.md).

Daily thread automation **Namkopa security rollout review**
(`namkopa-security-rollout-review`) runs at 10:00 for seven reviews through
October 10, 2026. It checks settings/health/DNSSEC and reads Security Events and
Worker metrics. It stays quiet for healthy, unchanged state and alerts only on
an actionable change or unavailable checks. It never changes rules or deploys.

First 24-hour analytics review at 2026-10-03 18:29 UTC: app 171 requests / 0
reported errors; website 889 requests / 0 reported errors. Observed new-rule
blocks at 18:15 UTC were our synthetic tests. Actual older managed-rule blocks
confirm enforcement in addition to the dashboard's **Always active** state.

Connector read-only GraphQL at `/graphql` works. Use `workersInvocationsAdaptive`
with `sum { requests errors }` and `dimensions { status }`, filtered separately
by script name and the 24-hour window. Use `firewallEventsAdaptive` with
`action source ruleId clientRequestHTTPHost clientRequestPath datetime`, ordered
by descending datetime. Do not fetch client IPs, query strings, or credentials.
`firewallEventsAdaptiveGroups` is unavailable for this zone. Events are sampled;
if a limit is reached, paginate or explicitly report partial coverage. Worker
error metrics report execution errors, not every application HTTP 4xx/5xx.

See [Workers metrics](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/)
and [Security Events queries](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-firewall-events/).

## Rollback

For a confirmed false positive, disable only the affected rule by its recorded
ID in Security > Security rules, retain evidence, and retest the reported flow.
Do not bypass all protections. A failed synthetic test is not proof of a false
positive. Keep the SES callback excluded from scheduler blocking.

For DNSSEC rollback, first remove the DS at Namecheap, wait for the actual parent
DS TTL/cache expiry, and verify resolvers no longer see it. Only then disable
Cloudflare signing. Disabling signing while a parent DS remains breaks validation
for web and email. See [DNSSEC](https://developers.cloudflare.com/dns/dnssec/).

HTTPS/TLS settings can be reverted independently if compatibility evidence
requires it. The baseline records prior values; restoring TLS 1.0 or plain HTTP
weakens protection and requires an explicit owner decision. Never turn off
account 2FA enforcement to solve a routine deployment-token problem.
