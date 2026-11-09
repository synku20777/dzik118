# Namkopa design system

The runtime contract lives in `src/styles/global.css`. `/design-system` renders
the shared CSS and Astro components, lists source declarations and component
files, and resolves color values from the active theme. Its inventories describe
what exists; they do not certify accessibility or workflow coverage.

This document has three parts: [Tokens](#tokens), [Components](#components) and
[Patterns](#patterns). Identity is fixed: the Riga palette, Switzer for UI,
Fraunces for selected display moments.

## Tokens

Tokens come in three tiers. Each tier references only the tier above it.

| Tier | Prefix | Rule |
| --- | --- | --- |
| 1 Palette | `--palette-*` | Raw Riga colors. Declared in `:root`, not `@theme`, so Tailwind builds no utilities for them. Components never use them. |
| 2 Semantic | `--color-*`, `--tone-*`, `--text-*`, `--gap-*`, `--pad-*`, `--gutter`, `--elevation-*` | What a component asks for. Defined with `light-dark()`, so one declaration serves both themes. |
| 3 Component | `--color-meter-*` | Domain names that alias a tone, so a meter chip matches its meaning. Add a tier 3 token only when the domain name carries information a tone does not. |

New code uses tier 2. Hex values appear only in tier 1 and in the standalone
HTML below.

### Color

Palette families: limestone and paper (light structure), ink (light text), night
and bone (dark structure and text), daugava (action and navigation), verdigris
(success), amber (warning), brick (danger), pine (positive-secondary).

| Token | Role |
| --- | --- |
| `--color-canvas` | Page background. |
| `--color-surface` | Panels, tables, fields, menus. |
| `--color-surface-hover` | Hover and disabled-field fill. |
| `--color-surface-raised` | Surface of raised, overlay and modal elements. Equal to surface in light mode, one step lighter in dark mode, where shadows cannot show depth. |
| `--color-foreground` / `--color-muted` | Text, and secondary text. Muted keeps 4.5:1 on canvas and surface. |
| `--color-border` | Panel, table and divider hairlines. |
| `--color-input-border` | Field boundary. Deeper than `--color-border` so a field edge meets 3:1 (WCAG 1.4.11). Never `border-border` on a field. |
| `--color-primary` (+ `-hover`, `-active`, `--color-on-primary`) | Actions, links, navigation. In dark mode primary is a pale tint, so `--color-on-primary` is dark. |
| `--color-secondary`, `--color-success`, `--color-warning`, `--color-destructive` (+ hover, active) | Meaning colors for text and fills. |
| `--color-positive-secondary` | Quiet positive state (pine), for example gas meters and credits. |
| `--color-focus-ring` | Opaque focus outline. |
| `--color-backdrop` | Scrim behind dialogs and drawers. |

Tones are one background and text pair per meaning: `--tone-neutral`,
`-info`, `-success`, `-warning`, `-danger`, `-positive`, each with `-bg` and
`-text`. Badges, notices, meter chips and nav highlights all use them, so the
same meaning always looks the same. In dark mode the background is the palette
tint at 16 to 18% alpha over the surface. Color never carries state alone:
badges add an icon and text, notices add a heading or icon.

Replaced names: `--color-badge-*` and `--color-notice-*` became `--tone-*`.

### Typography

`--font-sans` is Switzer, then Overused Grotesk (Cyrillic and fallback glyphs).
`--font-display` is Fraunces, reserved for period headings, the wordmark,
selected dwelling numbers and significant empty states. Never use it in tables,
forms, buttons or badges.

| Token | Size | Line height | Use |
| --- | --- | --- | --- |
| `--text-xs` | 12px | 16px | Captions, counters, fine print. |
| `--text-sm` | 14px | 20px | Labels, table cells, dense UI, small buttons. |
| `--text-base` | 16px | 24px | Body, buttons, inputs. |
| `--text-lg` | 18px | 28px | Subheads, drawer titles. |
| `--text-xl` | 20px | 28px | Section titles. |
| `--text-2xl` | 24px | 32px | Large section titles. |
| `--text-display-sm` | 24 to 32px, fluid | 1.2 | Page titles, key figures. |
| `--text-display-md` | 28 to 36px, fluid | 1.15 | Feature figures. |
| `--text-display-lg` | 30 to 40px, fluid | 1.1 | Fraunces headlines, amount due. |

Rules:

- Use a step, in CSS (`font-size: var(--text-sm)`) or as a Tailwind utility
  (`text-sm`, `text-display-sm`). Do not write a font-size literal.
- The named roles `.text-caption`, `.text-label`, `.text-body-sm`, `.text-body`,
  `.text-ui-strong`, `.text-h3` and `.text-h2` bind a step to weight and
  tracking. Prefer a role when one fits.
- Tracking: body `--tracking-sans` (0), small text `--tracking-small`, headings
  `--tracking-heading`, display `--tracking-display`. Fraunces weight is 600 up
  to 36px and 700 above.
- Numbers in tables and figures use tabular figures.
- Line length stays under 80 characters for body copy.

Known exception: the `/design-system` page's own hero lockup uses bespoke
`clamp()` sizes because it is illustration, not product UI.

### Spacing

Tailwind's `--spacing` (0.25rem) is the single source. `--space-1` to
`--space-16` (1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16 steps) are aliases for CSS
written outside utility classes. Geometry uses `rem`, so layout follows the
user's text size.

Semantic layout tokens name the rhythm, so screens stop choosing numbers:

| Token | Value | Use |
| --- | --- | --- |
| `--gap-label` | 4px | Label to its control. |
| `--gap-field` | 16px | Between form fields. |
| `--gap-section` | 24px | Between panels and page sections. |
| `--pad-panel` | 24px | Inside an ordinary panel. |
| `--pad-panel-compact` | 16px | Inside a dense panel or card. |
| `--gutter` | 16px; 24px from `sm`; fluid 20 to 48px from `lg` | Page edge padding. |

Control heights: `--control-size-sm` 36px (expands to 44px on coarse
pointers), `--control-size-md` 44px, `--control-size-lg` 48px.

### Breakpoints

Three names, registered in `@theme` and used by every media query:

| Name | From | Behavior |
| --- | --- | --- |
| `sm` | 40rem (640px) | Tables stop stacking into cards; gutter grows to 24px. |
| `md` | 48rem (768px) | Two-up layouts; drawers stop being full width. |
| `lg` | 70rem (1120px) | Persistent admin sidebar; fluid gutter; wide tables. |

Write media queries in range syntax with these values, for example
`@media (width < 40rem)`. CSS cannot read a custom property inside a media
query, so the values are literals. Do not add a fourth width: change the layout
so it fits, or use a container query inside the component.

### Radius

`--radius-badge` 5px, `--radius-input` 7px, `--radius-control` 8px,
`--radius-panel` 10px. Radius encodes hierarchy: small marks are tighter than
containers.

### Elevation

| Level | Token | Use |
| --- | --- | --- |
| Flat | `--elevation-flat` | Panels, tables and cards. The default; do not add a shadow to a panel. |
| Raised | `--elevation-raised` | Toolbars and toasts. |
| Overlay | `--elevation-overlay` | Menus, tooltips and popovers. |
| Modal | `--elevation-modal` | Dialogs and floating panels. `--elevation-modal-side` is the drawer variant. |

In dark mode shadows are replaced by a hairline `--color-border` ring, and the
element uses `--color-surface-raised`. `--shadow-control` is the thumb shadow
for toggles.

### Motion and icons

Durations: `--duration-feedback` 100ms (press), `--duration-fast` 140ms (hover),
`--duration-normal` 180ms, `--duration-panel` 220ms; easing `--ease-standard`.
The reduced-motion reset removes movement and long transitions. Icons are Tabler
Outline at `--icon-stroke` 1.75 and sizes `--icon-size-xs` 16, `-sm` 18, `-md`
20, `-lg` 24px.

### Theming

Themes apply to the document root through `data-theme` or the system preference.
`:root[data-theme]` sets `color-scheme` and the lightningcss `light-dark()`
switch; it does not redeclare colors. Nested theme containers are outside the
contract.

### Exceptions

`src/domain/billing/invoice-html.ts`, `src/pages/auth/confirm.ts` and email
templates are standalone HTML for PDF and email clients. They keep hardcoded hex
values and system fonts because they cannot load the stylesheet. Keep their
colors in step with the palette by hand.

## Components

| Primitive | Contract |
| --- | --- |
| Buttons | `btn-primary`, `btn-secondary`, `btn-danger`, `btn-ghost`; default, `btn-sm`, `btn-lg`. Use a native button for actions and a link for navigation. |
| Button states | Hover and press feedback only for enabled controls; `disabled` for native disabling; `aria-busy` describes work in progress. The caller owns duplicate-submit prevention and recovery. |
| Disabled links | Prefer omitting the link when there is no destination. Styling `aria-disabled` alone does not prevent activation; the caller must suppress navigation. |
| Sizes | Default/icon/theme/close controls use `--control-size-md` (44px); large uses 48px. Compact buttons use 36px for precise pointers and expand to 44px for coarse pointers. |
| Form fields | Default 44px minimum height, readable border, placeholder, focus and invalid states. Supply a persistent label and text describing any error. |
| StatusBadge | Pass a domain `status`. The shared mapping supplies text, semantic tone and a decorative icon, so state is not communicated by color alone. |
| KpiCard | `label`, `value`, optional `hint`, `tone` and `icon`. Values use tabular figures; it is a summary, not an implicit clickable card. |
| PageHeader | `title`, optional description/eyebrow/display/accent and action slot. Defaults to `h1`; use `headingLevel` when embedding within another screen. |
| EmptyState | Supply a useful title, explanation and recovery/create action in the slot. Ornament is reserved for significant first-use states. |
| Drawer | Native modal dialog with a named heading, scrollable body, close control and wrapping footer actions. Preserve focus return, Escape and unsaved-edit handling in its controller. |

## Patterns

Page edge padding uses `--gutter`; the admin sidebar appears from `lg`; tables
stack into labelled cards below `sm`. Layout recipes for the core screens are
added with the pattern review.

## Feedback and accessibility preferences

Press feedback starts through `:active`; color feedback avoids label movement.
Use `--duration-feedback`, `--duration-fast`, `--duration-normal`,
`--duration-panel` and `--ease-standard` for shared transitions. The current
drawer is a discrete open/close interaction, not a draggable sheet; it has a
symmetric entrance/exit and no artificial input lock. A future draggable sheet
needs interruptible position/velocity tracking rather than a scripted slide.

The reduced-motion reset removes movement and long transitions while preserving
state changes. Translucent reference chrome becomes solid when reduced
transparency or increased contrast is requested. Product surfaces are already
opaque. Keep native focus outlines available in forced-colors mode.
Status badges retain a system-color boundary in forced-colors mode. Their text
and icons continue to identify state when semantic fills are suppressed.
Focus: `:focus-visible` draws a 2px `--color-focus-ring` outline; never suppress
it without an equivalent indicator. Invalid fields use `aria-invalid="true"`
plus error text linked through `aria-describedby`.

## Verification

Run `npm test`, `npm run build`, and
`npx playwright test tests/e2e/design-system.spec.ts tests/e2e/dark-mode.spec.ts`.
The focused browser checks cover responsive reference layout, theme persistence,
real product field states, keyboard operation and live token readouts. They do
not replace authenticated workflow tests, screen-reader testing, or Safari/iOS
device testing.

After changing code, run `graphify update .` to refresh the repository graph.
