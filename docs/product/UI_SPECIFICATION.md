# Riga Property Billing — Full UI Specification

## 1. UI Design Principles

The interface should be a **contemporary Baltic civic product**: calm, highly functional, structurally rigorous, warm rather than sterile, and visually distinctive without decorative excess.

Architectural references should appear primarily through **construction rather than ornament**:

- Contemporary Baltic restraint → layout, spacing, data density, usability.
- Medieval/Hanseatic structure → grids, hierarchy, dividers, alignment.
- Wooden Riga → warm surfaces, residential softness, tactile neutrality.
- Jugendstil/National Romanticism → selective curves, display typography, icons, and rare ornamental details.

From a distance, the product should appear modern and functional. Riga-specific characteristics should become apparent only through typography, material palette, geometry, linework, icon details, and selected accent treatments.

---

# 2. Color System

## 2.1 Foundation Palette

| Token | Hex | UI role |
|---|---:|---|
| `limestone-50` | `#F7F4EE` | Main light canvas |
| `limestone-100` | `#EEE8DE` | Secondary/subtle surfaces |
| `limestone-300` | `#D5CEC2` | Borders and separators |
| `ink-900` | `#17242B` | Primary light-mode text |
| `daugava-700` | `#274B5B` | Primary brand/action color |
| `daugava-600` | `#35677A` | Secondary interaction/chart color |
| `verdigris-700` | `#1F5955` | Success / strong brand state |
| `verdigris-600` | `#2F736D` | Secondary brand |
| `verdigris-200` | `#BFD8D1` | Tinted success surfaces |
| `brick-700` | `#783529` | Strong destructive/error |
| `brick-600` | `#9A493A` | Error/accent |
| `brick-200` | `#E5C2BA` | Error background |
| `amber-700` | `#7C470F` | Warning text/fill |
| `amber-500` | `#C17B26` | Warning graphic accent |
| `amber-200` | `#E8C99A` | Warning background |
| `pine-700` | `#38452B` | Deep natural accent |
| `pine-600` | `#4F5D3A` | Positive secondary state |
| `pine-200` | `#CBD1BC` | Pale positive background |
| `night-950` | `#0E1517` | Dark canvas |
| `night-900` | `#151F21` | Dark surface |
| `night-800` | `#1E2B2E` | Raised dark surface |



## 2.2 Light Mode Tokens

```css
--bg-canvas:       #F7F4EE;
--bg-surface:      #FFFCF7;
--bg-subtle:       #EEE8DE;

--text-primary:    #17242B;
--text-secondary:  #58666C;

--border-default:  #D5CEC2;

--brand-primary:   #274B5B;
--brand-secondary: #2F736D;

--success:         #1F5955;
--warning:         #7C470F;
--danger:          #783529;
```

The default visual environment should use **warm mineral neutrals rather than cool generic SaaS grey**.

## 2.3 Dark Mode Tokens

```css
--bg-canvas:       #0E1517;
--bg-surface:      #151F21;
--bg-subtle:       #1E2B2E;

--text-primary:    #F2EEE6;
--text-secondary:  #B7C0BD;

--border-default:  #3D4A4D;

--brand-primary:   #BFD1D7;
--brand-secondary: #BFD8D1;

--success:         #BFD8D1;
--warning:         #E8C99A;
--danger:          #E5C2BA;
```

Dark mode should resemble dark stone and oxidized metal rather than absolute black. Use surface differentiation and borders more heavily than shadow.

## 2.4 Semantic Color Mapping

```text
Daugava     → action / navigation
Verdigris   → success / resolved
Amber       → attention / warning
Brick       → error / destructive
Pine        → positive secondary state
Limestone   → structure / neutral surfaces
```

Do not assign semantic meaning directly from historical/material associations; maintain a predictable operational system.

---

# 3. Accessibility Requirements

Minimum contrast targets:

- Normal text AA: **4.5:1**
- Normal text AAA: **7:1**
- Qualifying large text AA: **3:1**
- Graphical/UI component states and boundaries: **3:1** against adjacent colors

Validated core combinations:

