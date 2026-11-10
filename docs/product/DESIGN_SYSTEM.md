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
| `--color-surface-raised` | Background of elevated surfaces: toasts, menus, popovers, dialogs, drawers (tooltips and the bulk-action toolbar keep their own fill). Equal to surface in light mode, one step lighter in dark mode, where shadows cannot show depth. |
| `--color-foreground` / `--color-muted` | Text, and secondary text. Muted keeps 4.5:1 on canvas and surface. |
| `--color-border` | Panel, table and divider hairlines. |
| `--color-input-border` | Field boundary. Deeper than `--color-border` so a field edge meets 3:1 (WCAG 1.4.11) on canvas and surface. Place fields on those two; on `--color-surface-hover` or table headers the edge falls to about 2.9:1. Never `border-border` on a field. |
| `--color-primary` (+ `-hover`, `-active`, `--color-on-primary`) | Actions, links, navigation. In dark mode primary is a pale tint, so `--color-on-primary` is dark. |
| `--color-secondary`, `--color-success`, `--color-warning`, `--color-destructive` | Meaning colors for text and fills. Only destructive has `-hover` and `-active` variants. |
| `--color-positive-secondary` | Quiet positive state (pine), for example gas meters and credits. |
| `--color-focus-ring` | Opaque focus outline. |
| `--color-backdrop` | Scrim behind dialogs and drawers. |

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

Known exception: the `/design-system` page's own illustration (hero lockup, the
stat figure and the miniature shell diagrams) uses bespoke sizes because it is
illustration, not product UI.

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
| `--gutter` | 16px; 24px from `sm`; fluid 34 to 48px from `lg` | Page edge padding. |

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
  press apply only to enabled controls. Buttons and fields change color on
  press and do not move; navigation chrome (sidebar links, sign-out, the theme
  toggle's icon, the organization trigger) may scale slightly. Links and tabs
  have hover and current states only.
- **Touch.** The minimum target is 44px (`--control-size-md`). Compact (36px)
  controls expand to 44px under `@media (pointer: coarse)`.
- **Focus.** A 2px `--color-focus-ring` outline from the base layer. Do not
  remove it; do not rely on color alone for any state.
- **Names.** Icon-only controls need `aria-label`; the shared tooltip shows it.
  Use sentence case and the verb for the action ("Save changes", then "Saved").
- **Disabled.** Prefer omitting an action with no destination. A disabled link
  needs `aria-disabled="true"` and the caller must suppress navigation.

### Button

`btn-primary` (the one main action of a view), `btn-secondary`, `btn-danger`
(destructive and irreversible), `btn-ghost` (low emphasis). Sizes: default
44px, `btn-sm` 36px (44px on coarse pointers), `btn-lg` 48px.

- States: hover and active fill per variant; `disabled` or `aria-disabled`
  at 45% opacity; `aria-busy="true"` sets the progress cursor. The caller owns
  duplicate-submit prevention.
- Use a `<button>` for actions and an `<a>` for navigation.
- Do: one `btn-primary` per view region. Don't: stack two primaries, or use
  `btn-danger` for a confirm that is not destructive.

### Icon button

`icon-btn` (44px), `icon-btn-sm` (36px, 44px on coarse pointers),
`icon-btn-danger` (hover and press tint to destructive). Always `aria-label`.
Don't use it for an action that has room for a visible label.

### Button group

`ButtonGroup` (`label?`, `class?`) joins related `btn-*` links, buttons or a
`<details>` menu into one control with `role="group"`. Name the group when its
purpose is not clear from the buttons.

### Form field

Parts: `field-label`, the control (give it `mt-1`, which is `--gap-label`),
optional `field-hint`, optional `FieldError` (`error`, `name`, `id?`) which
renders `field-error` with `id="<name>-error"` and `role="alert"`. Pass `id`
when the control's id is not the field name, for example a form rendered twice
on one page; it must be `<control id>-error`. `FieldError` renders nothing for
an empty message list.

- Controls (input, select, textarea) are styled by the base layer: 44px
  minimum height, `--color-input-border`, `--radius-input`, placeholder in
  muted. Use utilities for width and spacing only; do not restyle the border,
  radius or padding. Checkbox and radio are 16px with an `accent-color` of
  primary; put them in a `check-row` label so the whole 44px row is the target.
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

### Status badge

`StatusBadge` (`status`: a domain status). The mapping in
`src/lib/ui/invoice-status.ts` supplies label, tone and icon; the markup is
`status-badge` with `data-tone` of neutral, info, success, warning or danger.
Colors are the `--tone-*` pair. State is carried by icon and text, never color
alone; forced-colors mode draws a system-color outline.

### Notice

`notice` (info), `notice notice-warning`, `notice notice-danger` on a `<p>` or
`<div>`. Tone pair from `--tone-*`.

- Accessibility: add `role="alert"` for a danger notice that appears after an
  action, `role="status"` for other notices that appear after an action. A
  notice present at page load needs no role. Say what happened and what to do.
- Don't use a notice for a validation message next to a field (use
  `field-error`) or for transient confirmation (use MutationStatus).

### Panel, metrics and KPI

- `panel` is the default container: surface, 1px border, `--radius-panel`,
  flat. Pad it with `--pad-panel` (`p-6`) or `--pad-panel-compact` (`p-4`).
- `table-wrap` is a panel that scrolls horizontally.
- `metric-strip` with `metric`, `metric-label`, `metric-value`, `metric-note`
  (`--metrics` sets the column count, default 4; 2 columns below `md`);
  `data-tone` of success or warning colors the value. One surface, dividers
  between figures.
