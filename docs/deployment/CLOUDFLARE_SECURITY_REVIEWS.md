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

## October 6, 2026

Analytics window: October 5 11:18:43.167 UTC to October 6 11:18:43.167 UTC.

| Worker | Reported requests | Reported execution errors |
| --- | ---: | ---: |
| property-billing | 416 | 0 |
| namkopa-website | 364 | 0 |

- App statuses: 414 `success`, 2 `clientDisconnected`; website: 364 `success`.
  No reported execution-error increase. These metrics do not count every
  application HTTP 4xx/5xx response.
- No detected drift: owner MFA and account-wide 2FA enforcement remain on;
  HTTPS required, minimum TLS 1.2, TLS 1.3 on, DNSSEC active, Bot Fight Mode off.
  Both new rules retain their IDs, expressions, enabled block actions, and
  recorded rate limits. Worker hostname/preview settings remain as intended.
- App login, marketing EN, and canonical `/api/health` return HTTPS 200;
  health reports `ok`. Both HTTP probes return 301 with path/query preserved.
  A reviewer probe mistakenly used `/api/v1/health` and received 404 before
  checking the canonical route; this is synthetic review traffic, not a
  health-check regression.
- DS, MX, SPF TXT, and app AAAA resolve with status 0 and `AD: true`.
  DS digest, mail priorities/targets, and SPF match the baseline.
- Security Events returned 7 managed blocks, all on the marketing domain;
  neither new custom/rate-limit rule returned events. Five matched the enabled
  Free Managed Ruleset's React RCE rule `2b5d06e34a814a889bee9a0699702280`
  (three `/en/`, two `/`). Two root-path events matched another managed rule
  `8fcb869e55804a6d94f482a0a25aa53a`; its description was not available in
  the Free Managed Ruleset response. No evidence of legitimate traffic blocked
  by the new rules was observed; payloads and client identities were not read.
- All returned events have sample interval 1; the 500-event limit was not
  reached. Worker results use scriptName/status aggregates below the 100-group
  limit. Sampling and ingestion-delay limitations remain; this is not complete
  or continuous traffic coverage. The window starts 24 minutes 42.334 seconds
  after the previous review window ended.
- The first read-only analytics query used an unsupported method field; it
  was corrected to the documented event fields and the retry succeeded.
  No IPs, query strings, or credentials requested. Known owner follow-ups
  were not re-alerted; no infrastructure changes or production jobs performed.

Outcome: healthy checks, unchanged protections, no actionable new issue.
No user notification required.

## October 7, 2026

Analytics window: October 6 13:24:18.421 UTC to October 7 13:24:18.421 UTC.

| Worker | Reported requests | Reported execution errors |
| --- | ---: | ---: |
| property-billing | 52 | 0 |
| namkopa-website | 52 | 0 |

- Both Workers' returned scriptName/status aggregates are `success`; no
  reported execution-error increase. Execution errors are not a count of
  application HTTP 4xx/5xx responses.
- No detected drift: owner MFA and account 2FA enforcement remain on;
  HTTPS required, minimum TLS 1.2, TLS 1.3 on, DNSSEC active, Bot Fight Mode off.
  Custom scheduler and authentication-burst rules retain their recorded IDs,
  expressions, enabled block actions, and rate-limit settings. Website Workers
  hostname and both preview settings remain disabled; app legacy hostname
  remains enabled as intended.
- App login, marketing EN, and `/api/health` return HTTPS 200; health is `ok`.
  Both HTTP probes return 301 to HTTPS with paths/query strings preserved.
- DS, MX, SPF TXT, and app AAAA resolve with status 0 and `AD: true`.
  DS digest, Cloudflare mail priorities/targets, and SPF match the baseline.
- Security Events returned 3 managed blocks, all at the marketing root:
  two React RCE rule events at 07:54:29–30 UTC and one WordPress RCE rule event
  at October 6 15:46:40 UTC. Both matching rules remain enabled in Free Managed
  Ruleset version 74. Actual events confirm enforcement, beyond availability
  in the ruleset list. Neither new custom/rate-limit rule returned events;
  no evidence of their blocking legitimate traffic was observed.
- All events have sample interval 1; the 500-event limit was not reached.
  Worker aggregates remained below the 100-group limit. Sampling and ingestion
  delay still apply; these results do not establish complete traffic coverage.
  The 24-hour window starts 2 hours 5 minutes 35.254 seconds after the previous
  review window ended, so the daily snapshots are not continuous monitoring.
- No client IPs, query strings, credentials, or payloads read. Known private
  enrollment/smoke-test follow-ups were not re-alerted. No changes, deployments,
  production Cron jobs, login submissions, emails, or invoices performed.

Outcome: healthy checks, unchanged protections, no actionable new issue.
No user notification required.

## October 11, 2026 — review period closed

- The queued heartbeat timestamp, October 10 22:31:38.411 UTC, falls on
  October 11 in Europe/Paris, beyond the requested October 10 cutoff.
  No new Cloudflare analytics, HTTPS, health, or DNS checks were run.
- Deleted `namkopa-security-rollout-review`; the app confirmed deletion.
  No Cloudflare protections, credentials, code, or production data changed.
- The latest review recorded here is October 7. No review evidence is recorded
  for October 8–10; current health and traffic for those dates remain unverified.
  The earlier healthy snapshots do not establish continuous coverage.

Outcome: temporary automation stopped at expiry; no new health claim or
user action requested.
