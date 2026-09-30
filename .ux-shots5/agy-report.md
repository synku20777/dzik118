# Product & UX Research Report: Missing Features, Dead Ends, and UI Artifacts

**Target Application:** Property Billing Admin App (Latvian-first, EN/LV/RU support)  
**Evaluation Scope:** 7 Desktop Admin Screenshots (`.ux-shots5/01-settings-billing.png` through `07-payments.png`)  
**Focus:** Functional dead ends, missing domain capabilities, half-built workflows, and leaked technical artifacts. Cosmetic polish, spacing, and styling nits are strictly excluded.

---

## Executive Summary

The application provides a basic skeleton for tenant/dwelling billing, meter tracking, invoice templating, and bank reconciliation. However, the system is hindered by:
1. **Critical dead ends**: Destructive/administrative dead ends where entities cannot be edited, removed, or navigated (e.g. inability to delete or disable admins, unmatch payments, or resolve "Missing data" billing periods).
2. **Missing core domain capabilities**: No manual payment or cash recording, no meter reading submission or historical reading log on dwelling records, no date range or actor filtering on audit logs, and no statutory company/tax identifiers (Reģ. Nr., PVN Nr., IBAN) in billing defaults.
3. **Severe data and technical leakage**: Production/demo views are saturated with end-to-end (E2E) automated test fixture strings (`00-E2E-1790005821669`, `Nav Persisted...`, `Zero price repro test`), raw uppercase database enums (`INVOICE_ACCESS_TOKEN_REVOKED`), and raw 36-character database UUIDs presented as primary labels in place of apartment numbers or resident names.
4. **Global UI regression**: A sticky `"✓ All changes saved"` toast notification appears permanently anchored across almost every screen, overlapping interactive buttons.

---

## 1. Screen-by-Screen Discovery

### 01 — Settings: Billing Defaults, Automation & Late Fees (`01-settings-billing.png`)

#### Dead Ends & Broken Affordances
- **[High] Disconnected & Ambiguous Save Buttons:** The page has two separate `Cancel` / `Save changes` button bars (one at the bottom of the "Automation" card, one at the bottom of "Late-payment rules"). The top card, "Billing defaults" (Currency, Timezone, Locale, Prefix, Due days), has **no save button of its own**. It is completely ambiguous whether clicking "Save changes" in the Automation card saves Billing defaults, or if Billing defaults are auto-saved.
- **[Med] Inactive Form Field Without Enablement Affordance:** In the "Automation" card, "Auto-send day of month" is rendered as a disabled gray box with helper text *"Used only when automatic sending is enabled"*. However, toggling the switches does not indicate what default value will be selected, nor does it define boundaries (1–28 or 1–31).
- **[Med] Late-Payment Form Incoherence:** The checkbox `Late fees enabled` is **unchecked**, yet the sub-rule `Stop accrual at cap` is **checked**, and the fields `Maximum total penalty (%)` (set to `10`) and `Grace period (days)` (set to `0`) remain fully editable. Inactive features should disable their dependent inputs. Furthermore, `Effective from` is an empty date input (`dd.mm.yyyy`) with no clear default (does it apply immediately or retroactively?).

#### Absent Capabilities
- **[High] Statutory Business & Banking Information for Invoicing:** In Latvia and the EU, an invoice is legally invalid without the issuer's statutory data: Registration Number (Reģistrācijas numurs), Legal Address, VAT Number (PVN reģistrācijas numurs), and Bank Account details (Bank name, SWIFT/BIC, IBAN). There are zero fields for banking or legal credentials anywhere in Billing settings.
- **[High] VAT / Tax Rate Defaults:** Property management invoices typically combine standard VAT items (management fee, waste disposal at 21%), exempt items (residential rent), and pass-through utilities. There is no tax/VAT rate configuration or default VAT classification mechanism.
- **[Med] Invoice Sequence & Number Formatting:** Only a static text prefix (`INV`) can be configured. There is no ability to define format tokens (e.g., `{YEAR}-{MONTH}-{NUM}`), starting sequence counters (e.g., `0001`), or reset cadences (annual vs. monthly).
- **[Low] Rounding Rules:** Property billing calculations often require explicit currency rounding configuration (e.g. 2 decimal standard vs. euro-cent cash rounding).

#### Technical Artifacts Leaking into UI
- **[Low] Raw Floating-Point Decimal Default:** In "Late-payment rules", the `Daily rate (%)` defaults to `0.000000` (six raw floating-point decimal zeros) instead of a standard formatted rate (e.g. `0%` or `0.01%`).

