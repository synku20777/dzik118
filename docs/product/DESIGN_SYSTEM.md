# Namkopa design system

The runtime contract lives in `src/styles/global.css`. `/design-system` renders
the shared CSS and Astro components, lists source declarations and component
files, and resolves color values from the active theme. Its inventories describe
what exists; they do not certify accessibility or workflow coverage.

## Foundations

- Keep the Riga palette: limestone surfaces, Daugava actions, verdigris success,
  amber warnings and brick errors. Use semantic `--color-*` variables in UI.
- `--color-border` separates panels and tables. Form fields use
  `--color-input-border`, including the Tailwind utility
  `border-(--color-input-border)`. Do not put `border-border` on a field.
- `--color-focus-ring` is opaque. Keyboard focus needs a visible outline;
  never suppress it without an equivalent indicator. Invalid fields use
  `aria-invalid="true"` plus error text linked through `aria-describedby`.
- Switzer and Overused Grotesk remain the UI faces; Fraunces is for selected
  display moments. Body tracking is neutral, small text uses `--tracking-small`,
  headings use `--tracking-heading`. Explicit display/numeric tracking remains.
  Display roles use `--tracking-display`, including combinations with type utilities.
- Use the `--space-*` scale (4, 8, 12, 16, 24, 32, 48, 64px at the default root
  size), and the badge/input/control/panel radius tokens. Geometry uses `rem`
  so controls and spacing follow the user's text size.
- Ordinary panels stay flat. Elevation is reserved for overlapping menus,
  raised context and modal drawers.
- Themes apply to the document root through `data-theme` or the system color
  preference. Nested theme containers are outside the component contract.

## Shared components and classes

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

## Verification

Run `npm test`, `npm run build`, and
`npx playwright test tests/e2e/design-system.spec.ts tests/e2e/dark-mode.spec.ts`.
The focused browser checks cover responsive reference layout, theme persistence,
real product field states, keyboard operation and live token readouts. They do
not replace authenticated workflow tests, screen-reader testing, or Safari/iOS
device testing.

After changing code, run `graphify update .` to refresh the repository graph.