| Foreground | Background | Contrast |
|---|---|---:|
| `#17242B` | `#F7F4EE` | 14.45:1 |
| `#58666C` | `#F7F4EE` | 5.42:1 |
| `#FFFCF7` | `#274B5B` | 9.15:1 |
| `#FFFCF7` | `#35677A` | 6.08:1 |
| `#FFFCF7` | `#2F736D` | 5.41:1 |
| `#FFFCF7` | `#9A493A` | 6.06:1 |
| `#FFFCF7` | `#7C470F` | 7.42:1 |
| `#FFFCF7` | `#4F5D3A` | 6.93:1 |
| `#F2EEE6` | `#0E1517` | 15.94:1 |
| `#B7C0BD` | `#0E1517` | 9.92:1 |

`amber-500 #C17B26` should not be used as a white-text button. Use `amber-700` for warning text/button fills; reserve brighter amber for charts, markers, and graphical accents.

Never rely on color alone for state communication. Combine color with text, icons, line indicators, or another perceptible state marker.

---

# 4. Typography

## 4.1 Primary UI Typeface

**Source Sans 3**

Use for:

- navigation
- tables
- forms
- invoices
- numerical data
- buttons
- descriptions
- resident UI
- dense administration

### Type Scale

| Style | Size / Line Height | Weight |
|---|---|---:|
| Caption | 12 / 16 | 500 |
| Label | 13 / 18 | 600 |
| Body Small | 14 / 20 | 400 |
| Body | 16 / 24 | 400 |
| UI Strong | 16 / 22 | 600 |
| Heading 3 | 20 / 26 | 600 |
| Heading 2 | 28 / 34 | 600 |

Functional UI must remain in the sans-serif system.

## 4.2 Display Typeface

**Fraunces**

Use selectively for:

- product wordmark
- major period/month headings
- marketing surfaces
- annual/financial reports
- selected dwelling numbers
- empty-state titles

Example:

```text
October 2026
Fraunces
40 / 44
550–600

Billing workflow
Source Sans 3
18 / 24
650
```

Do **not** use Fraunces for:

- table cells
- form fields
- buttons
- badges
- fine print



## 4.3 Latvian Typography QA

All selected fonts must be explicitly tested with Latvian diacritics and production strings such as:

```text
Īpašumu rēķini
Norēķinu periods
Ūdens patēriņš
Rēķina saņēmējs
Brīvības iela
Ķīpsala
Āgenskalns
Parāds
Pārmaksa
Soda nauda
```



---

# 5. Spatial System

## 5.1 Base Spacing Scale

Use an **8px base system** with intermediate values:

```text
4px    micro
8px    compact
12px   control internal
16px   standard
24px   component
32px   section
48px   large section
64px   page rhythm
96px   brand / marketing
```

## 5.2 Desktop Administration Layout

```text
Sidebar       240–256px
Main max      ~1440px
Grid          12 columns
Gutter        24px
Page padding  32–48px
```

Favor strong vertical alignment, structured columns, and clear top-to-bottom hierarchy.

---

# 6. Surfaces & Cards

## 6.1 Default Card

```css
background: #FFFCF7;
border: 1px solid #D5CEC2;
border-radius: 10px;
box-shadow: none;
```

Default cards should appear **set into the composition**, not floating above it.

Avoid:

- excessive cardification
- shadows on every surface
- heavily rounded SaaS panels



## 6.2 Elevation Tokens

```css
--elevation-0: none;

--elevation-1:
  0 1px 2px rgb(23 36 43 / 0.05),
  0 4px 12px rgb(23 36 43 / 0.04);

--elevation-2:
  0 2px 4px rgb(23 36 43 / 0.06),
  0 12px 28px rgb(23 36 43 / 0.08);

--elevation-overlay:
  0 8px 20px rgb(23 36 43 / 0.10),
  0 30px 80px rgb(23 36 43 / 0.14);
```

Usage:

- `elevation-0` → tables, normal cards
- `elevation-1` → menus, sticky toolbars
- `elevation-2` → raised contextual elements
- `elevation-overlay` → drawers and modals only

Dark mode should rely primarily on borders and surface contrast.

---

# 7. Buttons

## Primary

