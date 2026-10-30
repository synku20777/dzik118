# 0013. Migration Center

Date: 2026-10-07

## Context

The setup (ADR 0012) tells a manager how to configure Namkopa. It does not help
a manager who leaves another system. The dwelling CSV import needs 11 exact
headers. It cannot read comma decimals or the Windows-1257 files that Latvian
Excel produces. The ledger has an `OPENING_BALANCE` type, but nothing posts it.

TypeSafe released Jev in September 2026. Jev answers typed questions (a choice,
a score, a yes or no) with probabilities. It cannot read out or write values.
Its own documentation says it is unreliable with arithmetic and dates, can be
steered by hostile input, and that code must do the confirmation.

## Decision

1. **One pipeline.** Upload or paste, decode, find the header row, propose a
   column mapping, the admin confirms, validate (read-only), preview, import in
   one transaction. Code does every step that handles values.
2. **Release 1 scope (this record covers phases 1 to 3).** Dwellings, billing
   recipients and delivery preference (phase 1), opening debt and credit
   (phase 2) and meters with latest readings (phase 3), all below. The Jev step
   (phase 4) and XLSX in the browser (phase 5) follow. Tariffs from a file are out. The setup presets
   cover them.
3. **Reading the file.** `decodeBytes` detects UTF-8, UTF-16 (with byte order
   mark), Windows-1257, Windows-1251 and Windows-1252, and the page has an
   encoding picker. `parseTable` guesses the delimiter (`; , tab |`), skips
   title lines above the header, and leaves out total rows ("Kopā", "Total",
   "Итого"). `values.ts` parses decimals ("1 234,50", "(12.50)", "12,5-"),
   dates (`DD.MM.YYYY`, ISO), booleans and delivery words in EN, LV and RU. A
   number such as "1.234" with no column hint is "ambiguous", not guessed.
4. **Mapping by dictionary.** Each target field has EN, LV and RU aliases. A
   header scores 1.0 for an exact alias and 0.7 to 0.85 for a partial match. A
   column whose values do not fit the field (shape check) loses half its score.
   Each field goes to one column only. The admin always confirms.
5. **Saved mappings.** After an import, the mapping (column names, no values) is
   saved under a fingerprint of the sorted, folded headers. The same header set
   in a later file gets the same mapping, with a notice.
6. **Presence-aware updates.** In update mode the import changes only the
   mapped columns, and an empty cell leaves the saved value. An import with
   only a delivery column does not blank the address or the area.
7. **Dwelling numbers are text.** "01" and "1" are two dwellings.
8. **Nothing is stored before the last step.** The raw file text moves between
   steps in a hidden field (1 MB, 2,000 rows). It is not stored. Every step
   parses it again, checks the mapping again (known fields, none twice, required
   fields present), and the import runs all validation again in its own
   transaction. A changed mapping cannot reach the database.
9. **Page POST safety.** The pages call `isSameOriginRequest`: a present
   `Origin` must equal the site, and a missing `Origin` needs
   `Sec-Fetch-Site: same-origin`. Downloaded CSV files use `escapeFormulae`,
   because error rows repeat values from the admin's own file.
10. **Records.** `migration_imports` stores counts, the mapping, the file name
    and a SHA-256 of the file (information only). It stores no cell values. The
    hash does not block a second import: the database rules (unique dwelling
    number) stop duplicates and stay correct when a file is fixed and run again.
    Both tables use row-level security with no policy and no grant to the API
    roles, like the other internal tables.
11. **Performance.** A batch case sync (`syncCasesForDwellings`) and bulk audit
    inserts replace the per-row queries. 2,000 dwellings import in about half a
    second with 21 queries.
12. **Jev (phase 4).** Jev only proposes a mapping for a column the dictionary
    cannot place. It gets column shapes and header words from a closed
    vocabulary (other words become "?"), never cell values. The admin confirms.
    The Migration Center works with no key. Jev is switched on only if an
    offline evaluation shows a gain over the dictionary.

## Opening balances (phase 2)

13. **One entry per dwelling.** The import posts one `OPENING_BALANCE` ledger
    entry per dwelling: debit if the resident owes, credit if the resident has
    overpaid. The amount is in the organization currency with exactly two
    decimals. A value such as "12,505" is an error, not a rounded number. A zero
    balance is skipped. The entry carries `migrationImportId`, the source row
    and, if the file has it, the original due date.
14. **The database enforces "once".** A partial unique index on
    `account_entries (organization_id, dwelling_id)` where the type is
    `OPENING_BALANCE` and the metadata has `migrationImportId` stops a second
    migrated balance. The older opening balances (one per unpaid v1 invoice, with
    a known invoice) are not covered. The review shows an already migrated
    dwelling as a skip. If two admins import at the same time, the second import
    rolls back with a clear message. Corrections are manual adjustments.