#### Half-Built Features
- **Global Ghost Toast Overlay:** A persistent floating `"✓ All changes saved"` toast is stuck in the middle-right viewport over the "Good to know" information card, despite the user facing un-submitted forms with active `Save changes` buttons.

---

### 02 — Audit Log (`02-audit.png`)

#### Dead Ends & Broken Affordances
- **[High] Free-Text Backend Entity Filter:** The `Entity type` filter is a plain text box with placeholder `invoice, conversation, ...` rather than a dropdown or selectable multi-select tag picker. Administrators cannot discover valid entity types and must guess raw internal database model names.
- **[Med] No Clear / Reset Filter Affordance:** There is a `Filter` button, but no `Clear` or `Reset` button to return to the unfiltered stream once a filter is applied.
- **[Med] Inconsistent Details Column (`▶ View` vs. `—`):** Several audit entries display an actionable `▶ View` button, while others (e.g., `INVOICE_ACCESS_TOKEN_REVOKED`, `INVOICE_ACCESS_TOKEN_CREATED`, and selected `INVOICE_RESENT` events) display a non-interactive dash (`—`) with no explanation of why details are unavailable or unrecorded.
- **[Med] Incomplete Pagination Controls:** The footer has `← Previous` (disabled), `Page 1`, and `Next →`. There is no total record count (e.g., "Showing 1–35 of 1,240 events"), no page size selector (25 / 50 / 100), and no jump-to-page input.

#### Absent Capabilities
- **[High] Date Range Filter:** Time is the primary query vector for compliance and incident investigation. There is **no date range filter** (no "From" / "To" picker or presets like "Today", "Last 7 days", "This month").
- **[Med] Actor Filter:** Audit logs cannot be filtered by who performed the action (e.g. filtering specifically for "Admin A" or system automated jobs).
- **[Med] Audit Export / Download:** There is no export functionality (CSV, JSON, PDF) required for legal, tax, or external accounting audits.
- **[Med] Search by Identifier / Free-Text Query:** No search bar to locate an event by specific invoice number, apartment number, or resident name.

#### Technical Artifacts Leaking into UI
- **[High] Raw Database UUIDs as Primary Identifiers:** The `Entity` column directly displays internal database UUIDs (e.g., `dwelling (1862662b-9648-41da-ab1d-08e604a216e2)`, `invoice (e96643fb-3416-465c-9724-05b1a9f34558)`). For a property manager, this is completely unreadable; it should show "Dwelling Apt 4" or "Invoice INV-2026-004".
- **[Med] Raw Backend Enum Action Codes:** The `Action` column displays raw uppercase database enum constants: `DWELLING_CREATED`, `INVOICE_REGENERATED`, `ORGANIZATION_UPDATED`, `INVOICE_ACCESS_TOKEN_REVOKED`, `BILLING_RULE_CREATED`, `INVOICE_RESENT`, etc., rather than localized human-readable labels.
- **[Low] Unhandled System/Null Actor:** One entry (`Sep 22, 2026`, `BILLING_RULE_CREATED`) displays `—` in the Actor column, leaking an unhandled null database field instead of displaying "System" or an automated process name.

#### Half-Built Features
- **Information Architecture Disconnect:** The Audit log has no entry in the main left sidebar navigation (sidebar lists only Dashboard, Periods, Dwellings, Payments, Messages, Settings). It also lacks any parent breadcrumb (unlike Settings screens), leaving the user with no visual cue of where Audit resides in the application hierarchy.

---

### 03 — Organizations List (`03-organizations-list.png`)

#### Dead Ends & Broken Affordances
- **[High] Completely Trapped Navigation (Sidebar Annihilated):** On this page, the entire left sidebar navigation menu (`Dashboard`, `Periods`, `Dwellings`, `Payments`, `Messages`, `Settings`, `Admin guide`) has **completely vanished**. The user is marooned on this view with no navigation links back to the main app.
- **[High] Dead-End Organization Item Card:** The existing organization "Brīvības 118 Demo / Brīvības iela 118" is rendered inside a large bordered card with **zero action affordances**—no "Select", "Switch to", "Manage", or "Edit" button, and no chevron. It gives no affordance that clicking it does anything.
- **[Med] Circular Sidebar Link:** In the left sidebar header under "ADMINISTRATION", the link `Switch organization ↗` remains visible and active, even though the user is *already* on the organization switching screen.
- **[Med] No Active Organization Indicator:** There is no "Current" or "Active" badge indicating that "Brīvības 118 Demo" is the tenant currently in session.