```text
Fill: Daugava slate
Height: minimum 40px
Radius: 8px
Weight: 600
```

Primary actions should **not** use fully pill-shaped geometry.

## Secondary

```text
Surface background
Stone border
Dark text
```

## Tertiary

```text
Text only
Underline and/or directional arrow on hover where appropriate
```

## Destructive

```text
Brick red
```

Amber is strictly a warning/attention color, not destructive.

---

# 8. Form Inputs

Default:

```css
height: 40px;
border: 1px solid #8F887E;
border-radius: 7px;
background: #FFFCF7;
```

Focus state:

```css
border-color: #274B5B;
box-shadow: 0 0 0 3px rgb(39 75 91 / 0.14);
```

Requirements:

- visible form labels above fields
- never use placeholders as labels
- logical field grouping
- consistent 40px control height where possible
- blockers/errors positioned close to affected fields



---

# 9. Tables

Tables should emphasize structural clarity.

Requirements:

- strong column alignment
- minimal zebra striping
- thin stone-colored borders
- tabular numerals
- state colors used only as small accents
- row height approximately **52–60px**
- 2px left-edge status/exception indicators
- no full-row red/green/blue backgrounds

Example:

```text
│ Missing data
│
│ Dwelling 7
│ Cold water missing
```

The narrow status line provides state emphasis without overwhelming dense data.

---

# 10. Status Chips

Avoid oversized, fully rounded SaaS pills.

Recommended:

```text
radius: 5–6px
padding: 3px 7px
small icon + text
```

Examples:

```text
! Missing data
✓ Prepared
↗ Sent
● Paid
```

Always communicate status through more than color alone.

---

# 11. Drawers

Drawers should be the preferred pattern for contextual administration tasks where preserving the underlying page context is useful.

## Desktop Drawer

```text
Width:               480–520px
Horizontal padding:  28–32px
Header:              sticky
Body:                independently scrollable
Footer:              sticky
```

Layout:

```text
PAGE                         DRAWER
│                            │
│ workbench                  │ Context
│ remains visible            │ DWELLING 3
│                            │
│                            │ Billing details
│                            │ Draft
│                            │
│                            │ ─────────────
│                            │ form
│                            │
│                            │ blockers
│                            │
│                            │ ─────────────
│                            │ Cancel  Save
```

Drawer requirements:

- labels above form controls
- related fields grouped into sections
- contextual entity identification near top
- blockers shown beside or near affected fields
- `Open full dwelling` or equivalent as low-emphasis secondary link
- sticky action footer
- maintain visible background context where screen width permits



---

# 12. Dwelling Detail Page

The dwelling detail view should have explicit hierarchy rather than a long sequence of equal-weight cards.

## Above-the-fold Structure

```text
← Dwellings

Dwelling 1                            [Quick actions ▾]

Resident household 1
Brīvības iela 118

€0.00 outstanding    Email ✓    2 meters

[Overview] [Account] [Meters] [Residents] [History]
```

## Quick Actions

Keep key administrator actions visible in the header:

```text
Enter readings
Create / review invoice
Add adjustment
Message resident
⋯
```

Users should not need to scroll through configuration or activity content before reaching frequent actions.

## Information Architecture

```text
Overview
    Billing details
    Delivery preferences
    Resident access

Account
    Balance
    Ledger
    Adjustments

Meters
    Active meters
    Add meter
    Meter history

Residents
    ...

History
    Periods
    Invoices
    Audit
```

Prefer tabs or well-defined sections over a continuous 1,500px-long configuration page.

---

# 13. Modals

Use modals sparingly.

Appropriate use cases:

- irreversible confirmation
- destructive action
- explicit workflow transition

Routine editing should generally use pages, drawers, popovers, or inline controls instead.

Dialog frames should remain visually restrained. Do not add decorative flourishes to modal borders.

---

# 14. Decorative Elements

One reusable thin-line ornamental motif may be used to provide brand distinction.

Example:

```text
──────╮   ╭──────
      ╰───╯
```

Allowed contexts:

- major marketing headings
- document covers
- annual reports
- authentication
- significant empty states

Do **not** use decorative filigree:

