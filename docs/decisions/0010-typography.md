# 0010 - Typography: Switzer, Overused Grotesk, and Fraunces

**Status:** Accepted
**Date:** 2026-10-01
**Phase:** Design system

## Context

The marketing site (`namkopa-website`) chose a new typography. Its file
`docs/TYPOGRAPHY.md` is the specification, written so that the app can use the
same rules. The app and the site must look like one product. Before this change
the app used Source Sans 3 and Fraunces, loaded from Google Fonts.

## Decision

The app follows the site's specification.

- **Sans: Switzer** (variable, weight 100 to 900) for all text that is not a
  display heading. **Overused Grotesk** (variable, weight 300 to 900) is the
  fallback. Switzer has Latin only, so Russian text uses Overused Grotesk.
- **Display: Fraunces** (variable) with the axes `SOFT` 40 and `WONK` 0. The
  browser sets `opsz` from the rendered size (`font-optical-sizing: auto`).
- **Fraunces weight follows size:** 700 above 36px, 600 at 36px or below.
  - `h1.font-display` in `.page-header` and `.app-content` is 29.6px to 40px. It
    is 700 from a viewport width of 1125px (70.3125rem).
  - The period workbench heading is 32px to 44px. It is 700 from 900px
    (56.25rem).
  - The Organization heading is at most 33.6px. It is 600.
- **Letter-spacing +0.03em on all sans text**, at every size and weight. The
  value is one token, `--tracking-sans`. A universal rule in the Tailwind base
  layer applies it to each element, because an `em` value on `body` inherits as
  a fixed length. Form controls are in the rule, because preflight gives them
  `letter-spacing: inherit`.
- **Display and monospace text keep their own spacing:** `.font-display` is
  -0.015em, `.brand` is -0.01em, and `.font-mono` is normal.
- **Fonts are in the repository** (`src/fonts`, with each license file). No
  request goes to a third party. The CSP is now `font-src 'self'`, and
  `style-src` no longer names Google.
- The two Fraunces files are copies from `@fontsource-variable/fraunces` 5.3.0.
  The `@font-face` rules are in `src/styles/global.css`. The Latin subset does
  not claim the combining marks U+0304, U+0308, and U+0329. This prevents a
  Chrome fault that draws a Latvian macron over the next letter.

## How the app differs from the site's snippet

- The site puts -0.015em on every `h1` and `h2`, because all of them are
  Fraunces there. In the app most `h1` and `h2` are sans. So the app puts the
  display spacing on `.font-display`, and sans headings get +0.03em like all
  other sans text.
- An explicit `letter-spacing` or `tracking-*` still wins, as the specification
  says. The app keeps its existing values: uppercase eyebrows and breadcrumbs
  (0.08em to 0.12em), and the large sans numbers on the dashboard and the
  resident invoice (-0.025em and -0.03em).
- The app has no `.text-display` class and no large Fraunces numbers.
- The fonts are copied files, not an npm package. `npm install` of the package
  fails in this repository, because of an existing conflict between TypeScript
  and `@astrojs/check`.

## Layout changes that the wider font needed

Switzer is wider than Source Sans 3, and the letter-spacing adds more width. A
before-and-after test of 216 page views found these places. All are fixed.

| Place | Change |
| --- | --- |
| Resident portal header on a phone | The header wraps onto two lines. |
| Dwelling page, resident rows | The row wraps. A long email address breaks. |
| Dwelling page, detail list and title | A long value or dwelling number breaks. |
| Dwelling page, "View all tariffs" | The button stays on one line. |
| Audit page on a phone | A long action code or request ID breaks. |
| Stacked tables on a phone (all) | A long value with no spaces breaks. |
| Dwellings list, pagination bar | The bar wraps on a narrow phone. |
| Tables between 640px and 1120px | Side padding of cells is 0.625rem. |

Several of these faults were in the app before this change (8 page views had a
horizontal scroll, for example the Russian resident portal on a phone). Now none
has one.

## Limits

- **Russian display headings.** Fraunces has no Cyrillic. A Russian display
  heading uses Georgia. The specification accepts this. A Cyrillic serif that
  matches Fraunces is an open item.
- **Switzer license.** Switzer uses the Fontshare Free Font License
  (`src/fonts/Switzer-FFL.txt`). Review the terms for this use before launch.
- **Letter-spacing in dense screens.** 0.03em was chosen by eye on the
  marketing site. Tables and forms in the app are denser. They fit, but
  `--tracking-sans` is the one value to change if they look too loose (0.02em
  is a tighter value).
- **Three buttons wrap onto two lines** where they did not before (two on the
  Messages page on a phone, one on the workbench on a tablet). They stay inside
  the page.
- **Invoice PDFs and emails are not changed.** They use Helvetica and Arial on
  purpose: a sent invoice must not change, and email cannot load web fonts.
- **The sign-in confirmation page** (`auth/confirm.ts`) has no stylesheet. It
  names the new fonts but shows the system font.

## Consequences

- Pages load four font files from the app's own domain (about 350 KB in total,
  cached).
- The app and the site share one typography. When one changes, change the other
  and the specification file.