#### Absent Capabilities
- **[High] Organization Management (Edit / Archive / Deactivate / Delete):** There is no way to edit an existing organization's name/address, nor any mechanism to archive, deactivate, or delete an obsolete organization.
- **[Med] Missing Legal Organization Profile Fields:** The "Create organization" form only contains "Name" and "Address". It lacks statutory company registration numbers (Reģ. Nr.), VAT status, currency defaults, and primary contact info.
- **[Low] Form Cancel Button:** The "Create organization" form only has a "Create" button; there is no "Cancel" button to collapse or exit the creation flow.
- **[Low] Organization Summary Metrics:** The organization card displays no metadata (number of dwellings, active billing period status, or assigned administrators).

#### Technical Artifacts Leaking into UI
- **[Low] Wireframe Grid Lines Leaking:** In the lower left sidebar under the user profile/sign-out area, vertical grey background grid lines are leaking through the empty layout canvas.

---

### 04 — Invoice Template Editor (`04-invoice-template-editor.png`)

#### Dead Ends & Broken Affordances
- **[Med] "Remove" Advertised But Completely Absent:** The subtitle explicitly instructs: *"Add, remove and configure sections. Drag to reorder."* While there is an `+ Add text block` button, there are **no delete, trash, or remove controls** on any of the listed sections.
- **[Med] Non-Interactive Preview Controls (Language & Zoom):** Above the live preview, "Latviešu" and "100%" are rendered as static pill buttons. Despite the instruction stating *"Latvian is the canonical invoice language. English and Russian are optional translations..."*, there is no dropdown arrow or toggle affordance to switch the live preview to English or Russian to verify translated templates. Similarly, "100%" has no zoom-in/zoom-out controls.
- **[Med] Live Preview Vertical Cutoff:** The invoice preview cuts off abruptly at the bottom edge at `"Banka: Swedbank"` with no scrollbar, no pagination indicator, and no multi-page preview controls.

#### Absent Capabilities
- **[High] PDF Export / Test Print Sample:** In an invoice template editor, the single most critical capability is downloading or generating a test PDF to inspect page margins, font rendering, line wraps, and physical print layout. There is no `Download Sample PDF` or `Print Test` button.
- **[High] Statutory Invoice Requirements Absent from Preview:** The invoice preview lacks mandatory legal elements for Latvian billing: Issuer Registration Number (Vienotais reģistrācijas numurs), VAT ID, Issuer Bank Account / IBAN, and payment reference structured format.
- **[Med] Logo & Branding Upload:** There is no affordance to upload a housing association / company logo, seal, or digital signature image to the invoice template.
- **[Med] Section Configuration Drawer / Inline Form:** All sections display a right-pointing chevron (`>`), but there are no visible inline controls to edit the contents of "Invoice details", "Payment details", or "Footer".

#### Technical Artifacts Leaking into UI
- **[Med] Internal QA Test Fixture in Live Invoice Preview:** In the live preview charges table, the final line item is titled **`"Zero price repro test"`** with quantity `1 month`, unit price `0.0000`, and total `0.00`. This is explicitly an internal bug-reproduction test fixture hardcoded or seeded into the template preview data.

---

### 05 — Settings: Admin Users (`05-settings-users.png`)

#### Dead Ends & Broken Affordances
- **[High] Existing Admins Rendered as Un-editable Plain Text:** The existing administrator `"Admin A (admin.a@example.com)"` is rendered as an unstyled string of plain text inside the card. There is **no edit button, no delete button, no remove button, and no kebab menu**.
- **[High] Visual Form/List Conflation:** The list of current admins and the form to invite a new admin are conflated into a single flat white box. The plain-text user string sits directly on top of the input field `admin@example.com` and the `Add admin` button without a table header, divider, or list container.

#### Absent Capabilities
- **[High] User Deletion / Revocation / Deactivation:** An administrator cannot be deleted, removed, or disabled. If an admin leaves an organization or has their credentials compromised, there is zero recourse in the UI to revoke access.
- **[High] Role-Based Access Control (RBAC):** There are no roles or permission tiers (e.g. Owner, Accountant, Property Manager, Read-Only). Every added user is blindly treated as an all-powerful admin.
- **[Med] Sign-In / Activity Timestamps & MFA Status:** No indication of when an admin last logged in, whether their account is active or pending invitation, or whether Multi-Factor Authentication (MFA) is enabled.
- **[Med] Invitation Lifecycle Management:** No visibility into whether an invitation email was sent, accepted, or bounced; no `Pending Invitations` section; and no `Resend Invitation` action.

