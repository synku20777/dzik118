# Resident portal redesign

Implemented locally on 2026-11-12. The audience is residents who need a clear
way to pay a bill or send meter readings, including older people with little
experience using websites.

## Scope and decisions

The user chose improvements to bank transfers and typed meter readings.
Online payment processing and meter-photo uploads are outside this change.

- Keep the design system's Riga colors, fonts, buttons, notices and status
  badges. Resident styles are isolated from the administrator interface.
- Use 18 px body text, at least 16 px instructions, and 48 px form buttons and
  fields. Keep native controls, visible labels and keyboard focus styles.
- Show the latest published bill even if a new reading month has no invoice
  yet. Show its remaining balance, rather than treating the original invoice
  total as the amount to transfer. A paid bill says no payment is needed.
- Put bank details above the invoice document. Copy recipient, IBAN, reference
  and remaining amount separately. A failed clipboard action gives a manual
  alternative. Without JavaScript, the details remain visible.
- Explain that the transfer happens in the resident's bank and that recorded
  payments can take time to appear. Keep the original invoice totals and its
  language selector; warn partial payers that its original amount is different.
- Older bills are view-only for payment purposes and link to the newest bill.
  Do not invite a resident to pay arrears separately after a newer bill exists.
- Reuse the existing banking QR generator with the remaining amount. The QR is
  optional, behind a labelled disclosure, and absent when no amount remains.
  Hide the original-amount QR in the portal document preview; canonical PDF
  generation keeps its existing behavior.
- Put readings before history, with the month, deadline, meter number and
  previous reading. Accept a decimal comma or point. Show a receipt for each
  saved meter. Saving one meter leaves other typed readings in place. Keep
  the native POST path, with a redirect after success.
- Keep history reachable through disclosures and help in a consistent footer.
  Spell out language names in the resident header. The shared language switch
  keeps its previous short labels elsewhere.

