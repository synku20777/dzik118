# Current Month workbench

The billing queue is the primary work area. Period context and finances sit above it; tariff explanations and adding missing dwellings remain available below it. The visual direction is a precise, warm operations console using the existing Switzer/Fraunces typography, slate palette, and semantic tokens.

Reference: [Ubiquiti's UniFi Network 9.1](https://blog.ui.com/article/releasing-unifi-network-9-1) emphasizes visibility, direct control, and richer actionable tables. This implementation applies those principles to billing rather than copying network-specific widgets. “Better than UniFi” is a design ambition, not a measured comparative claim.

## Changes

- Replaced the oversized workflow cards with compact stage filters, real counts, an explicit active state, and readable wrapping across supported languages.
- Aligned the financial strip with the dashboard: total amount due includes carried balance, credit, and late fees; current charges remain separately labelled. Received and unpaid use the same amount-due baseline.
- Consolidated search, status, stage filters, result counts, and the table into one work area. Added a regular GET submit button for keyboard and JavaScript-free use.
- Kept existing billing generation, preparation, sending, and locking actions as the authority. No domain arithmetic or mutation eligibility rules were replaced.
- Search and status selection submit on Enter or Apply; typing pauses and arrowing through native select options never navigate unexpectedly. Stage links remain immediate shortcuts.
- Added visible selected-row treatment and a contextual bulk toolbar. Native popovers render row actions in the top layer so the table cannot clip them and opening them cannot resize columns. Viewport-aware positioning keeps actions reachable; native Escape and outside clicks dismiss them. The header disclosure retains its existing dismissal handlers.
- Added an accessible name and description to the lock confirmation.
- Drawer refresh now emits a narrow lifecycle event. Workbench listeners are delegated and abort on page swaps; replaced rows regain selection state and mobile column labels. Drawer dismissal restores focus to the replacement control, the row’s next action, or the queue heading when filtering removes the row.
- Healthy billing inputs use one muted completion check, with email readiness kept available to assistive technology; exceptions and paper delivery remain explicit. Invoice identifiers stay on one line.
- Period resources are collapsed initially, with applying/total tariff counts visible in the summary. Blocker rows continue to link to the applicable tariff or dwelling settings.

## Verification

- Unit regressions: 344 tests passing.
- Browser regressions: all 11 affected checks pass (10 shared/dashboard checks plus the final dedicated Current Month check). Production build passes.
- Source lint passing.
- Astro diagnostics retain the six existing `Env.BROWSER` binding errors outside this change.
- The dedicated browser regression compares dashboard/workbench amounts, verifies stage and search filtering, bulk selection and eligibility after fragment replacement, menu dismissal, drawer dismissal, lock confirmation cancellation, empty results, and inspection of the seeded locked prior period.
- Responsive matrix: EN/LV/RU, light/dark, 320/390/768/1024/1440px. It checks page overflow and mobile labels. Actual financial mutations are not submitted by these visual/interaction tests.

## Council review

Round 1: Opus 8/10 (satisfied, no blockers), Sol 8.8/10 (search/focus fixes requested), Gemini Flash 9.8/10 (satisfied, no blockers).

Accepted refinements: explicit search submission; focus restoration after fragment replacement and filtered-row removal; native popovers to eliminate menu-driven table shifts; one muted completion indicator for healthy input state; select padding, adjacent stage counts, and unbroken invoice identifiers.

The status dropdown is retained because it provides the combined DRAFT + PREPARED queue used by dashboard deep links. That combined queue is explicitly named in the result description; individual stage links continue to represent exact domain statuses. No new domain status was invented.

Rounds: 2. All three reviewers are satisfied with no blockers.

| Delegate | Round 1 | Round 2 |
| --- | --- | --- |
| Claude Opus | 8/10 | 9/10 |
| GPT Sol | 8.8/10 | 9.5/10 |
| Gemini Flash | 9.8/10 | 9.8/10 |

Final small cleanups: removed the duplicate mobile completion style, made status selection explicit-submit like search, and stabilized screenshots against shared button theme transitions. The browser test verifies both Apply submission and immediate stage shortcuts. Possible one-frame native-menu positioning and the wrapping longest stage label remain cosmetic observations; neither was observed as a blocking defect. The floating check indicator is the pre-existing shared MutationStatus component, outside this page change.