- around normal cards
- between individual form fields
- throughout tables
- around dialogs
- as repetitive page chrome



---

# 15. Iconography

## Base Icon Specification

```text
Default canvas:      20 × 20
Large canvas:        24 × 24
Stroke:              1.75px
Stroke caps:         round
Stroke joins:        round
Terminal radius:     subtle
Optical padding:     2px
```

Geometry should combine:

- strong straight verticals and clear axes
- occasional curved terminals
- occasional asymmetric secondary strokes
- immediate recognition at 16–20px

## Bespoke Product Icons

Create custom icons where generic icon libraries fail to express the product model clearly:

```text
Dwelling
Period
Meter
Water reading
Invoice preparation
Invoice sent
Account balance
Payment reconciliation
Ledger adjustment
Building
Resident
```

Icons must remain icons rather than becoming miniature illustrations.

---

# 16. UI Geometry Motif Library

Use four abstract geometry primitives.

## Arch

```text
╭────╮
│    │
```

Suitable for curved terminals and selected frames.

## Gable

```text
 /\
/  \
```

Suitable for directional, selected, peak, or hierarchy motifs.

## Panel

```text
│  │  │  │
```

Suitable for repetition, vertical subdivisions, information groups.

## Course

```text
──────────
──────────
```

Suitable for structural separators and stacked content relationships.

These should influence component geometry rather than appear as literal architectural clip art.

---

# 17. Motion System

Motion should communicate **weight rather than bounce**.

Avoid:

- elastic springs
- exaggerated scale animation
- overshoot
- wobbling cards
- parallax
- decorative looping animation

## Duration Tokens

```text
Hover / press         100–140ms
Tooltip               120ms
Dropdown              160ms
Accordion             180–220ms
Drawer                220–260ms
Modal                 180–220ms
Page-content reveal   ≤280ms
```

## Easing

Entry:

```css
cubic-bezier(0.20, 0.80, 0.20, 1)
```

Exit:

```css
cubic-bezier(0.40, 0, 1, 1)
```

The intended behavior is to **settle into place rather than spring into place**.

## Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```



---

# 18. Data Visualization

## Chart Palette

Use the following sequence:

```text
Daugava     #35677A
Verdigris   #2F736D
Amber       #C17B26
Brick       #9A493A
Pine        #4F5D3A
Slate       #58666C
```

Requirements:

- prefer direct labels instead of legends where practical
- use muted colors rather than dashboard-neon saturation
- chart grid lines use limestone/stone-joint colors
- grid lines should be 1px and low emphasis
- retain intuitive differentiation for concepts such as hot/cold water, but translate them into the restrained Riga palette



---

# 19. Responsive Behaviour

The source specifies desktop dimensions more explicitly than mobile behaviour, but establishes these responsive principles:

- preserve strong hierarchy at every breakpoint
- reduce horizontal controls when available width becomes constrained
- maintain direct, functional responsive behavior
- large desktop drawer: 480–520px
- controls should remain operational rather than ornamental
- navigation and table alignment should remain structurally clear
- prevent architectural details from interfering with task completion

Desktop baseline:

```text
Sidebar        240–256px
Content max    ~1440px
12-column grid
24px gutter
32–48px page padding
```



---

# 20. Global Component Rules

Across the product:

- use warm limestone surfaces instead of generic cool grey
- use `Daugava` for primary navigation and actions
- use borders more frequently than shadows
- reserve strong elevation for transient UI
- keep corner radii modest
- avoid universal pill-shaped controls
- keep form labels outside inputs
- use tabular numerals in financial/data contexts
- use status indicators as compact accents instead of flooding surfaces
- maintain clear vertical alignment
- keep decorative details rare and intentional
- prefer contextual drawers over unnecessary page transitions
- use modals only for high-consequence interactions
- build all interaction states to WCAG contrast requirements
- respect `prefers-reduced-motion`
- preserve Latvian diacritic quality throughout
- use Source Sans 3 for functional interfaces
- reserve Fraunces for selected display moments
- prioritize legibility, direct controls, negative space, and task completion over stylistic expression

The resulting interface should be **modern first, Riga-specific second, decorative only at carefully selected moments**.