#### Technical Artifacts Leaking into UI
- **[Low] Hardcoded Fixture User:** Default user is named `Admin A` with placeholder address `admin.a@example.com`.

#### Half-Built Features
- **Unfinished Placeholder Page:** The page has the structure of an early mock rather than a completed settings interface. There is no list component, no user avatars, and no security/audit linkages.

---

### 06 — Dwelling Detail (`06-dwelling-detail.png`)

#### Dead Ends & Broken Affordances
- **[High] Dead-End "Missing Data" Period Status:** In the "Period history" table, the billing period `2026-09` is flagged with a prominent warning badge: **`⚠ Missing data`** (with Invoice and Amount due shown as `—`). However, there is **no link, button, or drawer** allowing the admin to inspect what data is missing (e.g., missing water meter reading) or to resolve/input the missing data.
- **[High] Meter Controls Are "Archive-Only" (No Reading Input):** Under "Meters", each utility meter displays only an `Archive` button. There is no button to **submit a meter reading**, view meter reading history, or inspect current/previous consumption values.
- **[Med] Duplicated, Fragmented "Edit" Forms:** The dwelling details are split across two separate cards: "Basic information" (has its own `Edit` button) and "Additional information" at the very bottom (has another `Edit` button). Essential attributes like apartment number, notes, and building are arbitrarily isolated from occupant/billing information.
- **[Med] Isolated Save Button for Invoice Delivery:** "Invoice delivery" has two simple checkboxes (`Email`, `Paper`) with its own standalone `Save` button, creating inconsistent saving semantics compared to other sections.
- **[Med] Ambiguous Building-Wide vs. Dwelling-Specific Tariff Edits:** The "Recurring tariffs" section lists 5 tariffs with `Edit tariff →` buttons. The tags say `All dwellings · automatic`. Clicking "Edit tariff" from a specific dwelling detail view threatens to alter global building tariffs without warning.
- **[Low] Anchor Navigation Tab Disconnect:** A tab bar (`Overview`, `Account balance`, `Meters`, `Recurring tariffs`, `Residents`, `Messages`, `History`) is displayed at the top, but the page is implemented as an enormous monolithic vertical page containing all sections simultaneously.

#### Absent Capabilities
- **[High] Meter Reading Entry & Historical Consumption Log:** For a property billing tool tracking water meters (`m3`), there is no way to enter the current month's reading, inspect previous readings, or view meter serial numbers/installation dates.
- **[High] Dwelling Financial Ledger / Payment History:** Under "Account balance", the UI shows `Outstanding balance €0.00`, `Total debits €0.00`, and `Total credits €0.00`, with a button to `+ Add adjustment`. However, there is **no transaction history or payment history table** showing invoices issued to and payments received from this specific apartment.
- **[Med] Custom / Dwelling-Specific Tariff Assignment:** No capability to assign a special tariff, exemption, or custom rate to this individual apartment (only global automatic tariffs are displayed).
- **[Med] Resident Profile & Contact Details:** Under "Resident access", only a generic email and a `Remove` link are shown. There is no phone number, no invitation status, no permission role, and no indicator of who is the primary legal leaseholder.

#### Technical Artifacts Leaking into UI
- **[High] Severe E2E Automated Test Fixture Data Leaks:**
  - Dwelling title & Apartment number: **`Dwelling 00-E2E-1790005821669`**
  - Billing name: **`Nav Persisted 1790005826353`** (Developer shorthand for "Not Persisted" concatenated with a test runner timestamp)
  - Billing email: **`e2e-padded-1790005824862@example.com`**
  - Meter names: **`Second meter 1790005829251`**, **`Navigate-away meter 1790005829565`**, **`Recovered meter 1790005840703`**
  - Recurring tariff name: **`Zero price repro test`**
- **[Med] Raw Enum Database Codes in Audit History:** The "Audit history" table displays raw backend action codes: `DWELLING_ACCESS_ADDED`, `DWELLING_UPDATED`, `DWELLING_CREATED`.

#### Half-Built Features
- **UI Collision with Ghost Toast:** The persistent `"✓ All changes saved"` toast badge sits directly on top of and partially obscures the `+ Add resident` button.

---

### 07 — Payments & Reconciliation (`07-payments.png`)

