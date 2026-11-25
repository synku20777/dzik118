# Namkopa design system

The runtime contract lives in `src/styles/global.css`. `/design-system` renders
the shared CSS and Astro components one topic at a time (Foundation, then
Components A to Z; the URL fragment picks the topic), lists source declarations
and component files, and resolves color values from the active theme. Its inventories describe
what exists; they do not certify accessibility or workflow coverage.

This document has three parts: [Tokens](#tokens), [Components](#components) and
[Patterns](#patterns). Identity is fixed: the Riga palette, Switzer for UI,
Fraunces for selected display moments.

## Tokens

Tokens come in three tiers. Each tier references only the tier above it.

| Tier | Prefix | Rule |
| --- | --- | --- |
| 1 Palette | `--palette-*` | Raw Riga colors. Declared in `:root`, not `@theme`, so Tailwind builds no utilities for them. Components never use them. |
| 2 Semantic | `--color-*`, `--tone-*`, `--text-*`, `--gap-label`, `--gutter`, `--elevation-*`, `--z-*` | What a component asks for. Theme-dependent colors are defined with `light-dark()`, so one declaration serves both themes. |
| 3 Component | `--color-meter-*` | Domain names that alias a tone, so a meter chip matches its meaning. Add a tier 3 token only when the domain name carries information a tone does not. |

New code uses tier 2. Hex values appear only in tier 1 and in the standalone
HTML below.

### Color

Palette families: limestone and paper (light structure), ink (light text), night
and bone (dark structure and text), daugava (action and navigation), verdigris
(success), amber (warning), brick (danger), pine (positive-secondary).

| Token | Role |
| --- | --- |
| `--color-canvas` | Page background. One visible step (about 1.2:1) darker than surface in light mode, so panels read without an outline. |
| `--color-surface` | Panels, tables, fields, menus. |
| `--color-surface-hover` | Static tints: disabled fields and progress tracks. Equal to `--color-well` in light mode. Do not use it for hover (use `--color-hover`). |
| `--color-table-th-bg` | Static fill for `<table>` column headers (`--palette-limestone-75` in light mode, `--palette-night-750` in dark mode). |
| `--color-surface-raised` | Background of elevated surfaces: toasts, menus, popovers, dialogs, drawers. Equal to surface in light mode, one step lighter in dark mode, where shadows cannot show depth. |
| `--color-hover` | Hover fill for table rows and other controls with a tinted hover state. Inside a raised surface (`.organization-menu`, `.row-menu > div`, `.more-menu > div`, `.case-menu`, `.tpl-popover`, `.context-drawer`, `dialog`) dark mode uses one step lighter (`--palette-night-725`), because the shared dark hover equals the raised fill. Darker than both canvas and surface in light mode (about 1.1 against the canvas, 1.3 against the surface). |
| `--color-foreground` / `--color-muted` | Text, and secondary text. Muted keeps 4.5:1 on canvas and surface. |
| `--color-border` | Dividers: table rows, list rows, tab underline, metric dividers, progress tracks. Not used for container outlines. |
| `--panel-border` | The `border` shorthand of every container (panel, table wrap, metric strip, card, shell edge). It is `0 solid transparent`: containers have no outline and are told apart by the canvas/surface step. In Windows high-contrast mode it becomes `1px solid CanvasText`. Set it to `1px solid var(--color-border)` to bring outlines back. Use `.contained` on a utility-styled container. |
| `--color-input-border` | Field boundary. Deeper than `--color-border` so a field edge meets 3:1 (WCAG 1.4.11) on canvas, surface, table headers and `--color-hover` (about 3.1 on hover, 3.3 on canvas). Never `border-border` on a field. |
| `--color-primary` (+ `-hover`, `-active`, `--color-on-primary`) | Actions, links, navigation. In dark mode primary is a pale tint, so `--color-on-primary` is dark. |
| `--color-secondary`, `--color-success`, `--color-warning`, `--color-destructive` | Meaning colors for text and fills. Only destructive has `-hover` and `-active` variants. |
| `--color-positive-secondary` | Quiet positive state (pine), for example gas meters and credits. |
| `--color-focus-ring` | Opaque focus outline. |
| `--color-backdrop` | Scrim behind dialogs and drawers. |
| `--color-menu-hover` / `--color-menu-selected` | Hover and selected washes for menu items, dropdown items and the sidebar navigation: the foreground colour at 5% and 9%, so they read in both themes. |
| `--color-required` | The pulsing dot beside a required boxed field's label (the destructive red). |
| `--color-well` | Recessed fill for `box-well`: below the surface in both themes. |

`--hover-ring` is the 4px spread of the button hover outline; each button
colours it from its own fill.

Tones are one background and text pair per meaning: `--tone-neutral`,
`-info`, `-success`, `-warning`, `-danger`, `-positive`, each with `-bg` and
`-text`. Badges, notices, meter chips and nav highlights all use them, so the
same meaning always looks the same. In dark mode the background is a palette
tint (`--palette-*-a16` to `-a18`, RGBA literals) over the surface. Color never carries state alone:
badges add an icon and text, notices add a heading or icon.

Replaced names: `--color-badge-*` and `--color-notice-*` became `--tone-*`.

### Typography

`--font-sans` is Switzer, then Overused Grotesk (Cyrillic and fallback glyphs).
`--font-display` is Fraunces, reserved for period headings, the wordmark,
selected dwelling numbers, significant empty states, avatar initials and the
title of a centered or full-screen modal. Never use it in tables,
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
- The named roles `.text-caption`, `.text-label`, `.text-body-sm`, `.text-h3`
  and `.text-h2` bind a step to weight and tracking. Prefer a role when one
  fits. Body text needs no role: it is the default.
- Tracking: body `--tracking-sans` (0), small text `--tracking-small`, headings
  `--tracking-heading`, display `--tracking-display`. Fraunces weight is 600 up
  to 36px and 700 above.
- Numbers in tables and figures use tabular figures.
- Line length stays under 80 characters for body copy.

Known exception: the `/design-system` page's miniature shell diagrams use
bespoke sizes because they are illustration, not product UI.

### Spacing

Tailwind's `--spacing` (0.25rem) is the single source. `--space-1` to
`--space-16` (1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16 steps) are aliases for CSS
written outside utility classes. Geometry uses `rem`, so layout follows the
user's text size.

Layout rhythm uses Tailwind utilities, so it stays one scale:

| Rhythm | Value | Use |
| --- | --- | --- |
| `--gap-label` | 4px | Label to its control (CSS outside utilities). |
| `--gap-field`, `space-y-4`, `gap-4` | 16px | Between form fields. |
| `--gap-section`, `space-y-6` | 24px | Between panels and page sections. |
| `--pad-panel`, `p-6` | 24px | Inside an ordinary panel. |
| `--pad-panel-compact`, `p-4` | 16px | Inside a dense panel or card. |
| `--gutter` | 16px; 24px from `sm`; fluid 34 to 48px from `lg` | Page edge padding. |

Control heights: `--control-size-sm` 36px (expands to 44px on coarse
pointers), `--control-size-md` 44px, `--control-size-lg` 48px (resident portal
controls).

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

`--radius-check` 5px (checkboxes), `--radius-badge` 8px, `--radius-input` 12px,
`--radius-control` 12px, `--radius-panel` 16px. Radius encodes hierarchy: small marks are tighter than
containers. Panels (anything with `--radius-panel`: cards, KPI cards, metric
strips, tables, notices, dialogs, the organization menu) add
`corner-shape: squircle` next to the radius; controls, inputs and badges stay
round. Browsers without `corner-shape` fall back to round corners.

### Elevation

| Level | Token | Use |
| --- | --- | --- |
| Flat | `--elevation-flat` | Panels, tables and cards. The default; do not add a shadow to a panel. |
| Raised | `--elevation-raised` | Toolbars and toasts. |
| Overlay | `--elevation-overlay` | Menus, tooltips and popovers. |
| Modal | `--elevation-modal` | Dialogs and floating panels. `--elevation-modal-side` is the drawer variant. |

Stacking uses the `--z-*` scale, never a bare number: `--z-raised` (1, above a
sibling overlay), `--z-sticky` (10), `--z-popover` (20, menus, popovers and the
sidebar), `--z-overlay` (30, floating panels above popovers), `--z-toast` (90)
and `--z-skip-link` (100). Native dialogs and popovers use the top layer
instead. Local exceptions are relative: `z-index: -1` puts a decoration behind
its own content, and `calc(var(--z-…) + 1)` lifts one element just above a
named layer (an open row menu's row, the `/design-system` top bar).

In dark mode shadows are replaced by a hairline `--color-border` ring (floating
surfaces keep an outline; only containers on the page lose theirs), and the
element uses `--color-surface-raised`. `--shadow-control` lifts switch thumbs
and selected segments.

### Motion and icons

Durations: `--duration-feedback` 100ms (press), `--duration-fast` 140ms (hover),
`--duration-normal` 180ms, `--duration-panel` 220ms; easing `--ease-standard`.
The reduced-motion reset removes movement and long transitions while preserving
state changes. Icons are Tabler Outline (`src/lib/ui/icons.ts`, including `home`,
`copy`, `minus` and `player-pause`) at `--icon-stroke` 1.75 and sizes
`--icon-size-xs` 16, `-sm` 18, `-md` 20, `-lg` 24px. Meter category icons live
in `METER_ICONS` (`droplet` cold water, `droplet-hot` hot water — never `flame`,
`bolt` electricity, `flame` gas, `thermometer` heat, `tool` other).

### Theming

Themes apply to the document root through `data-theme` or the system preference.
`:root[data-theme]` sets `color-scheme` only (lightningcss derives its
`light-dark()` fallback from it); it does not redeclare colors. Chart colors
(`--chart-1` to `-6`) use `light-dark()` so they hold 3:1 on either surface. Nested theme containers are outside the
contract.

### Exceptions

`src/domain/billing/invoice-html.ts`, `src/pages/auth/confirm.ts` and email
templates are standalone HTML for PDF and email clients. They keep hardcoded hex
values and system fonts because they cannot load the stylesheet. Keep their
colors in step with the palette by hand.

## Components

Components are CSS classes in `src/styles/global.css` (`@layer components`)
plus the Astro components in `src/components/ui/`. Stay class-based: add an
Astro wrapper only when a pattern carries logic (a status mapping, translated
labels, a controller), not to wrap one element.

### Shared rules

- **States.** Every interactive component defines default, hover, active
  (press), `:focus-visible`, disabled and, where work happens, busy. Hover and
  press apply only to enabled controls. Buttons, fields and navigation chrome
  change color on press and do not move, scale or nudge their icons (the theme
  toggle's icon flip is its only motion). Links and tabs have hover and current
  states only. Text controls (links, text toggles, disclosure summaries) all
  underline on hover the same way: 1px, 0.2em below the text. A menu trigger
  (row, more or case menu) stays pressed while its menu is open.
- **Touch.** A control (button, icon button, field, menu trigger, text toggle)
  is at least 44px (`--control-size-md`) on a coarse pointer; compact 36px
  controls expand under `@media (pointer: coarse)`. A text link meets WCAG
  2.5.8: 24px, or no other target within a 24px circle. A table row link is
  stretched over its row (`row-link`).
- **Focus.** A 2px `--color-focus-ring` outline from the base layer. Do not
  remove it; do not rely on color alone for any state.
- **Names.** Icon-only controls need `aria-label`; the shared tooltip shows it.
  Use sentence case and the verb for the action ("Save changes", then "Saved").
- **Disabled.** Prefer omitting an action with no destination. A disabled link
  needs `aria-disabled="true"` and the caller must suppress navigation.

### Button

`btn-primary` (the one main action of a view), `btn-secondary`, `btn-danger`
(destructive and irreversible) and `btn-ghost` (reads as a link: the quiet way
out of a dialog or an optional step; it underlines on hover). Sizes: default
44px, `btn-sm` 36px (44px on coarse pointers).

- States: active fill per variant. On hover, secondary buttons keep their
  resting fill and draw the 4px ring (`--hover-ring`); primary and destructive
  buttons change fill and draw a ring in their own colour. `disabled` or
  `aria-disabled` at 45% opacity; `aria-busy="true"` sets the progress cursor.
  The caller owns duplicate-submit prevention.
- Use a `<button>` for actions and an `<a>` for navigation.
- Do: one `btn-primary` per view region. Don't: stack two primaries, or use
  `btn-danger` for a confirm that is not destructive.

### Icon button

`icon-btn` (44px), `icon-btn-sm` (36px, 44px on coarse pointers). Always
`aria-label`. Standard icon buttons keep their resting fill on hover and draw
the 4px ring. `icon-btn-danger` is a delete: its icon turns destructive under
the pointer, with a destructive ring. `icon-btn-ghost` stays transparent
and gains a border and ring on hover. Use it for a close button or a row of
several icon actions.
Don't use it for an action that has room for a visible label.

### Button group

`ButtonGroup` (`label?`, `class?`) joins related `btn-*` links, buttons or a
`<details>` menu into one control with `role="group"`. Name the group when its
purpose is not clear from the buttons.

### Link

`link` is the primary colour and underlines on hover; `link-ghost` takes the
text colour; `link-underlined` keeps the underline at rest. A link inside
running text is always `link-underlined`, so it does not rely on colour alone.
Block link: put `has-block-link` on a card and `block-link` on the one link in
it. The link's hit area stretches over the card. Hover keeps the card fill and
underlines the link in the primary colour. Keyboard focus outlines the card.
Other controls in that card must sit above it (`row-link-above`).

### Avatar

`avatar` (28px), `avatar-sm` (24px), `avatar-lg` (36px): initials in Fraunces
in a hairline circle. It is decoration next to a name or email, so give it
`aria-hidden="true"`. `initials()` (`src/lib/ui/initials.ts`) builds up to two
initials from a name or an email's local part ("anna.berzina" gives "AB"). Used
for the signed-in account, a dwelling's residents, admin users, the message
thread and the occupant column of the dwellings list. No photos.

### Form field

Parts: `field-label` (4px margin below), the control (give it `mt-1`, which is
`--gap-label`, so the label sits 8px above it),
optional `field-hint`, optional `FieldError` (`error`, `name`, `id?`,
`label?`) which renders `field-error` with `id="<name>-error"` and
`role="alert"`; `label` prefixes the message with the field's name, for errors
listed under a compact form. Pass `id`
when the control's id is not the field name, for example a form rendered twice
on one page; it must be `<control id>-error`. `FieldError` renders nothing for
an empty message list.

- Controls (input, select, textarea) are styled by the base layer: 44px
  minimum height, `--color-input-border`, `--radius-input`, placeholder in
  muted. Use utilities for width and spacing only; do not restyle the border,
  radius or padding. Checkbox and radio are 18px marks drawn by the base layer
  (a `--radius-check` square, a circle for radio): checked fills
  `--color-primary` and shows the mark in `--color-on-primary`; indeterminate
  shows a bar; disabled is 45%. Put them in a `check-row` label so the whole
  44px row is the target; a radio group goes in a `fieldset` with a `legend`.
- Boxed field: `field-box` wraps a `<label>` and its control, with the label
  inside the frame above the control. The frame takes the state: `aria-invalid`
  on the control tints it danger, `data-tone="warning"` tints it warning.
  `is-required` adds a pulsing red `--color-required` dot after the label text
  (static under reduced motion); the control still needs `required`. Mark
  optional fields with `<span class="field-optional">· optional</span>` in the
  label. A `field-error` or `field-hint` goes under the frame, outside it; in a
  compact form, under the whole group, naming the field (`FieldError label`;
  `bindMutationForm` places client-side errors the same way). The dwelling
  page's edit forms (basic information, meters, additional information) are
  compact forms.
  Tints are laid over `--color-surface`, since the dark tones are translucent.
- Compact form: `field-group` puts boxed fields in one frame split by
  hairlines, two columns from `sm` (`--cols` sets more); `field-span` takes a
  whole row, and a `check-row` can join it.
- Icons: `input-icon` wraps a control and an `Icon`. A leading icon says what
  goes in; a trailing `input-icon-end` icon shows the state and takes its
  colour. Both are decorative.
- Colour grading: an invalid control (`aria-invalid="true"`) gets the danger
  border and `--tone-danger-bg` fill; `data-tone="warning"` and
  `data-tone="success"` do the same with their tones. Text still says what is
  wrong.
- Switch: use `.toggle-switch` wrapping `<input type="checkbox" role="switch">`
  and `<span class="toggle-switch-track" aria-hidden="true"><span class="toggle-switch-thumb"></span></span>`.
  Unchecked state uses a hollow `--color-surface` track with `--color-muted`
  border and thumb (>= 4.8:1 contrast on surface and elevated backgrounds);
  checked state fills `--color-primary` with a `--color-control-thumb`
  (`--color-on-primary`) thumb (> 9:1 in both themes). Visual size is 44×24px,
  expanding its hit area to `--control-size-md` (44×44px) under
  `@media (pointer: coarse)`, with `--color-focus-ring` on `:focus-visible`,
  `--duration-fast`/`--ease-standard` transitions under
  `prefers-reduced-motion: no-preference`, and `CanvasText`/`Highlight` fills in
  `forced-colors: active`.
- States: focus (border to primary plus the 2px outline), invalid
  (`aria-invalid="true"`, border to destructive, survives focus), disabled
  (`--color-surface-hover` fill, muted text).
- Accessibility: every control has a persistent visible label (placeholder is
  not a label). `linkFieldErrors` (`src/lib/ui/field-errors.ts`, loaded by the
  admin, resident and auth layouts) finds each `.field-error` by id, then sets
  `aria-invalid` and adds the error to `aria-describedby` on its control. Link a
  `field-hint` yourself with `aria-describedby`. Put fields on canvas or surface
  (see the input-border note under Color).
- Don't hide the error behind color: always include text that says what to fix.

### Status badge and quiet status text

`StatusBadge` (`status`: a domain status). The mapping in
`src/lib/ui/invoice-status.ts` supplies label, tone and icon (across all 20
states including `READY`, `PREPARED`, `OPEN`, `LOCKED`, `ACTIVE`, `ARCHIVED`,
`DISABLED`, `NEW`, `RESOLVED`, `PROPOSED`, `CONFIRMED`, `REJECTED`, `REVERSED`,
`UNMATCHED`, `FAILED`); the markup is `status-badge` with `data-tone` of
neutral, info, success, warning or danger. Text is regular weight (400). Colors
are the `--tone-*` pair. State is carried by icon and text, never color alone;
forced-colors mode draws a system-color outline. List pages use it for their
Status column (Dwellings, Periods, Tariffs); `DISABLED` (neutral,
`player-pause`) marks a tariff that is switched off.

In high-density worklists such as Current Month, pair `StatusBadge` (reserved for
exceptions such as `MISSING_DATA` and `OVERDUE`) with `.status-text` for routine
stages (`Draft`, `Prepared`, `Sent`, `Paid`): plain muted `--text-xs` text with
its icon so problem rows stand out immediately.

### Notice

`notice` (info), `notice notice-success`, `notice notice-warning`,
`notice notice-danger` on a `<p>` or `<div>`. Tone pair from `--tone-*`.

- Accessibility: add `role="alert"` for a danger notice that appears after an
  action, `role="status"` for other notices that appear after an action. A
  notice present at page load needs no role. Say what happened and what to do.
- Don't use a notice for a validation message next to a field (use
  `field-error`) or for transient confirmation (use `MutationStatus`, or an
  inline status line with an Undo action for quick in-place toggles).

### Panel, metrics and KPI

- `panel` is the default container: surface, no outline (`--panel-border`),
  `--radius-panel`, flat. A padded panel is a `box` (below); `panel p-4` stays
  for a dense one, and `panel` alone for a container whose children pad
  themselves.
- `table-wrap` is a panel that scrolls horizontally.
- `metric-strip` with `metric`, `metric-label`, `metric-value`, `metric-note`
  (`--metrics` sets the column count, default 4; 2 columns below `md`);
  `data-tone` of success or warning colors the value. One surface, dividers
  between figures.
- `KpiCard` (`label`, `value`, `tone?` neutral, success, warning or danger,
  `icon?` invoice, coins, clock, open or lock, `hint?`): a standalone summary
  figure with tabular numerals; not clickable (used on the Periods index).
- `icon-tile` (`icon-tile-sm`): the tinted squircle that carries one icon
  beside a title or figure: the KPI card's icon, settings cards, summaries and
  drawer rows. 44px (`-sm` 32px), `--tone-neutral-bg` with a muted icon;
  `data-tone` (info, success, warning, danger) on the tile or on the `.kpi`
  around it tints both. Decorative, so `aria-hidden`. Use it instead of a
  page-scoped tile; never a text glyph inside it.
- `collection-card` (`collection-grid`, `collection-hero`, `collection-bar`,
  `collection-split`, `collection-row`, `collection-ledger`, `money-ledger`): the
  dashboard KPI breakdown card placing collected total, ratio share, progress bar
  and unpaid/overdue links beside the accounting ledger (`+`, `−`, `=`). Below
  `32rem` of container width, `initCollectionLedgers()` (`src/lib/ui/collection-ledger.ts`)
  collapses the breakdown into a closed `<details>` disclosure while keeping it
  always open on wider layouts. Give each disclosure a stable ID to preserve
  its narrow-layout state when a workbench refresh replaces the card. The
  initializer returns a cleanup function and accepts an optional AbortSignal.
- `financial-summary` (`financial-stat`, `financial-note`): inline single-line
  money strip using `--color-surface` and `--panel-border`, used by Current Month where the full
  breakdown lives on the dashboard.
- `inline-undo`: underlined primary-colored action (`44px` min-height on coarse pointers) paired with operation status lines (Tariffs, Invoice template).
- A region that is loading carries `aria-busy="true"` and dims; announce the
  result through a status element, not by making the region live.
- `empty-state` can be used as a class without the component for a one-off
  empty region.
- Don't add a shadow to a panel; don't nest a panel in a panel.
- `box` is a padded panel for one subject (`--space-5` by `--space-6`), with
  no outline like `panel` (use `.contained` to give a utility-styled container
  `--panel-border`). `box-well` sets it back on `--color-well` (below the
  surface in both themes; in light mode it is the canvas tone, so use it inside
  a panel or box); `box-raised` and `box-floating` bring it forward with
  `--elevation-raised` and `--elevation-overlay`. A box rendered as an anchor
  hovers to `--color-hover`. Depth never changes on hover.
- `divider` is a hairline between groups, `divider-soft` fades out at both
  ends, `spacer` keeps the same gap with no line. Use them on an `<hr>`.

### Progress track and attention list

- `month-status` (`month-status-lead`, `month-status-sentence`, `month-progress`,
  `progress-marker`, `progress-label`, `progress-now`, `progress-late`,
  `progress-detail`): dashboard workflow progress bar with `--step-progress`
  fill per step (`done`, `current`, `in-progress`, `unavailable`), showing four
  columns across above `48rem` of container width and two below.
- `attention-list` (`attention-group`, `attention-group-heading`,
  `attention-row`, `attention-summary-row`, `attention-action`,
  `attention-more-row`): severity-grouped exception rows (`overdue` danger,
  `missing` warning, plus operational summaries and "+N more" expansion).

### Building view

`BuildingView` (`src/components/ui/BuildingView.astro`) + `BuildingEditor.tsx`
render an architectural facade of entrances, floors and apartment tiles paired
with the Dwellings table via `.toggle-tabs`. Tiles highlight `MISSING_DATA`
(dashed warning outline) and `OVERDUE` (danger surface/border). The ground line,
entrance door, legend, borderless `--panel-border` `.building-strip`
(non-apartments) and `.building-unplaced` tray share the same `--color-surface`
contract (switching trays to `outline: 1px dashed var(--color-border)` under
`[data-arranging]` for zero layout shift). `canArrange={false}` renders a
read-only facade. The [Building view specimen](/design-system#building-view)
uses the production editor. On a wide screen, choose Arrange, drag a tile or
select it with Enter and use the arrow keys. The first sample save fails,
Retry saves locally, and Undo and Reset are available.

### Data table

A `<table>` inside `table-wrap`: column headers (`thead th`) are muted 12px
uppercase labels (`letter-spacing: 0.04em`, weight 550, tinted
`--color-table-th-bg`); row headers keep normal case. Tabular figures,
right-aligned numbers, and `.table-occupant` pairs `.avatar-sm` with occupant
names beside sort arrows in list headers.

- Add `stack-table` to the wrapper to render each row as a labelled card below
  `sm`; `src/lib/ui/stack-tables.ts` copies column headers into `data-label`.
- Add `table-wrap-visible` when a table contains `.row-menu` dropdowns that
  must extend beyond the last rows without clipping: corner cells carry
  `--radius-panel` themselves (including the last visible row via
  `:not([hidden]):not(:has(~ tr:not([hidden])))`) and row hovers move to `> td`.
- Add `table-compact` on dense worklists for `0.625rem 0.75rem` padding, compact
  table badges, `.numeric-column`, and selected-row (`tr[data-selected]`)
  highlights alongside `.bulk-toolbar`. Dense tables either stack or switch to
  compact multi-line card rows via container queries (`@container (width < 54rem)`
  on Current Month; `< 50rem` on Tariffs).
- Status modifiers and utilities: `.mid-truncate` (`.mid-start` + `.mid-end`)
  truncates long meter serials in the middle so distinguishing tails remain
  visible; `td[data-void="true"]` strikes through reversed/rejected amounts;
  `tr[data-receded="true"]` mutes inactive/former rows; `.row-changed` fades a
  1.5s `--color-hover` highlight (`.row-changed-still` under reduced motion).
- Clickable rows: `row-link` on the `<tr>`, `row-link-target` on the one `<a>`
  that owns the row, `row-link-above` on independent controls inside the row.
- States: row hover tint (`--color-hover`), `:focus-within` outline,
  `[data-selected]` info wash (or 2px `Highlight` outline in forced-colors).
- Accessibility: headers are `th`; give wide tables a caption or heading; never
  use a table for layout.

### Page header and breadcrumbs

`PageHeader` (`title`, `headingLevel` h1 default, `description?`, `eyebrow?`,
`display?`, `accent?`) and a default slot for actions (wrap them in
`page-actions`). `display` selects the Fraunces treatment for period and month
headings, the top-level admin index pages (dwellings, messages, payments,
periods, guide, settings and its billing, rules and invoice-template pages) and
the payments ledger (building ledger and dwelling account statement).
Migration and payment-transaction pages keep the plain sans `h1`. Money figures
are never Fraunces, even when large.
`Breadcrumbs`
(`items`: `{ label, href? }`, last crumb has no `href`) is rendered once by the
admin layout, so pages only declare their trail. It is a `<nav>` named
"Breadcrumb" and marks the current page with `aria-current="page"`.

### Tabs, period navigation and filter bar

`tabs` is a row of links to sibling views on a 2px rule; the current one carries
`aria-current="page"` and draws a 2px primary line over the rule. Hover darkens
the text only. These are navigation, not `role="tab"` widgets. `workflow-rail`
and `workflow-filter` build the wrapping underline stage tabs with tabular
counts used in the Current Month queue so every stage stays visible without
horizontal scrolling. `toggle-tabs` is
a segmented control with a recessed track and a raised selection. In light
mode both use limestone tones distinct from the page canvas and paper surface.
Use labels around visually hidden radios (in a `role="radiogroup"`) when the
choice stays on the page, links with `aria-current` when it changes the URL
(such as `Table / Building` on Dwellings, `LanguageSwitch`, and the invoice
template editor's language picker and phone Edit / Preview switch, a
`<fieldset class="toggle-tabs">` and a `role="group"` of `aria-pressed`
buttons).
Period navigation is a `btn-group` of `btn-secondary` links (`period-nav` on
the group is only a hook): previous and next month, the same shape, hover ring
and pressed fill as any button group, stacking full width on phones. No disabled
placeholder renders when a neighbour is absent.
`filter-bar` groups labelled filter controls on a panel
surface and wraps; below `sm` its fields flex from 9rem and fill the width.

### Pagination bar

`PaginationBar` (`src/components/ui/PaginationBar.astro`, `.pagination-bar` and
`.pagination-page`) renders Previous/Next `.btn-sm` controls beside the page
readout. When `previousHref` or `nextHref` is `null`, the unavailable control is
a non-tabbable `<span role="link" aria-disabled="true">`, never a disabled
anchor.

### Empty state

`EmptyState` (`title`, `description?`, `ornament?`, `class?`) plus a slot for
the next action. Say what is missing and give the action that fixes it. Reserve
`ornament` for significant first-use screens.

### Disclosure

`disclosure` on a `<details>`: panel (no outline) whose `<summary>` is at least
44px tall with a rotating chevron; the summary underlines under the pointer,
like `link-ghost`. Opening it reveals the content with the
menus' `panel-in` motion (no motion under reduced motion). Native keyboard
operation; no script. Use for
optional detail, not for navigation. A bare `<details>` text toggle (no panel)
is allowed for a small inline reveal.

### Dropdown and menu

`dropdown` on a `<details data-dismiss>` (closes on a pick, an outside click or
Escape; Escape, and a pick that leaves focus in the panel, return focus to the
summary) with a button-styled `<summary>` and a
`dropdown-panel` (`dropdown-end` aligns it right). Items are `dropdown-item`
links or buttons with an optional leading `Icon`; `aria-current` marks the
chosen one, `dropdown-item-note` adds a quieter second line,
`dropdown-item-danger` marks a destructive item (last), `dropdown-divider`
separates groups. The chevron is `chevron-right` with `dropdown-chevron`.

A dropdown menu puts `dropdown-tiles` (two `dropdown-tile` quick actions, an
icon over a short label) and labelled menu groups in the panel. The
organization switcher is one. Nested dropdowns are not part of the system.

`menu-list` is a list of links: a faint `--color-menu-hover` wash on hover, the
stronger `--color-menu-selected` wash and semibold text for `aria-current`, a
muted icon with room on both sides. `menu-label` heads a group in sentence
case. `menu-tree` on a `<details>` inside a list item folds a group open; its
children hang off a guide line. The sidebar navigation (`.app-nav`) is a menu
list: its items share these rules (spacing, washes, muted icons, 44px on a
coarse pointer) and only add their own motion and unread badge.

### Row menu

| Pattern | Use it when | Examples |
| --- | --- | --- |
| `<details class="row-menu" data-dismiss>` | The actions belong to one record and the panel can extend past its container. Use `.table-wrap-visible` in a table that can remain overflow-visible at all supported widths. | Tariffs and the Messages conversation header |
| `.case-menu[popover="auto"]` | An ancestor needs clipping or scrolling, or a dense workbench needs viewport-aware positioning on narrow screens. Use a button with `popovertarget` and initialize `initCaseMenus()` from `src/lib/ui/case-menu.ts`. | Current Month and the Dwellings table |
| `<details class="more-menu" data-dismiss>` | The actions belong to the page header. Use an icon summary for short lists, or a labelled `btn-secondary` summary with `.more-menu-wide` (dropdown width, and on phones it opens to the right) for the dwelling header. | Current Month and Dwelling detail |

All three open the same panel and items as the dropdown (`dropdown-panel`,
`dropdown-item`): one look for every action menu. A row menu's `<summary>` is a
small icon button (`icon-btn icon-btn-sm` in size, border, hover ring and
pressed fill; it stays pressed while its menu is open) without extra classes.

The [live menu examples](/design-system#row-menu) show each pattern. Give an
icon-only trigger a name that identifies the record or action group. A lone
header menu can use “More actions” when its heading supplies context. Links
and buttons use regular Tab order. `data-dismiss` closes disclosures with
Escape or an outside click. When an action closes a disclosure in place and
keeps the user on the page, return focus to the summary. Put destructive
actions last and use `.menu-danger`. Use `.menu-disabled` for unavailable
information without a tab stop. Inside a clickable `.row-link` table row,
add `.row-link-above` to the disclosure so it stays above the row's link.

### Confirmation dialog

Use `LockDialog.astro` for decisions that need a warning and an explanation,
such as locking a period or archiving a dwelling. Provide a unique `id`,
title, description, Cancel label, and a form with the specific action: a
`btn-danger` only when it destroys something that cannot be undone (archiving),
a `btn-primary` when it can be reversed (locking a period, which can be
reopened). The warning sits in an `icon-tile icon-tile-sm` with
`data-tone="warning"` (`alert-triangle` by default; the `icon` slot replaces
the icon). The component
associates its title and description with the native
`<dialog class="lock-dialog">`. A button with `data-open-lock-dialog` set
to the dialog ID opens it, closes its source disclosure, and moves focus to
Cancel. Cancel, Escape, and a backdrop click return focus to the opener or
the source summary. The [lock example](/design-system#lock-dialog) and
[archive example](/design-system#dwelling-actions) use local sample actions.

For a one-line "are you sure", put `data-confirm="…"` on the form or its submit
button instead: `src/lib/ui/forms.ts` asks in a modal card (the first sentence
is the title, the rest the text), with a confirm button that repeats the
submitter's label and Cancel focused. The confirm button is `btn-danger` when
the submitter is a danger button or carries `data-confirm-tone="danger"`. The
browser's own `confirm()` is not used; the remaining exceptions are the
synchronous discard prompts of the workbench drawer, the tariff drawer and the
invoice template editor.

### Modal

Modals stop the page, so use them sparingly. Both are native `<dialog>`
elements opened with `showModal()` and named by `aria-labelledby`; Escape and a
close button (`icon-btn icon-btn-ghost` in a `<form method="dialog">`) end
them.

- `modal-card`: `modal-card-head` (icon, `<h2>`, close), `modal-card-body`
  (scrolls), `modal-card-foot` (the primary action, then `btn-ghost` to
  leave). `modal-card-centered` stacks an icon, a Fraunces title and short text
  in the middle, with the close button in the corner.
- `modal-full`: the whole screen in the canvas colour at 86% over a 24px blur,
  one message in `modal-full-body` and the close button in the top corner. For a
  moment that deserves the full stop: the setup review page shows it once per
  organization (remembered in local storage) when set up is complete.

### Tooltip

One shared tooltip (`Tooltips` calls `installTooltips`, include it once per
layout) shows for `[data-tip]`, clipped text (`data-tip-clipped`),
`.icon-btn[aria-label]` and `.row-menu > summary[aria-label]`. It is a light
square: `--color-surface-raised`, a hairline and `--elevation-overlay`, with no
arrow. A pointer waits 400ms, then the next tooltips along a row show at once;
keyboard focus shows it at once. Variations on the target:
`data-tip-tone` (info, success, warning, danger) tints it with the tone pair,
`data-tip-placement` (`left`, `right`, `bottom`) moves it when it fits, and
`data-tip-delay` (ms) holds it back where the pointer easily crosses it by
accident (keyboard focus still shows it at once). A tooltip that does not fit
on its side flips and stays inside the viewport. Touch has no tooltip, so the text must
never be the only place information lives. Don't add one to a control with a
visible label. Known gap: the truncated current breadcrumb shows its full text
only on hover, because it is not focusable.

### Icon and skip link

`Icon` (`name`, `size?` xs 16, sm 18, md 20, lg 24, `class?`) renders a Tabler
outline icon as decoration with `aria-hidden`; the control that contains it
supplies the accessible name. `skip-link` is the first focusable element on the admin
and resident layouts and moves focus to the main content (the auth layout has
none).

### Drawer

`AdminContextDrawer` (`organizationId`, `periodId`, `periodStatus`,
`periodName`, `workbenchPath`, `refreshSelectors?`) and `.context-drawer`: a
native modal `<dialog>` that slides from the right (full width below `md`), with
a named heading, scrollable body, close button (`context-drawer-close`) and
wrapping footer actions. Save results are announced through the
`#workbench-announcer` status region, not by the body; a load error appears in
the drawer's meta line.
Uses `--elevation-modal-side` and `--color-surface-raised`. Focus returns to the
trigger; Escape closes; unsaved edits are the controller's job.

### Mutation status

`MutationStatus` renders the saving, saved and needs-attention `.mutation-summary`
pill toasts and the recent-changes panel for admin actions (ADR 0005). Messages
are translated strings. States: saving, saved, needs attention (retry, dismiss),
and verifying or outcome-not-confirmed (check again). Retry and dismiss are 24px
tall, 44px on coarse pointers. Live region semantics belong to the component;
pages only register mutations.
The chip is hidden at idle, shows a full saved pill for four seconds after the last pending save, then fades out over 150ms (no fade with reduced motion); an open panel, hover or keyboard focus keeps it visible, and announcements use an always-rendered visually hidden live region.
The [Notice specimen](/design-system#notice) mounts the same activity inline.
Start a local sample save to open Recent changes and exercise Retry, Dismiss,
or Check again.

### Copy fields

`initCopyButtons()` (`src/lib/ui/copy-field.ts`) drives progressive-enhancement
copy buttons (`[data-copy-value]`, `[data-copied-label]`) for resident
bank-transfer details (`[data-copy-scope]`) and design-system specimens,
writing to `navigator.clipboard`, debouncing the 2s button label confirmation,
and announcing success or manual-copy fallback through `[data-copy-status]`.

### Navigation chrome

`AppNavigation` (`organizationId`, `unreadMessages?`) is the single sidebar nav
with `aria-current="page"` and an unread badge. `OrganizationSwitcher`
(`organizationId?`, `organizationName?`, `organizations`, `residentAccess`) is a
dropdown menu at the top of the sidebar: tiles for all organizations and the
resident view, then the organizations; Escape closes it and returns focus to
the trigger. The trigger is a dropdown trigger: a `btn-secondary` summary (the
hover ring and pressed fill) laid out as an info `icon-tile`, the name and the
chevron. `SidebarAccount` (`email?`, shown with an `avatar`), `ThemeToggle`
(`data-theme-toggle`) and `LanguageSwitch` make up the account block. Sidebar
links are menu-list items. Below `lg` the same nav lives in
the mobile drawer.

### Setup wizard

`SetupLayout` (`title`, `description?`, plus the step props) wraps a step in the
guided setup; `SetupSteps` (`organizationId`, `current`, `steps`) shows the
trail: complete, current and upcoming steps are distinguished by icon and text
as well as color. On phones the step titles are hidden, leaving the numbered
row of icons, and the current step's title appears above it.

`SetupProgressPanel` is the dashboard entry point for unfinished setup.
Pass ordered steps with their localized title, destination and saved completion
state, plus the locale and a unique heading ID. The summary displays the
completed count and links to the first unfinished step. Each row is a link with
a visible Done, Next step or To do label. The current row also uses
`aria-current="step"` and the active navigation surface token. The summary sits
beside the checklist at a panel width of `40rem` or more and above it at
narrower widths. The checklist retains all labels and links at every width.
See the live specimen at `/design-system#setup-progress`.
The [setup wizard specimen](/design-system#setup-wizard) uses the production
`SetupLayout` and `SetupSteps`. Follow the trail to see how the desktop
sidebar becomes the numbered phone row.

### Manual payment form

`ManualPaymentForm` (`organizationId`, `invoices`, `dwellings`, `today`,
`error?`, `idPrefix?`) is the reference use of the form field pattern: every
control has a `field-label`, errors use `FieldError` with ids built from
`idPrefix` so two copies on one page do not collide, and the reference field
links a `field-hint`.
The [admin payments specimen](/design-system#admin-payments) uses the same
form and history table as Payments. It includes bank and cash records,
payment confirmation, and reversal. The history retains its money-first
card order on phones.

## Patterns

Layout is built from three shells, a few width tokens and a handful of grid
recipes. There is no 12-column grid: each screen is a stack of full-width
regions, and a region decides its own columns. Where a section below describes
a rule for new work and a view does not follow it yet, the exception is named.

### Shells

| Shell | Used by | Structure |
| --- | --- | --- |
| Admin | everything under `/admin/o/<org>` | From `lg`: fixed 15rem sidebar (`AppNavigation`, organization switcher, account block) and a content area with `margin-left: 15rem`. Below `lg`: no sidebar; a top bar (`admin-mobile`) opens the same navigation in a drawer capped at 320px. The content area pads `--gutter` at the sides and 6rem below, and 2rem above from `lg`, 1.5rem from `sm` to `lg`, 1.25rem below `sm`. It stops at `--width-shell`. The layout renders the skip link and breadcrumbs. |
| Resident | `/portal` | No sidebar. A header holds the brand, theme and language toggles and the profile link; the text nav (`resident-nav`) is the first thing in `<main>`. One centered column at `--width-reading`, padded by `--gutter`. It is the same layout at every width. |
| Auth | `/login`, password reset | A centered card (`max-w-(--width-narrow)`). Language and theme controls are positioned absolutely in the top-right corner. An architectural line drawing sits behind the card from `md` and is hidden below. |

The admin and resident shells never mix: the resident shell has no admin
chrome, and a resident route must not render `.admin-sidebar`.

### Widths

| Token | Value | Used by today | Intended use |
| --- | --- | --- | --- |
| `--width-narrow` | 28rem | Auth and error cards (`max-w-(--width-narrow)`). | Auth card, single-purpose forms. |
| `--width-reading` | 50rem | Resident column and header. | Resident column, prose pages. |
| `--width-wizard` | 76rem | Guided setup. | Guided setup. |
| `--width-content` | 94rem | The dashboard. | Standard admin pages. Other admin pages currently fill `--width-shell`. |
| `--width-shell` | 110rem | The admin content area. | Outer cap of the admin content area. |

Content shrinks with its container. None of the audited views overflows
horizontally at 320, 390, 768, 1024 or 1440px (see Verification for what is and
is not audited).

### Responsive behavior

| Width | Admin shell | Tables | Grids and drawers |
| --- | --- | --- | --- |
| below `sm` (640px) | Top bar and drawer nav; gutter 16px | `stack-table` rows become labelled cards; other tables scroll in `table-wrap`; bulk select-all is not offered | One column for most forms (setup charges and some dwelling forms keep two); metric strips two columns; drawers full width |
| `sm` to `md` (768px) | Top bar; gutter 24px | Tables with room; wide ones scroll | Forms two-up; card grids reflow with auto-fit; drawers full width |
| `md` to `lg` (1120px) | Top bar; gutter 24px | Normal | Metric strips four columns; context drawers at their own width; the sidebar is still a drawer |
| `lg` and up | Persistent sidebar; fluid gutter | Normal | Full layouts: dashboard two columns, setup trail as a side column |

Choose a layout by the room the region has, not only by the screen. A region
beside the 15rem sidebar has 240px less than the screen, so a wide two-pane
layout uses a container query on its own wrapper (the dwelling detail does this
at 60rem) instead of adding a breakpoint.

### Grid recipes

- **Card grid.** `grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr))`
  with `gap-6`: as many columns as fit, one on a phone. The
  dwelling summary uses `minmax(13rem, 1fr)`; use the `min(100%, …)` form in new
  code so a narrow container cannot overflow.
- **Metric strip.** `metric-strip` and `--metrics`: one surface, dividers, four
  columns from `md`, two below. Use it for three to five figures that belong
  together; use `KpiCard` for a figure that stands alone.
- **Two-pane.** `minmax(0, 1fr)` plus a fixed side column (26rem on the dwelling
  detail). Collapse to one column with a container query when the region is
  narrower than the two panes need. Hide the wrapper, not just the grid, when
  the content is filtered away.
- **Form grid.** Two columns of fields from `sm`; one below, with the exceptions
  above. Fields keep `gap-4` between them and their label `--gap-label`
  above (`gap-3` appears in older forms).
- **Stack.** The default: `space-y-6` between regions,
  `space-y-4` inside a panel.

### Table to card

Wrap the table in `stack-table` for lists a phone user reads row by row. Below
`sm` each `tr` becomes a card with the column header as a label (`data-label`).
Put the row's primary link first and keep action cells last. Use a plain
`table-wrap` scroll for dense reference tables where comparing columns matters.
The setup readings table defines its own card layout without header labels.

### Composition rules

These are the rules for new views. Existing exceptions: the dashboard, dwelling
detail and period workbench build their own headers instead of `PageHeader`; the
dashboard's setup card sits above its header; dwelling panels contain
`table-wrap` panels.

- One `h1` per view, directly under the breadcrumbs.
- Order inside a view: header and actions, then any notice, then filters, then
  the content. A notice goes above the content it describes.
- One `btn-primary` per region; the page's main action sits in the header.
- Panels are flat and not nested. Group figures in a metric strip, not in
  cards of cards.
- Empty and error states replace the content region and keep the header.
- A destructive action lives away from the main action, behind a confirmation.

### Core view recipes

**Login and auth.** Auth shell. The login page holds two sign-in forms in one
column: resident (email, sign-in link, the page `h1`) and admin (email and
password). Messages are `notice` paragraphs above each form, `notice-danger`
with `role="alert"` and `notice-success` with `role="status"`. The page renders
no `field-error` (an exception to the field pattern, as is the password reset
page, which shows one form-level alert; the in-app forms follow the pattern).
Below `md` the line drawing is hidden.

**Admin dashboard.** Width `--width-content`. `SetupProgressPanel` comes first when
setup is unfinished, then the dashboard header with `.period-nav` (a
period with no neighbour gets no placeholder button). `.collection-card` leads
with the amount paid on invoices and the collection share. The billing total,
unpaid balance and overdue balance sit below `.collection-bar`. `.collection-ledger`
with `.money-ledger` sits beside these figures and becomes a disclosure via
`initCollectionLedgers()` that starts closed when the card is narrower than
32rem (a container query). `.month-status` includes readings and takes the full
width under the card; `.month-progress` steps run four across while the section
is at least 48rem wide (a container query) and two below.
The grouped `.attention-list` sits in one column below.

**Dwellings list.** Header with export, import and create actions, a `toggle-tabs`
view switch (`Table` / `Building`), then either:
- **Table view:** `filter-bar`, a `stack-table` of dwellings with an ascending sort
  arrow in `Number`, `table-occupant` avatar + name cells, `row-link` rows,
  `.case-menu` top-layer popover actions and `PaginationBar`; cards below `sm`.
- **Building view:** `BuildingView` / `BuildingEditor` visual facade organized by
  entrances and floors, `MISSING_DATA` dashed tiles, `OVERDUE` danger tiles,
  optional Arrange drag/keyboard mode, and borderless `.building-strip` /
  `.building-unplaced` trays.

**Dwelling detail.** A summary strip (`dwelling-summary`, four figures, two
columns below `md`) with the balance first, then six tabs: Overview, Account
balance, Meters, Recurring tariffs, Messages and History. A tab shows only its
own panel and is kept in `?tab=`. Overview is basic information on the left
and invoice delivery and portal access in a 26rem column beside it, once the
page area is at least 60rem (a container query on `[data-dwelling-detail]`);
below that, one column. Editing is in place: an Edit or Add link
(`?tab=…&edit=<key>`, so it works without the script) turns its panel or row
into the form in normal flow, one editor at a time; Cancel and Escape put the
saved values back and return focus to the link. Saves go through
`mutate-form`, so typed input survives an error, and an add, remove or money
change refreshes only its own section.
The [Dwelling summary specimen](/design-system#metric-strip) uses the same
`DwellingSummary` component and shows how the four figures wrap into two
columns on phones.

**Payments.** A metric strip of the totals, a review queue of payments that need
a decision, then the history table with a date and status filter. Each payment
links to its own page that explains where the money went. Tables stack into
cards below `sm`; the ledger is a separate page.

**Current month and periods.** The periods list uses `KpiCard` totals and a
`stack-table` with `PaginationBar`. A period page opens with a header row:
title and status on the left; `.period-nav` (44px joined previous/next period
control), then the period actions on the right (wrapping to their own row when
needed). Below sits `.financial-summary`, then the billing workbench: a search
field, wrapping `.workflow-rail` stage tabs, the `.table-compact` queue with a
select-all checkbox and sticky/mobile-fixed `.bulk-toolbar`
(`--elevation-raised`), `.status-text` for routine stages, `.mid-truncate`
problem links, native `popover="auto"` `.case-menu` row actions, and
`AdminContextDrawer` for editing one case. The table has no minimum width;
below 54rem of panel width (`@container`), each case becomes three short lines
and select-all is omitted.

[Billing workbench specimen](/design-system#workbench) uses the same queue
styles, readiness strip, search, bulk toolbar, and drawer as Current Month.
Use **Narrow queue** to see the three-line layout, **+1** to open a hidden
readiness item, and **Enter readings** or **Fix billing details** to save and
refresh sample rows. The period disclosures include an example of skipped
invoices. The specimen uses in-memory data for all edits and bulk actions.
The selection controller counts eligible invoices, measures the pinned
toolbar, and announces the counts using complete localized sentences.

**Tariffs and rules.** Header with Help and New tariff actions, `filter-bar` with
Search, Type, Status and Show archived checkbox, and `.table-wrap-visible`
containing `.rules-table` (a `container: rules-table / inline-size` grid that
turns rows into cards below 50rem while rounding outer header/last-visible-row
corners on wider screens). Saves, on/off toggles, archives and restores highlight
updated rows with `.row-changed` / `.row-changed-still` and pair quick toggles
with an inline status + Undo action. Edits open in `.context-drawer`.
The [tariff specimen](/design-system#tariffs) uses the production
`TariffDrawer` and table styles. Narrow the table to exercise its container
query. The sample drawer demonstrates calculation and scope fields, the VAT
preview, and a local save.

**Dashboard.** The [KPI topic](/design-system#kpi-card) pairs the collection
`.dashboard-metric` with an attention panel using
`.dashboard-section-heading`. Both use the same styles as the main dashboard.

**Invoice template editor.** The [invoice editor specimen](/design-system#invoice-editor)
uses the same layout and editor script as the admin settings page. The language
selector updates editable text and the preview together. Sections expand and
reorder, row options open in `.tpl-popover`, and `.tpl-savebar` tracks edits.
The separate document example uses `InvoicePreviewFrame`, also used by the
admin and resident invoice routes.

**Meter list.** The [meter specimen](/design-system#meter-list) and Dwelling detail
use the same visibility controller for Active and Archived. The controller
updates pressed state and the empty message as well as hiding rows.

**Admin messages.** The [messages specimen](/design-system#admin-messages) uses
the same list, thread and reply styles as the inbox. The shared
`bindInstantFilter()` waits 300ms after search input and submits immediately
when a select or checkbox changes. Dwellings uses the same filter behavior.

**Invoice delivery.** The [delivery specimen](/design-system#invoice-delivery)
uses `InvoiceDeliveryHistory` to show an unconfirmed email, a failed email,
and a paper dispatch using the same status language as the invoice page.

**Setup wizard.** `SetupLayout` at `--width-wizard`: a step trail (a 13.5rem
column from `lg`, a three-column grid from `sm` to `lg`, a single row of
numbered icons on phones), then the step content at up to 52rem. One primary
action per step; errors keep the user's input and focus the first invalid field.

**Resident portal.** Resident shell with scoped styles in `resident.css`. One
column: latest published bill and remaining balance, then this month's meter
readings; history lives in disclosures below. Use 18px body text, at least 16px
instructions and `--control-size-lg` (48px) form controls. The invoice page puts bank-transfer details
above the document, with copy buttons (`[data-copied]`) and an optional QR for the remaining
balance. The document preview omits its original-amount QR; stored PDFs keep
their original rendering. See [Resident portal redesign](RESIDENT_PORTAL_REDESIGN.md).

Every resident page starts at the left edge of the tabs; the header uses the
same column. Sign out is in the header. A back link (`.resident-back`) is used
only where the tabs do not lead. Disclosures are panels with a chevron
(`.resident-details`). Invoice link rows use `ResidentInvoiceList`
(`.resident-list`), and the dwelling picker renders matching `.resident-list`
links. Contact administrator is
one chat (`.resident-chat`): resident on the right, administrator on the left,
one message box. Motion is color and opacity only, 140-220ms, and off under
reduced motion.
The [Resident portal specimen](/design-system#resident-portal) uses the shared
back link, reading cards, history disclosure, QR disclosure, and composer.
Submit a sample reading or message to see the local result. The sample QR
encodes plain text.

**Invoice view.** The page is a header and actions around an `<iframe srcdoc>`
that shows the invoice as standalone HTML (`src/domain/billing/invoice-html.ts`,
fixed light colors, its own `.parties` block of two flex columns with no
breakpoint). The page actions are print (resident) and, for admins, preparing
the invoice; they are hidden when printing. The layout
matrix audits the page around the frame, not the document inside it.

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
`npx playwright test tests/e2e/design-system.spec.ts tests/e2e/dark-mode.spec.ts tests/e2e/layout-matrix.spec.ts`.
The focused browser checks cover responsive reference layout, theme persistence,
real product field states, keyboard operation and live token readouts.

`layout-matrix.spec.ts` sweeps the core views (login, dashboard, dwellings and
dwelling detail, payments, periods and current month, setup, invoice view and
the resident portal) at 320, 390, 768, 1024 and 1440px in both themes. Each page
is checked to be the one requested (status and final URL) before it is audited.
Disclosures are opened first. It fails on:

- horizontal overflow;
- a control below 44px on a coarse pointer (checked in a touch context that is
  confirmed to match `(pointer: coarse)`), or any target below 24px with another
  target inside its 24px circle (WCAG 2.5.8). A link inside a sentence and a
  stretched row link are exempt; a bare checkbox with no label is held to 24px;
- a missing keyboard focus indicator among the first 12 tab stops of the main
  content at each width and theme.

It also checks the exact `sm` and `lg` breakpoint edges, the dwelling overview's two
columns at 60rem of container width (959 and 960px host widths), and the contrast of the semantic token
pairs (text 4.5:1, field border and focus ring 3:1) in both themes. It needs the
local Supabase stack with demo data and the local mailbox; it logs in as admin
once and requests one resident sign-in link per run (the auth rate limit is 5
per minute).

Not covered: dialogs and drawers (they need an interaction), the invoice
document inside its iframe, focus beyond the first tab stops, system-preference
theme changes, authenticated workflows beyond these pages, screen-reader use,
Safari and iOS devices, and any view the demo seed has no data for.

After changing code, run `graphify update .` to refresh the repository graph.
