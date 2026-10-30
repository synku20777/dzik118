# Evidence-based UI/UX guidelines: monthly-summary dashboard for an older, low-tech-confidence, Latvian-speaking, Excel-background admin

Research date: 2026-10-28. Method note: ~25 tool calls. Several sources I wanted could not be fetched (NN/g status-indicator and Few PDF pages returned 404/binary; GOV.UK task-list page returned 410; VVC pages on dates/months and an official Latvian address-form (Jūs/tu) guideline were not found). Those are listed under Gaps rather than guessed. Items marked "folk wisdom" are widely repeated rules without a primary source found here.

## 1. Evidence on older / low-digital-confidence users: type size, target size, contrast

### Takeaway
The only hard numbers come from WCAG (contrast 4.5:1 AA / 7:1 AAA; target 24px AA / 44px AAA; line height 1.5; large text >= 18.5px/24px) and from older-adult font studies (14pt preferred over 12pt). NN/g's senior research gives qualitative guidance and a performance gap but no font or target numbers on the public page. A defensible "older user" baseline is: body text 18-19px, 1.5 line height, controls >= 44px high, text contrast >= 7:1 for body where feasible, never below 4.5:1.

### Cited Findings
- NN/g senior research: 123 participants aged 65+ over three rounds (2001, 2013, 2018-19), in the US, Canada, Australia, Germany and Japan; "older users make more mistakes than younger users"; the public article gives no numeric font or target size, only that tiny type and tiny buttons/links/dropdowns are common problems. Recommends accepting multiple input formats (do not penalize hyphens/parentheses), and clear, fix-oriented error messages — [NN/g, Usability for Senior Citizens](https://www.nngroup.com/articles/usability-for-senior-citizens/)
- NN/g: ability to use websites declines about 0.8% per year between ages 25 and 60, so people in their 40s already need somewhat larger type — same source as above.
- Secondary summary of the 2013 NN/g round (29 sites, 31 users 65+): task success 55.3% for seniors vs 74.5% for a younger control. This number comes from a search-snippet summary, not the NN/g page I fetched; treat as unverified — [search result summary, mequoda review](https://www.mequoda.com/reviews-and-studies/landing-page-reviews/web-usability-for-senior-citizens-landing-page-review)
- Font size in older adults: Bernard, Liao and Mills (CHI 2001 abstract) found 14pt fonts more legible than 12pt for older adults (mean age about 70); participants significantly preferred 14pt; 12pt serif was read significantly slower than 14pt. Another 2001 paper found no significant typeface effect between serif and sans — [summaries via search results: ERAU portfolio](https://portfolio.erau.edu/en/publications/examining-perceptions-of-online-text-size-and-typeface-legibility/), [ACM DL abstract (springerprofessional mirror)](https://www.springerprofessional.de/doi/10.1145/634067.634173). Counter-evidence: a 2008 eye-tracking study (Beymer, Russell, Orton) reported sizes above 14pt lengthened return sweeps and suggested 12pt on a combined speed+preference measure (secondary report; same search). 14pt = about 18.7px at 96dpi (my conversion).
- WCAG 2.2 SC 1.4.3 Contrast (Minimum), AA: text needs at least 4.5:1; large text (>= 18pt or 14pt bold, roughly 24px / 18.5px) needs 3:1; ratios are not rounded (4.499:1 fails). SC 1.4.6 (AAA) uses 7:1 — [W3C Understanding 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- WCAG SC 1.4.11 Non-text contrast (UI components and graphics) is 3:1 (referenced as an example on the 1.4.3 page; normative wording on its own page: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html, not fetched by me).
- WCAG 2.2 SC 2.5.8 Target Size (Minimum), AA: at least 24x24 CSS px, with exceptions (spacing, inline, equivalent control, user-agent, essential) — [W3C Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- WCAG SC 2.5.5 Target Size (Enhanced), AAA: at least 44x44 CSS px — [W3C Understanding 2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)
- WCAG SC 1.4.12 Text Spacing, AA: content must survive line height 1.5x, paragraph spacing 2x, letter spacing 0.12x, word spacing 0.16x of the font size — [W3C Understanding 1.4.12](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html). (This is a "must not break" test, not a design default, but 1.5 is a sound line-height default.)
- GOV.UK Design System's typography override classes list 19px and 16px as body sizes and a scale running from 16px up to 80px on large screens; GOV.UK Frontend v6 raised text sizes on small screens — [GOV.UK font override classes](https://design-system.service.gov.uk/styles/font-override-classes/). (The page did not give pt or line-height values; the commonly cited 19px desktop body size is consistent with it.)

### Inferences
- Combining Bernard (14pt preferred, about 18.7px) with GOV.UK (19px body) gives a consistent target: 18-19px body for this audience; 16px should be the floor for secondary text, not the default. The repo's current scale has 12px, 13px, 14px and 16px steps (global.css lines 405-440); 12-14px is below what the evidence supports for body-level content and should be reserved for non-essential metadata, if used at all.
- Use 44px minimum control height (AAA 2.5.5) rather than the AA 24px for primary buttons: the user is older, low-confidence, possibly mouse-imprecise. The repo uses min-height 2.25-2.75rem (36-44px) on some controls (global.css lines 363, 514, 561-567); primary actions should reach 44px at all breakpoints.
- Aim for 7:1 for body text and key numbers (cheap to achieve with dark text on white) and keep >= 4.5:1 for all other text, including "muted"/grey helper text. Folk wisdom: "light grey placeholder/hint text is fine" — not supported; it fails AA more often than not.
- Do not disable browser zoom; verify layout at 200% zoom (WCAG 1.4.4/1.4.10 — not fetched) since this user may enlarge pages.

### Gaps
- NN/g's full senior report (87 guidelines) is paywalled; no numeric font/target recommendation verified from it.
- I did not find a peer-reviewed study that directly validates 44px targets for desktop mouse users aged 50-70; the 44px figure is a WCAG AAA choice, derived from touch research.
- The 55.3% vs 74.5% success-rate figure needs checking against NN/g's original.

## 2. Dashboard design for non-analysts: structure, charts vs tables, status, stepper, cognitive load

### Takeaway
For this user, design for one task per screen ("what do I do this month, and is my total right?"), keep a table with visible totals as the core (Excel familiarity), use charts sparingly and only length/position-based forms (bars, bullet graphs), encode status with text + icon + color, and cap the first screen at a handful of blocks with at most two levels of progressive disclosure.

### Cited Findings
- NN/g on dashboards: should be glanceable on one screen with little interaction; "information that can be consumed fast"; focus each dashboard on one task; operational (time-sensitive) vs analytical types — [NN/g, Dashboards (preattentive)](https://www.nngroup.com/articles/dashboards-preattentive/)
- Same NN/g article: use line/bar charts for quantities; avoid pie, donut, treemap and radial gauges (area/angle judged poorly); use bullet charts or linear graphs for value vs target; avoid 3D; sort bars by value; color for categories not magnitude and pair with shape/borders/proximity; position and length are the most accurate preattentive attributes (Cleveland and McGill 1985). About 8% of men and 0.5% of women have color-vision deficiency (stated as 4.5% of general population).
- Progressive disclosure: show core options first and defer rare ones to a secondary screen; NN/g recommends a maximum of two disclosure levels because designs with more "typically have low usability"; the main risk is hiding things users need often — [NN/g, Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- Working memory: a limited task buffer; capacity correlates negatively with age; provide external memory (comparison tables, carts, saved items) rather than making users remember. NN/g mentions Miller's "magical number 7" only as approximate short-term capacity — [NN/g, Working Memory and External Memory](https://www.nngroup.com/articles/working-memory-external-memory/)
- Cowan (2001), Behavioral and Brain Sciences 24(1):87-114: argues the real central limit is about 4 chunks (abstract: "roughly four chunks"; focus of attention 4-5), versus Miller's 1956 "7 plus or minus 2", which Miller himself treated as a rough estimate; Cowan's article drew commentary disputing a fixed limit — [PubMed 11515286](https://pubmed.ncbi.nlm.nih.gov/11515286/). Claim that the limit is lower for older adults appears only in a secondary summary I could not verify in the primary source.
- Status must not rely on color: WCAG SC 1.4.1 (Level A) — color must not be the only visual means of conveying information; relevant techniques G14 (also available in text), G182 (additional visual cues), G205 (text cue); failure F81 (errors/required marked by color only). A status distinguished only by two colors needs an extra indicator even when color contrast is 3:1+ — [W3C Understanding 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
- Indicators/validation: validation messages should say how to fix the problem, with an icon beside the message to locate the field; passive notifications are easy to miss (bad for critical info); toasts are a poor choice for errors — [NN/g, Indicators, Validations, and Notifications](https://www.nngroup.com/articles/indicators-validations-notifications/)
- Modals: appropriate for critical/irreversible warnings and for missing info needed to continue; inappropriate for nonessential content, high-stakes processes (checkout), and decisions where the modal hides needed context; frequent low-value modals train users to ignore them; default to non-modal for noncritical tasks — [NN/g, Modal & Nonmodal Dialogs](https://www.nngroup.com/articles/modal-nonmodal-dialog/)
- Hidden navigation (hamburger): in a 179-participant study, hidden nav was used 27% on desktop vs 48-50% for visible/combo; discoverability dropped by more than 20%; desktop tasks at least 39% slower with hidden nav; caveat — time-to-first-use effect was only marginally significant (p<0.1) — [NN/g, Hamburger Menus](https://www.nngroup.com/articles/hamburger-menus/)
- Stephen Few's bullet graph is the standard recommendation for replacing gauges (value vs target in a compact linear form) — spec PDF: https://www.perceptualedge.com/articles/misc/Bullet_Graph_Design_Spec.pdf (fetch returned binary; claim consistent with NN/g's bullet-chart recommendation above, which I could cite directly).

### Inferences
- Monthly cycle screen order that follows the evidence: (1) one-line status sentence in plain words ("Oktobra rēķini: 3 no 5 soļiem pabeigti"), (2) a single primary next action button, (3) a table with visible per-line numbers and a totals row, (4) secondary details collapsed (max one extra level), (5) history/audit link. This fits "one primary question per screen" and keeps Excel familiarity.
- Limit the first viewport to about 4 blocks, justified by Cowan's approximately-4-chunks estimate rather than Miller's 7; this is a design heuristic, not a measured threshold. Folk wisdom: "7 +/- 2 items in a menu/dashboard" is a misapplication of Miller; do not cite it as a UI rule.
- A monthly cycle is a linear, dependent sequence — a visible numbered stepper/checklist with state text ("Pabeigts", "Jāizdara", "Vēl nav pieejams") is better than a KPI wall. GOV.UK has a task-list pattern with those three-state semantics (page returned 410 when fetched; URL for reference: https://design-system.service.gov.uk/patterns/task-list-pages/ — unverified in this session).
- Each status chip = text label + icon shape + color (e.g., check, warning triangle, clock/lock). In the repo, success (#1f5955) and warning (#7c470f) are both dark and low-saturation, which is helpful, but color-blind distinguishability still demands the text+icon pair. Avoid traffic-light red/amber/green as the only encoding; avoid "red = bad" for items that are simply not-yet-done (reserve danger for genuine errors).
- Charts: keep to at most one bar or bullet chart, sorted, with data labels printed on bars and the same numbers available in the table. For monthly consumption/billing by dwelling, a table with a value-bar in the cell (in-cell length) gives Excel familiarity plus pre-attentive length. No pie/donut/gauge.
- Modals: use an inline confirmation or a dedicated confirm page for destructive actions (with the consequence in plain words and an undo/"Atcelt" path); keep modals for truly irreversible actions only.
- Navigation: for a desktop user, show a visible left or top navigation with text labels; no hamburger on desktop.

### Gaps
- NN/g's own page on status indicators (status-indicators URL) returned 404; no direct NN/g statement on "icon + text vs color alone" beyond WCAG 1.4.1 was retrieved.
- No verified source on dashboard "max N blocks"; the "4 blocks" figure is an inference from Cowan.
- No peer-reviewed comparison of tables vs charts for older, non-analyst users was found; the table-first recommendation rests on NN/g's "external memory"/glanceability principles plus domain familiarity (Excel), not a direct study.
- Tufte/small multiples: not researched in this pass (no primary source retrieved); recommend omitting small multiples for this audience unless tested.

## 3. Money, dates and language in Latvian

### Takeaway
Use the platform's lv-LV (CLDR) formatting for numbers (decimal comma, space as thousands separator, euro sign after the amount with a space) and show the "dd.mm.gggg." form for dates in tables. Use the nominative month name with the year in headings ("2026. g. oktobris") — and for "in October" sentences use the locative ("oktobrī") — a point that I could not confirm in any authority source. Plain, formal-polite Latvian ("Jūs" or imperative-free neutral) is the safe default, but no official Latvian UX-writing guidance on address form was found.

### Cited Findings
- Verified by running Node.js 22+ (ICU 78.3, CLDR 48.0) `Intl` with locale `lv-LV` on this machine: currency 1234567.89 EUR parts = integer "1", group " ", ..., decimal ",", fraction "89", literal " ", currency "€" — i.e. "1 234 567,89 €" (group separator is a space-like character; verify whether it is NBSP U+00A0 in your runtime before mixing with strings). Plain number 1234 is "1234" (no grouping for 4 digits, a CLDR minimum-grouping-digits rule), 12345 is "12 345". Default short date: "5.10.2026." (trailing period). `{month:'long', year:'numeric'}` gives "2026. g. oktobris"; `dateStyle:'long'` gives "2026. gada 5. oktobris"; month alone "oktobris". (Local run, no URL; reproducible with `new Intl.NumberFormat('lv-LV',{style:'currency',currency:'EUR'})`.)
- CLDR lv.xml: wide month names (format context): janvāris, februāris, marts, aprīlis, maijs, jūnijs, jūlijs, augusts, septembris, oktobris, novembris, decembris (nominative forms); date formats short `dd.MM.yy`, medium `y. 'gada' d. MMM`, long `y. 'gada' d. MMMM` — [CLDR lv.xml](https://raw.githubusercontent.com/unicode-org/cldr/main/common/main/lv.xml)
- VVC Latvian Language Expert Commission decision (12 March 2014), as reported by LV portals: currency name/code/symbol follows the amount, separated by a linked (non-breaking) space. Accepted forms "25 EUR (divdesmit pieci eiro)", "25 (divdesmit pieci) eiro", "25 € (divdesmit pieci eiro)". "eiro" in everyday/public text; italic "euro" only in legal instruments (VVC director Baltiņš: contracts may use "eiro"). Cent = "eiro simtdaļa ir cents"; avoid "eirocents"; abbreviation lowercase "c" without period. The article gives no rule on decimal/thousands separators — [LV portals, 2014](https://lvportals.lv/skaidrojumi/260812-eiro-un-cents-latviesu-valoda-2014) (secondary source; 12 years old, verify at vvc.gov.lv).
- VVC director also said use of the € symbol would be neutral and short; abbreviations on price tags are outside VVC remit — [LV portals e-konsultācijas](https://lvportals.lv/e-konsultacijas/20347-ka-rakstit-naudas-summu-vardiem-2020) (via search snippet).
- Terminology: Latvian National Terminology Portal (Termini, VVC-developed economics/finance collection) maps English "invoice" to Latvian "rēķins"; "faktūrrēķins" is an accepted term (EuroVoc "invoice" = "faktūrrēķins") — [termini.gov.lv economics collection](https://termini.gov.lv/kolekcijas/5/skirklis/34077) (page details via search summary; "ledger" to "konts" mapping not verified).
- Tone: A Latvian study of translated self-help books found tu increasingly used (53.3% of surveyed readers prefer tu) — a book context, not government services — [LU dissertation](https://dspace.lu.lv/handle/7/64503).

### Inferences
- Formatting: format via `Intl` with `lv-LV` and `currency: 'EUR'`, but force a non-breaking space between number and "€" (CLDR already uses NBSP-type literal; check) and keep the figures right-aligned with `font-variant-numeric: tabular-nums` so columns align like Excel. Show cents always in money columns (",00") for visual alignment. Note that CLDR's no-grouping for four-digit numbers ("1234,50 €") may surprise users who expect "1 234,50 €" — consider `useGrouping: 'always'` for money so tables line up. Folk-wisdom caveat: some Latvian accountants write "1 234,56 EUR"; the VVC decision permits both EUR and €; pick one (€ is shorter in tight columns) and use it consistently.
- Dates: use "dd.mm.gggg." in tables and "2026. gada 28. oktobris" only in prose headings; always the same form. Month in heading "2026. gada oktobris" (nominative from CLDR). For "in October" sentences you need the locative "oktobrī" and for "of October" the genitive "oktobra" — this is from my general knowledge of Latvian grammar, not from a retrieved source; CLDR has no locative. Implementation implication: do not build sentences by concatenating the Intl month name; store hand-written month tables for the locative/genitive, or rephrase to nominative-friendly constructions ("Mēnesis: oktobris", "Periods: 2026. gada oktobris") which avoids declension errors.
- Compound/long words: Latvian labels tend to be longer than English; plan buttons for about 1.3-1.5x English label length, allow wrapping, and never truncate. Prefer short verbs for buttons: "Saglabāt", "Izrakstīt rēķinus", "Apstiprināt"; avoid 3+ word button strings.
- Terminology: prefer "rēķins" over anglicism "invoice"/"faktūra" in UI labels (Termini-consistent); explain "norēķini", "parāds/pārmaksa", "saldo" in plain words with a short help line; avoid "ledger"-style words ("virsgrāmata" is accounting jargon) — use "Konta kustība" or "Maksājumu vēsture" (these label proposals are my suggestions, not from Termini).
- Tone: default to polite plural-formal address (Jūs) or avoid pronouns entirely with neutral constructions ("Pārbaudiet summas", "Rēķini ir gatavi"). This is a defensible default for an older admin; no official source retrieved. Latvian verbs and adjectives mark gender in past tense/participles ("Jūs esat pieteicies/pieteikusies"); avoid gender-marked forms ("Jūs esat pieteicies") by using neutral phrasing ("Pieteikšanās veiksmīga").

### Gaps
- No VVC page found for date formatting (dd.mm.gggg. vs text) or for month locative/genitive; relevant authority might be MK noteikumi on document formatting and VVC "Valodas prakses" consultations — not retrieved.
- No official Latvian guidance found on Jūs/tu in digital-service UX copy (VARAM/State Chancellery plain-language material not located).
- Termini/TERMINI lookup for "ledger", "statement", "balance", "arrears" not completed.
- Decimal/thousands separator rules from VVC/LVS (Latvian standards) not retrieved; only CLDR behavior verified.

## 4. Anti-patterns and trust patterns for financial tools

### Takeaway
Evidence supports: visible navigation, inline (not modal) validation with fix-oriented text, minimal modals, no hidden/passive-only critical messages, and external-memory aids. Trust patterns ("show how this number is calculated", reconciliation, audit trail) are best-practice reasoning, not backed by a specific study I could retrieve.

### Cited Findings
- Hidden navigation reduces discoverability by more than 20% and slows desktop tasks by at least 39% (see section 2) — [NN/g Hamburger Menus](https://www.nngroup.com/articles/hamburger-menus/)
- Errors: be specific, explain, make easy to fix; accept varied input formats such as spaces, hyphens, commas — [NN/g Usability for Senior Citizens](https://www.nngroup.com/articles/usability-for-senior-citizens/)
- Validation text must tell users how to fix the problem; passive notifications are easy to miss; toasts are poor for errors — [NN/g Indicators, Validations, Notifications](https://www.nngroup.com/articles/indicators-validations-notifications/)
- Modals: overuse trains users to dismiss them; reserve for critical or irreversible items — [NN/g Modal & Nonmodal Dialogs](https://www.nngroup.com/articles/modal-nonmodal-dialog/)
- WCAG 2.2.2 Pause, Stop, Hide (A) covers auto-updating content; WCAG 2.2.1 Timing Adjustable — not fetched; mention as references only: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
- Hover-only info: WCAG 1.4.13 Content on Hover or Focus (AA) requires dismissable/hoverable/persistent — not fetched in this pass: https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html

### Inferences
- Money-input tolerance: accept "12,5", "12.50", "12 50", "1 234,5" and normalize to "12,50 €" on blur with a visible echo ("Tiks saglabāts: 1 234,50 €"). Derived from the NN/g "multiple input formats" finding and the Latvian decimal comma; folk wisdom otherwise says use input masks, which tend to frustrate Excel users.
- "How this number was calculated": a "Kā aprēķināts?" inline expander (level 1 disclosure) showing formula rows (consumption x tariff + fixed charge = total) mirrors Excel's formula bar and meets the two-level cap. Reconciliation: show a totals row on every table and a "Kopā sakrīt ar: [parent total]" line with check icon + text; show differences in words when not matching.
- Destructive actions: prefer undo ("Atsaukt") or a clear reversal path (this app already has payment reversals per git history) over confirm dialogs; if a confirmation is needed, name the object and effect ("Dzēst rēķinu Nr. 123 par 45,20 €?") rather than "Vai tiešām?".
- Auto-refresh: avoid; a monthly workflow doesn't need live data, and auto-changing numbers undermine trust and violate WCAG 2.2.2 spirit; show "Dati atjaunināti: 28.10.2026. 09:14" with a manual "Atjaunot" button.
- Hover-only information (tooltips) must have a keyboard- and tap-accessible equivalent; for this audience, use visible helper text rather than tooltips.
- Audit trail: a visible "Izmaiņu vēsture" per record (who, when, what, old to new value) is reasoning from financial-software practice; no specific study retrieved.

### Gaps
- No study quantifying trust effects of "show calculation" or reconciliation displays was found.
- WCAG 2.2.2, 1.4.13 pages referenced but not fetched.
- No evidence retrieved on undo vs confirm for older users specifically.

## 5. Mobile vs desktop, layout, density, empty states

### Takeaway
Design desktop-first for a home laptop/desktop user, but keep a single-column fallback that works at 200% zoom and on a phone. Hidden-nav and density issues are worse on mobile; mobile tasks took about 12% longer than desktop in NN/g data.

### Cited Findings
- NN/g navigation study: mobile tasks took about 12% longer than desktop across navigation types; hidden nav used 57% on mobile vs 27% on desktop (people do open menus more when forced on a small screen) — [NN/g Hamburger Menus](https://www.nngroup.com/articles/hamburger-menus/)
- WCAG 2.5.8/2.5.5 target sizes (24px AA, 44px AAA) apply to pointer targets on all devices — see section 1.
- NN/g: nonmodal desktop popups can become blocking full-screen modals on mobile; test across devices — [NN/g Modal & Nonmodal Dialogs](https://www.nngroup.com/articles/modal-nonmodal-dialog/)
- Repo context (not a research source): global.css has a dashboard stat at clamp(1.25rem, 2vw, 1.85rem) and many 12-14px sizes, plus existing `light-dark()` colors; `docs/product/UI_SPECIFICATION.md` not read in this pass.

### Inferences
- Layout: max content width about 1100-1200px on desktop; body text lines 60-75 characters; a single main column plus an optional narrow right column for "next step" works better than a multi-column KPI grid. Generic line-length ranges (45-75 characters) are widely repeated typographic folk wisdom; GOV.UK also recommends about 2/3 width main columns, but I did not verify a number here.
- Above the fold, order: (1) period heading and status sentence, (2) primary next-step button, (3) step checklist with text-state chips, (4) main totals table with totals row, (5) "Kas mainījies" or exceptions list (only if non-empty). Anything else below the fold or behind one disclosure.
- Table vs card: keep tables for comparable numeric rows (dwellings, readings, charges) to preserve Excel mental model; use cards only for the 2-3 headline totals and for narrow screens, where tables should stack row-to-card (this app already has mobile table stacking per git history).
- Empty states: state what is missing and the single action to fill it, in plain language, with the same primary-button style ("Vēl nav rādījumu. Ievadiet pirmos rādījumus" + button). Empty zero values should show "0,00 €", not blank, because Excel users read blanks as "forgot".
- Density: 8px base spacing, row height at least 44px for rows with actions; do not shrink row padding to fit more rows — paging or grouping is better than density. Folk wisdom, not tested.
- Respect `prefers-reduced-motion`; avoid animated transitions on number changes.

### Gaps
- No direct evidence retrieved on responsive behavior for older desktop users; the recommendations are inferences.
- UI_SPECIFICATION.md not read; recommendations are not yet reconciled with the project's own spec.
- Empty-state research (NN/g, GOV.UK) not retrieved.

## Quick reference: numbers to adopt (with evidence strength)

| Item | Value | Evidence |
|---|---|---|
| Body text | 18-19px (>=16px floor) | Moderate: Bernard 2001 (14pt preferred), GOV.UK 19px; counter-evidence from 2008 eye-tracking |
| Line height | 1.5 | Strong as a WCAG 1.4.12 resilience test; typical default |
| Text contrast | >=4.5:1 required, 7:1 target for body/numbers | Strong (WCAG 1.4.3 AA / 1.4.6 AAA) |
| Non-text/UI contrast | >=3:1 | Strong (WCAG 1.4.11) |
| Large text | >=24px (18pt) or 18.5px bold (14pt) = 3:1 allowed | Strong (WCAG) |
| Target size | >=44x44px for primary actions; 24px absolute min | Strong (WCAG AAA / AA) |
| Status encoding | text + icon + color | Strong (WCAG 1.4.1 Level A) |
| Disclosure levels | max 2 | Moderate (NN/g, expert guideline) |
| First-screen blocks | about 4 | Weak/inference (Cowan 2001); not a published UI rule |
| Charts | bar/line/bullet only; no pie/donut/gauge/3D | Moderate (NN/g, Cleveland and McGill 1985) |
| Hidden nav | avoid on desktop | Moderate (NN/g, n=179; some effects marginal) |
| Money format | `1 234,56 €` via lv-LV Intl (verify NBSP) | Verified locally on CLDR 48; VVC 2014 decision on placement/NBSP |
| Date format | `dd.mm.gggg.` tables; `2026. gada oktobris` headings | CLDR; VVC authority not found |