#### Dead Ends & Broken Affordances
- **[High] Fully Dead-End Confirmed Payments Table (Zero Row Actions):** The table displays 15 confirmed payments, but there are **zero row actions**. There is no "View", no link to invoice `INV-202609-00010`, no link to the dwelling, no `Unmatch / Unlink` button, and no `Refund / Void` option. If a payment was matched to the wrong apartment, the administrator has no way to rectify the mistake.
- **[Med] Dead-End Import History:** In the "Import history" section at the bottom, imports (`current-month-statement.csv`, `previous-month-statement.csv`) only have a `View →` link. There is **no ability to delete, rollback, or undo** an errant bank statement import.

#### Absent Capabilities
- **[High] Manual Payment Entry (Cash / Direct Transfer):** The only way to record payments is through `Import bank statement`. There is **no button to manually enter a payment** (e.g. resident paying cash in the office, manual bank deposit, or non-banking offset).
- **[High] Search & Filtering on Payments:** In a financial ledger of incoming payments, there is:
  - **No search bar** (cannot search by invoice number, payer name, reference code, or amount).
  - **No date range filter** (cannot filter by payment date).
- **[Med] Export Payments / Accounting Reconciliation Report:** No button to export reconciled payments to CSV, Excel, or accounting formats.
- **[Med] Bulk Match / Batch Reconciliation Actions:** No checkboxes to bulk-confirm or bulk-reject proposed matches.

#### Technical Artifacts Leaking into UI
- **[High] Raw Database UUIDs in the "Payer" Column:** Every single row in the Payer column displays a raw database UUID: e.g. `Dwelling ebdd7e5f-b2fd-4c2e-812d-c06cb313f7fe`, `Dwelling 8066d501-ceb2-4931-955d-6dfed99e85e0`. There are no apartment numbers, resident names, or bank account holder names shown. An administrator cannot identify who paid without querying the database.

---

## 2. Cross-Cutting Systemic Defects

| Issue | Severity | Description |
| :--- | :---: | :--- |
| **Persistent "All changes saved" Ghost Toast** | **[High]** | A sticky `"✓ All changes saved"` toast notification appears permanently floating on almost every screen (01, 02, 03, 04, 05, 06, 07). On `06-dwelling-detail.png`, it physically blocks the `+ Add resident` button. On `07-payments.png`, it obscures payment row statuses. |
| **Trapped Navigation on Org Management** | **[High]** | Navigating to `03-organizations-list.png` completely strips out the main application sidebar, locking the user into an un-navigable screen with no backlink to the active workspace. |
| **Leaking E2E Test Fixtures & UUIDs** | **[High]** | Automated test fixtures (`00-E2E-...`, `Nav Persisted...`, `Zero price repro test`) and raw UUID strings (`dwelling ebdd7e5f...`) are displayed directly on primary user interfaces where business names and apartment numbers should appear. |
| **Audit Log Inaccessibility** | **[Med]** | The Audit Log (`02-audit.png`) is not present in the main navigation sidebar and lacks a breadcrumb hierarchy, making it an orphaned view. |

---

## 3. Top 5 Missing Capabilities (Ordered by Operational Impact)

1. **Manual Payment & Cash Entry (Payments Page)**  
   *Impact: [High / Critical Blocker]*  
   A property billing system that only supports CSV bank statement imports cannot support standard real-estate property management operations. Without the ability to manually record cash payments, direct bank transfers, or manual ledger adjustments, administrators cannot keep tenant balances accurate.

2. **Admin User Deletion, Deactivation & RBAC (Admin Users Page)**  
   *Impact: [High / Critical Security Risk]*  
   The admin management view provides no ability to remove, disable, or modify an existing administrator, and offers no role-based permission tiers. When staff leave or roles change, organization security cannot be maintained.

3. **Meter Reading Entry & History on Dwellings (Dwelling Detail Page)**  
   *Impact: [High / Core Billing Blocker]*  
   For utility billing based on consumption (hot/cold water in cubic meters), the dwelling detail view only offers an `Archive` button on meters. There is no interface to record monthly meter readings, view historical readings, or inspect current consumption, rendering the billing calculation pipeline unusable.

4. **Payment Correction & Un-matching / Rollback (Payments Page)**  
   *Impact: [High / Financial Integrity Risk]*  
   The confirmed payments list has zero interactive actions. If a payment is incorrectly matched or a bank statement CSV is imported twice or with errors, there is no way to unmatch a transaction, reverse a payment, or delete an import.

5. **Date Range & Identifier Filtering on Audit Log & Financial Tables (Audit & Payments Pages)**  
   *Impact: [High / Compliance & Operability]*  
   Both the Audit Log and Payments tables lack date range filters and search inputs. Once more than a few dozen records exist, locating specific transactions, investigating anomalies, or providing statutory audit trails becomes practically impossible.
