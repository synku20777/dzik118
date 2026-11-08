# Design system assessment — 7 November 2026

Completed three council review and improvement rounds using the UI Design
System, Apple Design and Frontend UI Engineering skills. The existing Riga
palette and Switzer/Fraunces identity remain the foundation.

## Assessment

The visual identity was coherent. The main weaknesses were state behavior and
maintenance: utility classes overrode field error/focus styles, local form CSS
reintroduced weak boundaries, universal letter spacing crowded translated UI,
and the reference page reported hardcoded coverage as completeness.

## Three passes

1. **Foundations:** introduced spacing, control-size, feedback-duration and
   tracking tokens; made focus rings opaque; migrated product field utilities
   to the input boundary token; added enabled hover/press states, ghost/large
   variants and consistent icon targets. Replaced reference inventories and
   color readouts with source-derived and theme-aware values.
2. **Interaction and accessibility:** moved shared field states above utility
   layers, preserved errors during focus, consolidated theme/close controls,
   and put the organization disclosure inside its scrolling sidebar. Fixed
   component initialization on ordinary pages without ClientRouter, which also
   restores resident table labels. Expanded keyboard, theme, state and contrast
   regression coverage.
3. **Consistency and verification:** removed remaining local field border and
   focus duplication, preserved select chevrons and end padding, fixed display
   tracking across type utilities, standardized the close icon, and removed the
   reference page's own invalid-state override. Decorative shell diagrams no
   longer add landmarks or keyboard stops. Added forced-colors badge boundaries,
   touch-target checks and a display-token override test.

## Council review

Rounds: 3. Scores are qualitative reviewer judgments, not accessibility certification.

| Delegate | Round 1 | Round 2 | Round 3 |
| --- | --- | --- | --- |
| Claude Opus 5.5 | 7/10 | 8.5/10 | 9.3/10 |
| GPT Sol | 7/10 | 9/10 | 9.5/10 |
| Gemini 3.8 Flash | 8.5/10 | 9.2/10 | 9.5/10 |

All reviewers were satisfied within the agreed scope in the final round, with
no blocking findings. Gemini Pro was unavailable; Gemini 3.8 Flash was the
available Gemini model. All reviews used high reasoning effort.

Useful disagreements were resolved against source and tests: native disabled
opacity already worked through the base rule (the browser verifies 0.45),
document-wide theming matches current usage, and color-based press feedback
preserves alignment in dense controls. Nested themes and scale-on-press were
not added. Reviewer claims beyond the checks below are not treated as verified.

## Validation and limits

- Production build passes.
- All 341 unit tests pass, including two new native-load lifecycle cases.
- All 9 focused Playwright tests pass. Coverage includes the reference at
  320/390/768/1024/1440px, real login field boundary/focus/error states in both
  themes against opposite OS preferences, keyboard operation, theme persistence,
  disabled and destructive states, organization menu fit/Escape, forced colors,
  reduced motion, display tracking overrides and coarse-pointer targets.
- Source-scoped ESLint, changed-source formatting and whitespace checks pass.
- The graph was refreshed with `graphify update .`.
- Astro and TypeScript retain six pre-existing `Env.BROWSER` diagnostics in PDF
  and scheduled-job code because the local Wrangler browser binding is
  commented out. No new design-system diagnostics remain.
- Repository-wide ESLint also includes pre-existing untracked skill scripts
  under `.agents` and `.claude`; those scripts have 34 errors and two warnings.
- Authenticated end-to-end workflows, manual screen-reader use, and Safari/iOS
  device behavior were not independently revalidated in this task.

See [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) for the component and token contract.