These choices use [W3C guidance for older users](https://www.w3.org/WAI/older-users/developing/),
especially readable text, clear form instructions, predictable navigation and
keyboard access. They are design choices, not a claim of WCAG certification or
evidence from resident usability testing.

## Suggested features, not implemented

1. **Call the administrator.** Use the organization's configured contact number
   for a labelled call link, with the number also readable and printable.
   Confirm who answers and when before presenting it as a support service.
2. **Optional reminders.** Let residents choose a short reminder when readings
   open or a payment is due. Link directly to the relevant dwelling. SMS needs
   consent, a delivery provider and notification preferences.
3. **Trusted helper access.** Let a resident invite a family member to help with
   one dwelling, with clear permissions and a way to remove access. This needs
   its own authorization design; residents should not share sign-in links.
4. **Meter photo assistance.** Let a resident attach a photo when unsure about
   the digits. Keep manual entry available and require confirmation of any
   extracted number before it affects billing. This needs storage, retention
   rules and an administrator review flow.
5. **A printable payment slip.** Show the current remaining amount, recipient,
   IBAN and reference with an “as of” date, separate from the original invoice.
   Test it with residents who pay at a branch or get help from family.

Start by observing several older residents pay a partial bill and submit two
meter readings on their own device. Check whether they can tell when a payment
or reading is complete before adding another feature.

## Validation

- TypeScript, Astro check, 431 unit tests and 33 relevant integration tests pass.
- The resident browser test uses a temporary local organization and removes it
  afterward. It checks a real partial payment, clipboard success and failure,
  rejected and accepted readings, preserved unsaved fields, database values,
  native submission without JavaScript, a paid bill and a locked reading period.
  It also covers damaged snapshots and two published invoices with carried debt,
  including a paid newest bill whose older invoice still has an open allocation.
- Home, invoice list and payment detail pass overflow checks in all three
  languages, both themes, at 320, 390 and 1440 px. Primary and secondary buttons
  meet the 48 px height in these views.
- No native-speaker review, real bank transfer, physical QR scan or usability
  session with older residents has been done.

## Second pass: polish, chat and micro-interactions (2026-11-12)

The owner annotated the first version in the preview and chose three options:
one continuous chat, back links only where the tabs do not already lead, and
calm motion (short fades and color changes, nothing moving on page load).

- **Header.** The header uses the content's column and gutters, so the brand
  lines up with the tabs. Profile has a person icon. Sign out moved from the
  foot of the Profile page into the header and is on every page. On phones the
  brand, Profile and Sign out share the first row; theme and language are below.
- **Tabs.** Each tab has an icon from 640px. Phones keep text only, because the
  Latvian and Russian "Contact administrator" label already fills a row.
- **Alignment.** Invoices, Contact administrator, Payment history, Profile and
  Your dwellings no longer sit in a narrower centred box. Every page starts at
  the left edge of the tabs. The browser test measures it.
- **Back links.** One style: arrow icon, 48px target, hover background. Kept on
  the home page (only with several dwellings), Profile, Payment history and the
  invoice page. Removed from Invoices and Contact administrator.
- **Titles.** Page titles use the display face, as the administrator pages do.
  "Invoices: Dwelling1" (a missing space) became a title with the dwelling on
  the line below.
- **Meter readings.** The month is in the section's heading row. Each meter is
  one row: the meter-type icon on the shared meter tone, the name, then serial
  number and previous reading on one muted line. A received reading is a large
  figure with a green "Reading received" line. The entry hint appears once,
  above the meters, and every field refers to it. The deadline is shown only
  while a reading is missing. Units use the shared `unitLabel` ("m³").
- **Disclosures.** Consumption history and Recent invoices are panels like the
  sections above them. The whole heading row opens them and a chevron turns.
- **Invoice rows.** One component (`ResidentInvoiceList.astro`) for the home
  page and the invoice list: number over due date, status, total, a chevron.
- **Chat.** The Contact administrator page is one timeline for the dwelling:
  the resident's messages on the right, the administrator's on the left, a date
  line per day, the time under each message, and one message box. There is no
  Subject field. `sendResidentMessage` adds the message to the dwelling's
  newest conversation that is not resolved, or starts one named from the
  message's first line (`subjectFromBody`, 60 characters). The administrator
  inbox is unchanged: separate conversations and Resolve. A resolved
  conversation leaves one line in the chat, and a subject somebody typed shows
  as a topic line. The list keeps the newest message in view without a script
  (`flex-direction: column-reverse`). Enter is a new line; the Send button or
  Ctrl/Cmd+Enter sends. Sending works without JavaScript.
- **Micro-interactions.** Hover and focus colors on header links, tabs, rows
  and back links (140ms). The chevron turns (180ms). A saved reading fades in
  and its check mark draws. A sent message fades in. Copy turns into "Copied"
  in green for two seconds; the status line under the bank details stays for
  screen readers. All of it is off under reduced motion.
- **Smaller.** The home page's script no longer imports `i18n.ts`, so the UI
  dictionary does not reach the browser. Two unused style blocks
  (`.current-invoice`, `.invoice-list`) were removed from `global.css`.

### Not done

- The chat does not update by itself. A reply from the administrator shows
  after the page is opened again.
- A message joins the newest open conversation even if that one is old.
- Russian and Latvian tabs wrap onto two rows on a phone, as before.

### Validation of the second pass

- Prettier, ESLint, TypeScript, Astro check (0 errors), 434 unit tests
  (3 new, `subjectFromBody`), production build (no UI dictionary in the client).
- `tests/integration/messaging.test.ts`: 13 pass, 1 new (a message joins the
  open conversation; a new one starts after Resolve).
- `tests/e2e/resident-portal.spec.ts` (its own temporary organization, removed
  afterwards) now also covers: Sign out in the header and not on Profile; the
  empty chat, send, Ctrl+Enter, the field cleared and focused, one conversation
  named from the first message, the administrator's reply on the other side,
  the resolved line, sending without JavaScript and the new conversation after
  Resolve. Six pages pass the overflow, single-title, 48px-button and
  left-edge checks in three languages, two themes and 320, 390 and 1440px.
- `tests/e2e/layout-matrix.spec.ts`, resident portal test: pass.
- The demo organization's audit rows, tariffs, messages, conversations and
  readings were counted before and after: unchanged.
- Not checked: screen readers, Safari, touch hardware, a native review of the
  new Latvian and Russian strings, and use by older residents.