15. **Rows that block the import.** Unknown or archived dwelling, duplicate
    number, bad amount, negative debt or credit column, bad due date, and a
    dwelling with an invoice that is already prepared (that invoice froze its
    balance). A draft invoice does not block, because preparing recalculates it.
    Balances never create dwellings.
16. **Balance date.** The date must not be in the future, and not after the issue
    date of the first billing period (the starting-readings period does not
    count). A later balance would not appear on the first invoice.
17. **Sign.** One signed balance column, or separate debt and credit columns.
    The admin chooses whether a positive balance means debt or overpayment. The
    review lists every amount before anything is posted.
18. **Migrated debt is not late-fee principal.** The owner's rule: opening debt
    becomes "previous outstanding" at once, but it has no known due date. The late
    fee principal is `max(balance - protected, 0)`. `protected` is the migrated
    opening debt minus net payments (payments minus payment reversals, never below
    zero), never below zero. Payments settle the migrated debt first. Manual
    credits and write-offs do not reduce `protected`, so the rule can only lower a
    fee. A migrated credit protects nothing. Older opening balances stay in the
    principal. `penaltySnapshot.excludedOpeningDebt` records the amount. The owner
    must confirm the "payments settle migrated debt first" reading.
19. **Date filter, narrow on purpose.** The plan proposed a balance as of the
    invoice issue date for every ledger entry. That changes every organization:
    an invoice issue date is fixed per period and can be earlier than the day the
    invoice is made, so a payment booked in between would disappear from the
    invoice. Only a migrated opening balance dated after the issue date is left
    out (`getDwellingAccountBalance(..., asOf)`).
20. **Reconciliation.** After the import the report page compares the totals of
    the file with the totals rebuilt from the ledger entries of this import, and
    lists each posted balance with the dwelling's balance now. It downloads as a
    CSV. Currency columns are not supported: all amounts are in the organization
    currency.

## Meters and latest readings (phase 3)

21. **One starting reading per meter.** The latest reading of each meter becomes
    its starting reading (ADR 0012): its position at the end of the month before
    the first billing month, stored in the locked opening-readings period. The
    data model has no history, so older readings are not kept. A file with
    several dated readings of one meter keeps the latest; without dates, a
    repeated meter is an error. The reading date is only used for this choice
    and for the rule below. It is not stored.
22. **Date rule.** A reading dated after the first billing period starts is an
    error. It would be stored as the closing value of the previous month, so the
    first days of the first month would not be billed. Reading from the first day
    itself is accepted.
23. **Needs the first billing period.** Without it there is no month to store the
    reading in. The page shows a link to setup step 3 instead of the upload
    form, and the import refuses.
24. **Meters.** A row means the meter with that serial number, or the one active
    meter of that type in the dwelling. Two candidates is an error ("add the
    serial number"). A missing meter is created. The unit comes from the file;
    without it water and gas get `m3` and electricity `kWh`, and heat and other
    types must say. Meter types are read in EN, LV and RU; "water" without hot
    or cold is refused.
25. **Replacing and protecting.** A reading equal to the saved starting reading is
    skipped, so a second run does nothing. A different one replaces it, with a
    warning. A meter that already has a reading in a billing period keeps its
    starting reading (its consumption was computed from it): the row is an
    error, unless the value is unchanged.
26. **Bulk writes.** `writeOpeningReadings` (also behind the typed starting
    readings and the older CSV import) is now bulk: lock, check, upsert and audit
    in a few statements. A new `recalculateCaseReadinessForDwellings` updates the
    open cases of many dwellings with one batch of queries and one UPDATE. A test
    checks that the old per-case code finds nothing left to change. 2,000 readings
    with 2,000 new meters take about one second and 50 statements.
27. **Locks.** The import takes the opening-period lock (as every starting
    reading write does) and a row lock on the dwellings in the file, which a meter
    added by hand also needs (its insert takes a key share on the dwelling). A meter
    being added at the same moment is therefore used, not duplicated.
28. **Decimal mark from the delimiter.** A column where every number has three
    decimals ("123,456", as water readings do) cannot be read from its values.
    The delimiter decides: Excel writes ";" between cells exactly when the decimal
    mark is a comma, and a "," delimiter cannot hold unquoted decimal commas.
    This applies to all kinds of import. Pasted cells (tab) stay ambiguous.

## Consequences

- A second import of the same file does nothing (all rows exist).
- Sending any data to a new processor (OpenRouter, TypeSafe) needs a
  subprocessor entry and a privacy page change before phase 4 goes live.
- The file text is in the page HTML for the admin who uploaded it. Do not log
  request bodies for these routes.
- An opening balance cannot be edited or deleted (the ledger is append-only).
  A wrong balance is corrected with a manual adjustment on the dwelling page.
- A late fee on an invoice with migrated debt is lower than before: the
  principal excludes the unpaid migrated debt.
