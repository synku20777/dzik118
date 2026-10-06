# Cloudflare rollout reviews

Read-only daily checks through October 10, 2026. No configuration changes,
deployments, production Cron invocations, login submissions, emails, or invoices.

## October 4, 2026

Analytics window: October 3 10:00:53.888 UTC to October 4 10:00:53.888 UTC.

| Worker | Reported requests | Reported execution errors |
| --- | ---: | ---: |
| property-billing | 90 | 0 |
| namkopa-website | 266 | 0 |

- No detected security drift: owner MFA enabled; account-wide 2FA enforced;
  HTTPS required; minimum TLS 1.2; TLS 1.3 on; Bot Fight Mode off. Both new
  rules retain their recorded expressions, actions, enabled states, and limits.
  Website Workers hostname and both Workers' preview URLs remain disabled;
  app legacy hostname remains enabled as intended.
- App login, marketing EN, and database health return HTTPS 200; health is `ok`.
  Both HTTP probes redirect 301 to HTTPS with path/query preserved.
- DNSSEC active; resolver DS, MX, SPF TXT, and app AAAA checks return status 0
  and `AD: true`. DS digest, mail priorities/targets, and SPF match the baseline.
- Security Events returned 47 events, below the 500-event query limit:
  3 are the documented October 3 synthetic tests (2 auth-rate blocks and 1
  scheduler block). No additional events from either new rule were returned.
- The remaining 44 are managed blocks: 3 WordPress file-inclusion probes and
  41 POSTs to the marketing root at 02:03:50–51 UTC, matching the enabled
  **React - RCE - CVE:CVE-2025-55182** rule. This clustered pattern is consistent
  with automated exploit probing; intent is an inference, not proved by payloads.
  No evidence of legitimate traffic blocked by the new rules was observed.
- All returned events have sample interval 1; no pagination limit was reached.
  Security Events and Worker metrics remain sampled/subject to ingestion delay;
  these results do not establish complete traffic coverage. Worker execution
  errors are not a count of all application HTTP 4xx/5xx responses.
- Known owner enrollment/smoke-test follow-ups from the rollout were not
  re-alerted; private authenticator-factor details were not inspected today.

Outcome: healthy checks, unchanged protections, no actionable new issue.
No user notification required.

## October 5, 2026

Analytics window: October 4 10:54:00.833 UTC to October 5 10:54:00.833 UTC.

| Worker | Reported requests | Reported execution errors |
| --- | ---: | ---: |
| property-billing | 35 | 0 |
| namkopa-website | 156 | 0 |

- No detected security drift: owner MFA and account 2FA enforcement remain on;
  HTTPS required, minimum TLS 1.2, TLS 1.3 on, DNSSEC active, Bot Fight Mode off.
  Both new rules retain their recorded IDs, expressions, enabled states,
  block actions, and limits. Worker hostname/preview settings remain as recorded.
- App login, marketing EN, and app health return HTTPS 200; health is `ok`.
  HTTP redirects remain 301 with paths/query strings preserved.
- DS, MX, SPF TXT, and app AAAA resolve with status 0 and `AD: true`.
  DS digest, mail priorities/targets, and SPF match the baseline.
- Security Events returned 2 managed blocks and no events for either new rule:
  one marketing-root POST at 08:49:16 UTC matching **Wordpress - Remote Code
  Execution - CVE:CVE-2026-63030**, and one root GET at 00:01:45 UTC matching
  **Block AI training crawlers - BOBA-199**. Descriptions came from Security
  Events; the WordPress rule also remains enabled in the Free Managed Ruleset.
  No evidence of a new-rule false positive or execution-error increase observed.
- Both events have sample interval 1; the 500-event limit was not reached.
  Sampling/ingestion-delay and execution-error versus HTTP-error limitations
  still apply. This is a 24-hour snapshot, not continuous coverage: its start
  is 53 minutes 6.945 seconds after the previous review window ended.
- Known private enrollment and authenticated smoke-test follow-ups were not
  re-alerted. No private factor details, IPs, query strings, or credentials read.

Outcome: healthy checks, unchanged protections, no actionable new issue.
No user notification required.