- `KpiCard` (`label`, `value`, `tone?` neutral, success, warning or danger,
  `icon?` invoice, coins, clock, open or lock, `hint?`): a summary figure with
  tabular numerals; not clickable.
- A region that is loading carries `aria-busy="true"` and dims; announce the
  result through a status element, not by making the region live.
- `empty-state` can be used as a class without the component for a one-off
  empty region.
- Don't add a shadow to a panel; don't nest a panel in a panel.

### Data table

A `<table>` inside `table-wrap`: header cell `th` (semibold, no wrap, tinted
`--color-table-th-bg`), tabular figures, right-aligned numbers.

- Add `stack-table` to the wrapper to render each row as a labelled card below
  `sm`; the script copies column headers into `data-label`.
- Clickable rows: `row-link` on the `<tr>`, `row-link-target` on the one `<a>`
  that owns the row, `row-link-above` on independent controls inside the row.
- States: row hover tint, `:focus-within` outline.
- Accessibility: headers are `th`; give wide tables a caption or heading; never
  use a table for layout.

### Page header and breadcrumbs

`PageHeader` (`title`, `headingLevel` h1 default, `description?`, `eyebrow?`,
`display?`, `accent?`) and a default slot for actions (wrap them in
`page-actions`). `display` selects the Fraunces treatment for period and month
headings and the top-level admin index pages (dwellings, messages, rules).
`Breadcrumbs`
(`items`: `{ label, href? }`, last crumb has no `href`) is rendered once by the
admin layout, so pages only declare their trail. It is a `<nav>` named
"Breadcrumb" and marks the current page with `aria-current="page"`.

### Tabs and filter bar

`tabs` is a row of links to sibling views; the current one carries
`aria-current="page"`. Hover tints the others. These are navigation, not
`role="tab"` widgets. `filter-bar` groups labelled filter controls on a panel
surface and wraps; below `sm` its fields flex from 9rem and fill the width.

### Empty state

`EmptyState` (`title`, `description?`, `ornament?`, `class?`) plus a slot for
the next action. Say what is missing and give the action that fixes it. Reserve
`ornament` for significant first-use screens.

### Disclosure

`disclosure` on a `<details>`: bordered panel whose `<summary>` is at least
44px tall with a rotating chevron. Native keyboard operation; no script. Use for
optional detail, not for navigation. A bare `<details>` text toggle (no panel)
is allowed for a small inline reveal.

### Row menu

`row-menu` is a `<details>` whose `<summary aria-label>` is a dots button (36px,
44px on coarse pointers) opening a small floating menu (`--elevation-raised`,
`--color-surface-raised`) of actions for one row. Used by the dwellings,
messages and rules lists. The summary's `aria-label` names the action and the
shared tooltip shows it.

### Tooltip

One shared tooltip (`Tooltips` calls `installTooltips`, include it once per
layout) shows for `[data-tip]`, clipped text (`data-tip-clipped`),
`.icon-btn[aria-label]` and `.row-menu > summary[aria-label]`. A pointer waits
400ms; keyboard focus shows it at once. Touch has no tooltip, so the text must
never be the only place information lives. Don't add one to a control with a
visible label. Known gap: the truncated current breadcrumb shows its full text
only on hover, because it is not focusable.

### Icon and skip link

`Icon` (`name`, `size?` xs 16, sm 18, md 20, lg 24, `class?`) renders a Tabler
outline icon as decoration with `aria-hidden`; the control that contains it
supplies the accessible name. `skip-link` is the first focusable element on each
layout and moves focus to the main content.

### Drawer

`AdminContextDrawer` (`organizationId`, `periodId`, `periodStatus`,
`periodName`, `workbenchPath`, `refreshSelectors?`) and `.context-drawer`: a
native modal `<dialog>` that slides from the right (full width below `md`), with
a named heading, scrollable body, close button (`context-drawer-close`) and
wrapping footer actions. Loading results are announced through the
`#workbench-announcer` status region, not by the body.
Uses `--elevation-modal-side` and `--color-surface-raised`. Focus returns to the
trigger; Escape closes; unsaved edits are the controller's job.

### Mutation status

`MutationStatus` renders the saving, saved and needs-attention toasts and the
recent-changes panel for admin actions (ADR 0005). Messages are translated
strings. States: saving, saved, needs attention (retry, dismiss), and
verifying or outcome-not-confirmed (check again). Retry and dismiss are 24px
tall, 44px on coarse pointers. Live region semantics belong to the component;
pages only register mutations.

### Navigation chrome

`AppNavigation` (`organizationId`, `unreadMessages?`) is the single sidebar nav
with `aria-current="page"` and an unread badge. `OrganizationSwitcher`
(`organizationId?`, `organizationName?`, `organizations`, `residentAccess`) is a
disclosure menu at the top of the sidebar; Escape closes it and returns focus to
the trigger. `SidebarAccount` (`email?`), `ThemeToggle` (`data-theme-toggle`)
and `LanguageSwitch` make up the account block. Below `lg` the same nav lives in
the mobile drawer.

### Setup wizard

`SetupLayout` (`title`, `description?`, plus the step props) wraps a step in the
guided setup; `SetupSteps` (`organizationId`, `current`, `steps`) shows the
trail: complete, current and upcoming steps are distinguished by icon and text
as well as color. On phones the step titles are hidden, leaving the numbered
row of icons, and the current step's title appears above it.

### Manual payment form

`ManualPaymentForm` (`organizationId`, `invoices`, `dwellings`, `today`,
`error?`, `idPrefix?`) is the reference use of the form field pattern: every
control has a `field-label`, errors use `FieldError` with ids built from
`idPrefix` so two copies on one page do not collide, and the reference field
links a `field-hint`.

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
