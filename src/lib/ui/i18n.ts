import type { AstroCookies } from "astro";

export type Locale = "en" | "lv" | "ru";

// A presentation preference only; never changes organization or invoice data.
export function uiLocale(cookies: AstroCookies, url: URL): Locale {
  const requested = url.searchParams.get("lang");
  if (requested === "en" || requested === "lv" || requested === "ru") {
    cookies.set("ui_locale", requested, {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
    });
    return requested;
  }
  const cookieValue = cookies.get("ui_locale")?.value;
  return cookieValue === "lv" || cookieValue === "ru" ? cookieValue : "en";
}

const lv: Record<string, string> = {
  "Current charges": "Pašreizējā perioda izmaksas",
  "Previous outstanding": "Iepriekšējais parāds",
  "Previous balance": "Iepriekšējais atlikums",
  "Credit applied": "Piemērotais kredīts",
  "Account credit": "Konta kredīts",
  "Amount due": "Apmaksai",
  "Late fee": "Nokavējuma maksa",
  "Manual adjustment": "Manuāla korekcija",
  "Current bill": "Pašreizējais rēķins",
  "Account balance": "Konta atlikums",
  "Account activity": "Konta darbības",
  "Add adjustment": "Pievienot korekciju",
  "Adjustments create an auditable account entry and never edit the balance directly.":
    "Katra korekcija tiek skaidri ierakstīta kontā — tā nekad nemaina atlikumu tieši.",
  "Charge adjustment": "Maksas korekcija",
  "Credit adjustment": "Kredīta korekcija",
  Debit: "Debets",
  Credit: "Kredīts",
  Balance: "Atlikums",
  "Preparation checks": "Sagatavošanas pārbaudes",
  "Recipient details complete": "Saņēmēja dati ir pilnīgi",
  "Issuer and payment details complete":
    "Izrakstītāja un maksājuma dati ir pilnīgi",
  "Current charges calculated": "Pašreizējā perioda izmaksas aprēķinātas",
  "Account balance resolved": "Konta atlikums noteikts",
  "Late-payment rules": "Nokavēto maksājumu noteikumi",
  "Changes apply to future calculations. Sent invoices keep their original financial snapshot.":
    "Izmaiņas attiecas tikai uz nākamajiem aprēķiniem. Nosūtītie rēķini paliek tādi, kādi bija nosūtīšanas brīdī.",
  "Late fees enabled": "Nokavējuma maksas ir ieslēgtas",
  "Daily rate": "Dienas likme",
  "Grace period": "Labvēlības periods",
  "days after the due date": "dienas pēc apmaksas termiņa",
  "Maximum total penalty": "Maksimālā kopējā soda maksa",
  "of eligible principal": "no piemērojamās pamatsummas",
  "Stop accrual at cap": "Pārtraukt uzkrāšanu pie limita",
  "Save late-payment rules": "Saglabāt nokavēto maksājumu noteikumus",
  "Remaining after allocation": "Atlikums pēc piesaistes",
  "Credit created": "Izveidots kredīts",
  "carried balance": "pārnestais atlikums",
  "credit applied": "piemērotais kredīts",
  "Admin guide": "Administratora ceļvedis",
  "Set up your organization and complete your first billing cycle.":
    "Iestatiet organizāciju un pabeidziet pirmo norēķinu ciklu.",
  "Start here": "Sāciet šeit",
  "Initial setup": "Sākotnējā iestatīšana",
  "Monthly billing cycle": "Ikmēneša norēķinu cikls",
  "Frequently asked questions": "Biežāk uzdotie jautājumi",
  "On this page": "Šajā lapā",
  "Quick reference": "Īsā uzziņa",
  Help: "Palīdzība",
  "Invoice status guide": "Rēķinu statusu ceļvedis",
  "Use the status to understand what can happen next.":
    "Izmantojiet statusu, lai saprastu, ko var darīt tālāk.",
  "Work from the current period: resolve missing inputs, prepare invoices, send them and reconcile payments.":
    "Strādājiet ar pašreizējo periodu: aizpildiet trūkstošos datus, sagatavojiet un nosūtiet rēķinus, pēc tam saskaņojiet maksājumus.",
  "Organization settings with issuer and payment details.":
    "Organizācijas iestatījumi ar izrakstītāja un maksājuma datiem.",
  "Dwelling directory with filters and dwelling details.":
    "Īpašumu saraksts ar filtriem un īpašumu datiem.",
  "Billing period history and period actions.":
    "Norēķinu periodu vēsture un periodu darbības.",
  "Admin dashboard with billing totals and work requiring attention.":
    "Administratora pārskats ar norēķinu kopsummām un darbiem, kam jāpievērš uzmanība.",
  "Payment reconciliation workspace with transaction states.":
    "Maksājumu saskaņošanas darbvieta ar darījumu statusiem.",
  "Required input is missing; generation is blocked.":
    "Trūkst obligātu datu; rēķina izveide ir bloķēta.",
  "The invoice can still be reviewed and regenerated.":
    "Rēķinu vēl var pārskatīt un pārrēķināt.",
  "The invoice is approved and ready to send.":
    "Rēķins ir apstiprināts un gatavs nosūtīšanai.",
  "The invoice was delivered successfully.": "Rēķins ir veiksmīgi piegādāts.",
  "A full payment has been confirmed.": "Pilns maksājums ir apstiprināts.",
  "The due date passed without a confirmed full payment.":
    "Apmaksas termiņš ir pagājis bez apstiprināta pilna maksājuma.",
  "Follow these steps in order for your first billing run. After setup, repeat the monthly cycle from period creation onward.":
    "Pirmajā norēķinu reizē veiciet šīs darbības secīgi. Pēc iestatīšanas katru mēnesi atkārtojiet ciklu, sākot ar perioda izveidi.",
  "First-time setup": "Pirmreizējā iestatīšana",
  "Repeat every month": "Atkārtot katru mēnesi",
  Step: "Solis",
  "Open settings": "Atvērt iestatījumus",
  "Open dwellings": "Atvērt īpašumus",
  "Open billing rules": "Atvērt norēķinu noteikumus",
  "Open periods": "Atvērt periodus",
  "Open dashboard": "Atvērt pārskatu",
  "Open payments": "Atvērt maksājumus",
  "Open messages": "Atvērt ziņojumus",
  "Complete organization details": "Aizpildiet organizācijas datus",
  "Add the legal name, address, contact details, bank name and IBAN used on invoices.":
    "Pievienojiet juridisko nosaukumu, adresi, kontaktinformāciju, bankas nosaukumu un IBAN, kas tiks izmantots rēķinos.",
  "Ready when invoice issuer and payment details are complete.":
    "Gatavs, kad aizpildīti rēķina izrakstītāja un maksājuma dati.",
  "Add dwellings": "Pievienojiet īpašumus",
  "Create dwellings individually or import them from CSV. Check numbers, types, occupants, areas and resident counts.":
    "Izveidojiet īpašumus atsevišķi vai importējiet tos no CSV. Pārbaudiet numurus, veidus, iemītniekus, platības un iedzīvotāju skaitu.",
  "Ready when every billable unit appears in the dwelling directory.":
    "Gatavs, kad visi norēķinu objekti redzami īpašumu sarakstā.",
  "Assign residents and meters": "Piešķiriet iedzīvotājus un skaitītājus",
  "Open each dwelling to assign resident access, add billing contact details and register its meters.":
    "Atveriet katru īpašumu, lai piešķirtu iedzīvotāju piekļuvi, pievienotu norēķinu kontaktinformāciju un reģistrētu skaitītājus.",
  "Ready when residents can access the correct dwelling and required meters are listed.":
    "Gatavs, kad iedzīvotāji var piekļūt pareizajam īpašumam un ir norādīti nepieciešamie skaitītāji.",
  "Configure tariffs and rules": "Iestatiet tarifus un noteikumus",
  "Add the billing rules that determine fixed, area, resident-count or meter-consumption charges.":
    "Pievienojiet norēķinu noteikumus fiksētām, platības, iedzīvotāju skaita vai skaitītāju patēriņa maksām.",
  "Ready when every required charge has an enabled rule for the billing date.":
    "Gatavs, kad katrai nepieciešamajai maksai norēķinu datumā ir spēkā esošs noteikums.",
  "Create the billing period": "Izveidojiet norēķinu periodu",
  "Set the billing window, reading deadline, invoice issue date and due date. Creating a period creates a case for each active dwelling.":
    "Norādiet norēķinu intervālu, rādījumu termiņu, rēķina datumu un apmaksas termiņu. Izveidojot periodu, katram aktīvajam īpašumam tiek izveidots norēķinu ieraksts.",
  "Ready when the new OPEN period appears in period history.":
    "Gatavs, kad jaunais ATVĒRTAIS periods redzams periodu vēsturē.",
  "Collect missing readings": "Savāciet trūkstošos rādījumus",
  "Use the dashboard attention list or monthly workbench to find missing readings. Residents may submit their own readings while permitted.":
    "Izmantojiet pārskata uzmanības sarakstu vai mēneša darbvietu, lai atrastu trūkstošos rādījumus. Iedzīvotāji var iesniegt savus rādījumus, kamēr tas ir atļauts.",
  "Ready when required cases no longer show missing readings.":
    "Gatavs, kad nepieciešamajos norēķinu ierakstos vairs nav trūkstošu rādījumu.",
  "Generate and review invoices": "Izveidojiet un pārskatiet rēķinus",
  "Generate eligible invoices in the workbench, then review calculation lines, recipient details, dates and totals.":
    "Izveidojiet atbilstošos rēķinus darbvietā un pārskatiet aprēķina rindas, saņēmēja datus, datumus un summas.",
  "Ready when correct invoices are in DRAFT and validation blockers are resolved.":
    "Gatavs, kad pareizie rēķini ir MELNRAKSTA statusā un novērstas validācijas problēmas.",
  "Prepare and send invoices": "Sagatavojiet un nosūtiet rēķinus",
  "Prepare approved drafts, then send prepared invoices. A successful delivery moves the case to SENT and preserves the financial document.":
    "Sagatavojiet apstiprinātos melnrakstus un nosūtiet sagatavotos rēķinus. Veiksmīga piegāde maina statusu uz NOSŪTĪTS un saglabā finanšu dokumentu.",
  "Ready when intended invoices show SENT or a clear delivery error to resolve.":
    "Gatavs, kad paredzētie rēķini ir NOSŪTĪTI vai redzama skaidra piegādes kļūda.",
  "Reconcile incoming payments": "Saskaņojiet saņemtos maksājumus",
  "Import a bank statement, inspect the preview, confirm the import and review proposed or unmatched transactions.":
    "Importējiet bankas izrakstu, pārskatiet priekšskatījumu, apstipriniet importu un pārbaudiet ierosinātos vai nesaskaņotos darījumus.",
  "Ready when valid matches are confirmed and the corresponding invoices show PAID.":
    "Gatavs, kad pareizās atbilstības ir apstiprinātas un attiecīgie rēķini ir APMAKSĀTI.",
  "Handle questions and exceptions": "Apstrādājiet jautājumus un izņēmumus",
  "Review resident messages, overdue invoices, unmatched payments and delivery failures. Resolve conversations when the issue is closed.":
    "Pārskatiet iedzīvotāju ziņojumus, kavētos rēķinus, nesaskaņotos maksājumus un piegādes kļūdas. Atrisiniet sarunas, kad jautājums ir slēgts.",
  "Ready when attention items have an owner or are resolved.":
    "Gatavs, kad uzmanības vienumiem ir atbildīgais vai tie ir atrisināti.",
  "What do the invoice statuses mean?": "Ko nozīmē rēķinu statusi?",
  "MISSING DATA means a required input is absent. DRAFT can still be regenerated. PREPARED is approved for sending. SENT was delivered successfully. OVERDUE is sent and unpaid after its due date. PAID has a confirmed full payment.":
    "TRŪKST DATU nozīmē, ka trūkst kādas nepieciešamas informācijas. MELNRAKSTU vēl var pārrēķināt. SAGATAVOTS ir apstiprināts nosūtīšanai. NOSŪTĪTS ir veiksmīgi piegādāts. KAVĒTS ir nosūtīts un nav apmaksāts pēc termiņa. APMAKSĀTS ir pilnībā apmaksāts.",
  "Why can’t I generate an invoice?": "Kāpēc nevaru izveidot rēķinu?",
  "Generation is blocked when required readings are missing or the period is locked. Open the affected dwelling from the workbench to see the required input.":
    "Rēķina izveide ir bloķēta, ja trūkst obligātu rādījumu vai periods ir slēgts. Atveriet attiecīgo īpašumu darbvietā, lai skatītu nepieciešamos datus.",
  "Why can’t I prepare an invoice?": "Kāpēc nevaru sagatavot rēķinu?",
  "The invoice must be a DRAFT with complete issuer, recipient and payment details. Correct the linked settings, then regenerate the draft to refresh its snapshot.":
    "Rēķinam jābūt MELNRAKSTA statusā ar pilnīgiem izrakstītāja, saņēmēja un maksājuma datiem. Labojiet norādītos iestatījumus un pārrēķiniet melnrakstu, lai atjauninātu tā momentuzņēmumu.",
  "Why can’t I send an invoice?": "Kāpēc nevaru nosūtīt rēķinu?",
  "Only PREPARED invoices with a billing email can be sent normally. If delivery fails, correct the cause and use the available retry or resend action.":
    "Parasti var nosūtīt tikai SAGATAVOTUS rēķinus ar norēķinu e-pasta adresi. Ja piegāde neizdodas, novērsiet cēloni un izmantojiet pieejamo atkārtošanas darbību.",
  "Can I edit a sent invoice?": "Vai varu rediģēt nosūtītu rēķinu?",
  "No. A sent invoice is an immutable financial record. Changes to dwellings, tariffs or organization settings apply to future generated invoices.":
    "Nē. Nosūtīts rēķins ir nemainīgs finanšu ieraksts. Īpašumu, tarifu vai organizācijas iestatījumu izmaiņas attiecas uz turpmāk izveidotiem rēķiniem.",
  "What should I do with an unmatched payment?":
    "Ko darīt ar nesaskaņotu maksājumu?",
  "Review its amount, currency, payer and reference. Leave it unmatched until the correct invoice can be identified; do not confirm an uncertain match.":
    "Pārskatiet summu, valūtu, maksātāju un maksājuma mērķi. Atstājiet darījumu nesaskaņotu, līdz var noteikt pareizo rēķinu; neapstipriniet nepārliecinošu atbilstību.",
  "When should I lock a period?": "Kad slēgt periodu?",
  "Lock a period after normal reading and invoice input work is complete. Locked periods remain available for history but block normal reading edits and invoice regeneration.":
    "Slēdziet periodu pēc rādījumu un rēķinu ievades darbu pabeigšanas. Slēgtie periodi paliek pieejami vēsturē, bet bloķē parastu rādījumu rediģēšanu un rēķinu pārrēķinu.",
  "Auto-send day of month (1-28)": "Automātiskās nosūtīšanas diena (1–28)",
  "Automatically generate invoices each period":
    "Automātiski izveidot rēķinus katrā periodā",
  "Automatically send prepared invoices":
    "Automātiski nosūtīt sagatavotos rēķinus",
  "Only applies when auto-send is enabled above.":
    "Tiek piemērots tikai tad, ja ieslēgta automātiska nosūtīšana.",
  "Area (m2)": "Platība (m²)",
  Fixed: "Fiksēts",
  "Manual amount": "Manuāla summa",
  "Manual quantity": "Manuāls daudzums",
  "Meter consumption": "Skaitītāja patēriņš",
  "Meter type (only for meter consumption rules)":
    "Skaitītāja veids (patēriņa noteikumiem)",
  "Code (unique identifier, e.g. cold_water)":
    "Kods (unikāls identifikators, piem., cold_water)",
  "Unit (e.g. m3, month, person)": "Mērvienība (piem., m3, mēnesis, persona)",
  "Effective until (optional)": "Spēkā līdz (neobligāti)",
  Mode: "Režīms",
  "Create only (default) -- existing numbers become errors":
    "Tikai izveidot (noklusējums) — esoši numuri rada kļūdas",
  "Update -- existing numbers are updated":
    "Atjaunināt — esoši numuri tiek atjaunināti",
  "Back to dwellings": "Atpakaļ uz īpašumiem",
  "Back to payments": "Atpakaļ uz maksājumiem",
  "Export dwellings (CSV)": "Eksportēt īpašumus (CSV)",
  "Export meter readings (CSV)": "Eksportēt rādījumus (CSV)",
  "Import bank statement (CSV)": "Importēt bankas izrakstu (CSV)",
  "Import dwellings (CSV)": "Importēt īpašumus (CSV)",
  "Confirm even if lower than previous":
    "Apstiprināt arī tad, ja rādījums ir mazāks par iepriekšējo",
  "This period is locked; readings can no longer be edited.":
    "Periods ir slēgts; rādījumus vairs nevar mainīt.",
  "This dwelling has no active meters.": "Šim īpašumam nav aktīvu skaitītāju.",
  "This exact file has already been imported for this organization. Importing it again will be blocked.":
    "Šis fails jau ir importēts šajā organizācijā. Atkārtots imports tiks bloķēts.",
  Resend: "Nosūtīt atkārtoti",
  "Revoke access link": "Atsaukt piekļuves saiti",
  When: "Kad",
  To: "Kam",
  Error: "Kļūda",
  Invoiced: "Izrakstīts",
  "Next period →": "Nākamais periods →",
  "Next →": "Nākamā →",
  "View conversations for this dwelling →": "Skatīt īpašuma sarunas →",
  "Resident access is assigned per dwelling, from each dwelling's detail page.":
    "Piekļuve tiek piešķirta katra īpašuma detalizētajā skatā.",
  "You don't belong to any organization yet. Create one below.":
    "Jūs vēl nepiederat nevienai organizācijai. Izveidojiet to zemāk.",
  "You don't have access to any dwellings.":
    "Jums nav piekļuves nevienam īpašumam.",
  "No active meters for this dwelling.": "Šim īpašumam nav aktīvu skaitītāju.",
  "No archived meters for this dwelling.":
    "Šim īpašumam nav arhivētu skaitītāju.",
  "Filter meters": "Filtrēt skaitītājus",
  "No consumption history yet.": "Vēl nav patēriņa vēstures.",
  "Invoice email is missing. Add a billing email before sending.":
    "Trūkst rēķina e-pasta adreses. Pievienojiet to pirms nosūtīšanas.",
  "Correct the details and regenerate the draft before preparing it again.":
    "Labojiet datus un pārrēķiniet melnrakstu pirms atkārtotas sagatavošanas.",
  Upload: "Augšupielādēt",
  Preview: "Priekšskatījums",
  "Confirm import": "Apstiprināt importu",
  "Choose another file": "Izvēlēties citu failu",
  "CSV file": "CSV fails",
  "Import dwellings": "Importēt īpašumus",
  "Bank statement CSV file": "Bankas izraksta CSV fails",
  Row: "Rinda",
  Errors: "Kļūdas",
  "Review the preview before confirming. Only confirmation saves data.":
    "Pārskatiet datus pirms apstiprināšanas. Dati tiek saglabāti tikai pēc apstiprinājuma.",
  Name: "Nosaukums",
  Address: "Adrese",
  City: "Pilsēta",
  "Postal code": "Pasta indekss",
  Phone: "Tālrunis",
  "Bank name": "Bankas nosaukums",
  "Billing address": "Norēķinu adrese",
  "Billing email": "Norēķinu e-pasts",
  "Occupant name": "Iemītnieka vārds",
  "Resident count": "Iedzīvotāju skaits",
  "Resident access": "Iedzīvotāju piekļuve",
  Meters: "Skaitītāji",
  "Serial number": "Sērijas numurs",
  Label: "Nosaukums",
  Unit: "Mērvienība",
  "Add meter": "Pievienot skaitītāju",
  Assign: "Piešķirt",
  Remove: "Noņemt",
  "Add admin": "Pievienot administratoru",
  "Admin users": "Administratori",
  "Your organizations": "Jūsu organizācijas",
  "Create organization": "Izveidot organizāciju",
  Create: "Izveidot",
  Account: "Konts",
  "Dwelling access": "Piekļuve īpašumiem",
  Timezone: "Laika josla",
  Locale: "Valoda",
  "Invoice number prefix": "Rēķina numura prefikss",
  "Default due days": "Noklusējuma apmaksas dienu skaits",
  "Tariffs and rules": "Tarifi un noteikumi",
  "Create rule": "Izveidot noteikumu",
  "VAT %": "PVN %",
  Effective: "Spēkā",
  Edit: "Rediģēt",
  "Effective from": "Spēkā no",
  "Effective until": "Spēkā līdz",
  "Audit log": "Audita žurnāls",
  "All actions": "Visas darbības",
  Action: "Darbība",
  "Entity type": "Objekta veids",
  Time: "Laiks",
  Actor: "Lietotājs",
  Entity: "Objekts",
  Details: "Detaļas",
  Updated: "Atjaunināts",
  Resolve: "Atrisināt",
  "No conversations match this filter.": "Filtram neatbilst neviena saruna.",
  "No conversations yet.": "Vēl nav sarunu.",
  "This conversation is resolved.": "Šī saruna ir atrisināta.",
  "No residents assigned.": "Nav piešķirtu iedzīvotāju.",
  "Meter added": "Skaitītājs pievienots",
  "Resident added": "Iedzīvotājs pievienots",
  "This resident already has access.": "Šim iedzīvotājam jau ir piekļuve.",
  "No billing rules yet.": "Vēl nav norēķinu noteikumu.",
  "No dwellings assigned.": "Nav piešķirtu īpašumu.",
  "No transactions in this import.": "Šajā importā nav darījumu.",
  "Match status": "Saskaņošanas statuss",
  "No audit events match this filter.":
    "Filtram neatbilst neviens audita notikums.",
  "Legal and contact details": "Juridiskā un kontaktinformācija",
  "Bank details": "Bankas rekvizīti",
  Automation: "Automatizācija",
  "Billing defaults": "Norēķinu noklusējuma iestatījumi",
  "Settings are not available yet. Existing invoice documents remain available from billing periods.":
    "Iestatījumi vēl nav pieejami. Esošie rēķini ir pieejami norēķinu periodos.",
  Dashboard: "Pārskats",
  Periods: "Periodi",
  Dwellings: "Īpašumi",
  Payments: "Maksājumi",
  Messages: "Ziņojumi",
  Settings: "Iestatījumi",
  "Property Billing": "Īpašumu rēķini",
  Administration: "Administrēšana",
  "Resident portal": "Iedzīvotāja portāls",
  Portal: "Portāls",
  "Sign out": "Izrakstīties",
  "Switch organization": "Mainīt organizāciju",
  Navigation: "Navigācija",
  "Skip to content": "Pāriet uz saturu",
  Menu: "Izvēlne",
  Profile: "Profils",
  Overview: "Pārskats",
  Invoices: "Rēķini",
  Dwelling: "Īpašums",
  "Missing data": "Trūkst datu",
  Draft: "Melnraksts",
  Prepared: "Sagatavots",
  Sent: "Nosūtīts",
  Paid: "Apmaksāts",
  Overdue: "Kavēts",
  Open: "Atvērts",
  Locked: "Slēgts",
  Active: "Aktīvs",
  Archived: "Arhivēts",
  New: "Jauns",
  Resolved: "Atrisināts",
  Proposed: "Ierosināts",
  Confirmed: "Apstiprināts",
  Rejected: "Noraidīts",
  Unmatched: "Nesaskaņots",
  Failed: "Neizdevās",
  Pending: "Gaida",
  Enabled: "Ieslēgts",
  Disabled: "Izslēgts",
  "Total invoiced": "Rēķinu kopsumma",
  Outstanding: "Neapmaksāts",
  "Cold water": "Aukstais ūdens",
  "Hot water": "Karstais ūdens",
  Consumption: "Patēriņš",
  "Needs attention": "Nepieciešama uzmanība",
  "Case status": "Norēķinu statuss",
  "Open workbench": "Atvērt norēķinu darbvietu",
  "Monitor billing, payments and work requiring attention.":
    "Pārskatiet rēķinus, maksājumus un veicamos darbus.",
  "No billing periods yet.": "Vēl nav norēķinu periodu.",
  "Create a period to start the monthly billing workflow.":
    "Izveidojiet periodu, lai sāktu ikmēneša norēķinus.",
  "Nothing needs attention right now.": "Pašlaik nav steidzamu darbu.",
  "Add readings": "Pievienot rādījumus",
  "Review invoice": "Pārskatīt rēķinu",
  "Review payments": "Pārskatīt maksājumus",
  "Ready to generate": "Gatavs rēķina izveidei",
  "Ready to invoice": "Gatavs rēķinam",
  "Generate the invoice": "Izveidot rēķinu",
  "Ready to send": "Gatavs nosūtīšanai",
  "Readings are required before generating an invoice.":
    "Pirms rēķina izveides nepieciešami rādījumi.",
  "Payment is past its due date. Review reconciliation.":
    "Maksājuma termiņš ir pagājis. Pārskatiet maksājumu saskaņošanu.",
  "All readings are present. Generate the invoice in the workbench.":
    "Visi rādījumi ir ievadīti. Izveidojiet rēķinu darbvietā.",
  "Billing periods": "Norēķinu periodi",
  "Period history": "Periodu vēsture",
  "Review past periods or open a monthly billing workbench.":
    "Pārskatiet iepriekšējos periodus vai atveriet norēķinu darbvietu.",
  "Create period": "Izveidot periodu",
  "Total periods": "Periodu skaits",
  "Latest period": "Jaunākais periods",
  Period: "Periods",
  Dates: "Datumi",
  "Reading deadline": "Rādījumu termiņš",
  "Issue date": "Izrakstīšanas datums",
  "Due date": "Apmaksas termiņš",
  Status: "Statuss",
  Actions: "Darbības",
  View: "Skatīt",
  Year: "Gads",
  Month: "Mēnesis",
  "Billing window": "Norēķinu intervāls",
  "Invoice dates": "Rēķina datumi",
  "Starts on": "Sākums",
  "Ends on": "Beigas",
  "Invoice issue date": "Rēķina datums",
  "Invoice due date": "Rēķina apmaksas termiņš",
  "Monthly workbench": "Mēneša norēķini",
  "Collect readings, generate invoices, then prepare and send.":
    "Ievadiet rādījumus, izveidojiet rēķinus, sagatavojiet un nosūtiet tos.",
  "Period navigation": "Periodu navigācija",
  "Lock this period?": "Slēgt šo periodu?",
  "Locking this period prevents normal reading edits and invoice regeneration. Historical data will remain available.":
    "Perioda slēgšana neļaus parastā veidā mainīt rādījumus un pārrēķināt rēķinus. Vēsturiskie dati paliks pieejami.",
  Cancel: "Atcelt",
  "Billing workflow": "Norēķinu darba plūsma",
  "billing cases in this period": "norēķinu ieraksti šajā periodā",
  "Select a stage to filter the queue":
    "Izvēlieties posmu, lai filtrētu sarakstu",
  "Filter by workflow stage": "Filtrēt pēc darba plūsmas posma",
  All: "Visi",
  "All billing cases": "Visi norēķinu ieraksti",
  "Resolve inputs": "Aizpildīt datus",
  "Review and prepare": "Pārskatīt un sagatavot",
  "Payment needs review": "Jāpārskata maksājums",
  Delivered: "Piegādāts",
  Complete: "Pabeigts",
  "Financial summary": "Finanšu kopsavilkums",
  "invoices generated": "rēķini izveidoti",
  "invoices prepared": "rēķini sagatavoti",
  "invoices sent": "rēķini nosūtīti",
  skipped: "izlaisti",
  "Billing cases": "Norēķinu ieraksti",
  "Resolve blockers, then move each invoice to its next stage.":
    "Novērsiet šķēršļus un virziet katru rēķinu uz nākamo posmu.",
  "Search dwelling…": "Meklēt īpašumu…",
  "Clear filters": "Notīrīt filtrus",
  selected: "izvēlēti",
  "eligible to prepare": "var sagatavot",
  "eligible to send": "var nosūtīt",
  "Prepare eligible": "Sagatavot atbilstošos",
  "Send eligible": "Nosūtīt atbilstošos",
  "Clear selection": "Notīrīt izvēli",
  "Billing inputs": "Norēķinu dati",
  "Next action": "Nākamā darbība",
  missing: "trūkst",
  "Required readings complete": "Obligātie rādījumi ievadīti",
  "Billing email ready": "Norēķinu e-pasts norādīts",
  "Billing email missing": "Trūkst norēķinu e-pasta",
  "Recipient details incomplete": "Saņēmēja dati nav pilnīgi",
  "Issuer or payment details incomplete":
    "Izrakstītāja vai maksājuma dati nav pilnīgi",
  "No invoice": "Nav rēķina",
  "View invoice": "Skatīt rēķinu",
  "Generate invoice": "Izveidot rēķinu",
  "Add billing email": "Pievienot norēķinu e-pastu",
  "Send invoice": "Nosūtīt rēķinu",
  "Regenerate invoice": "Pārrēķināt rēķinu",
  "No dwellings are missing required billing data.":
    "Nevienam īpašumam netrūkst obligāto norēķinu datu.",
  "No billing cases match these filters.":
    "Filtriem neatbilst neviens norēķinu ieraksts.",
  "This period is locked. Readings and invoice generation cannot be changed.":
    "Periods ir slēgts. Rādījumus un rēķinu aprēķinus nevar mainīt.",
  "Select draft invoices to prepare, or prepared invoices to send.":
    "Izvēlieties melnrakstus sagatavošanai vai sagatavotos rēķinus nosūtīšanai.",
  "Select invoice": "Izvēlēties rēķinu",
  "Select all eligible invoices": "Izvēlēties visus atbilstošos rēķinus",
  "Generate all eligible": "Izveidot visus atbilstošos",
  "Prepare selected": "Sagatavot izvēlētos",
  "Send selected": "Nosūtīt izvēlētos",
  "Lock period": "Slēgt periodu",
  Generate: "Izveidot",
  Regenerate: "Pārrēķināt",
  Prepare: "Sagatavot",
  Send: "Nosūtīt",
  "Search dwelling": "Meklēt īpašumu",
  "All statuses": "Visi statusi",
  Apply: "Piemērot",
  Clear: "Notīrīt",
  "Missing readings": "Trūkstošie rādījumi",
  Invoice: "Rēķins",
  None: "Nav",
  "Enter readings": "Ievadīt rādījumus",
  "View readings": "Skatīt rādījumus",
  "Previous period": "Iepriekšējais periods",
  "Next period": "Nākamais periods",
  "No billing cases for this period.": "Šajā periodā nav norēķinu ierakstu.",
  Search: "Meklēt",
  Filter: "Filtrēt",
  "All types": "Visi veidi",
  "Show archived": "Rādīt arhivētos",
  Number: "Numurs",
  Type: "Veids",
  Occupant: "Iemītnieks",
  "Area (m²)": "Platība (m²)",
  Residents: "Iedzīvotāji",
  Apartment: "Dzīvoklis",
  "Commercial unit": "Komercplatība",
  Parking: "Autostāvvieta",
  Storage: "Noliktava",
  Other: "Cits",
  "Export CSV": "Eksportēt CSV",
  "Import CSV": "Importēt CSV",
  "Add dwelling": "Pievienot īpašumu",
  "Create dwelling": "Izveidot īpašumu",
  "View dwelling": "Skatīt īpašumu",
  "More actions": "Citas darbības",
  Archive: "Arhivēt",
  "Manage dwelling details, occupants and resident access.":
    "Pārvaldiet īpašumu datus, iemītniekus un piekļuvi.",
  "New dwellings are included in future periods. Archive historically billed dwellings to preserve their invoices.":
    "Jauni īpašumi tiks iekļauti nākamajos periodos. Arhivējiet iepriekš rēķinātos īpašumus, saglabājot to rēķinus.",
  "No dwellings match this filter.": "Filtram neatbilst neviens īpašums.",
  Previous: "Iepriekšējā",
  Next: "Nākamā",
  Page: "Lapa",
  "Import bank statement": "Importēt bankas izrakstu",
  "Bank imports": "Bankas importi",
  Imports: "Importi",
  "Review proposed matches and reconcile incoming payments.":
    "Pārskatiet ierosinātās atbilstības un saskaņojiet saņemtos maksājumus.",
  Reconciliation: "Maksājumu saskaņošana",
  "Import history": "Importu vēsture",
  Filename: "Faila nosaukums",
  Imported: "Importēts",
  Rows: "Rindas",
  Amount: "Summa",
  Reference: "Maksājuma mērķis",
  Payer: "Maksātājs",
  "Booking date": "Grāmatošanas datums",
  Confirm: "Apstiprināt",
  Reject: "Noraidīt",
  "No imports yet.": "Vēl nav importu.",
  "No transactions in this view.": "Šajā skatā nav darījumu.",
  Currency: "Valūta",
  Issuer: "Izrakstītājs",
  Recipient: "Saņēmējs",
  Payment: "Maksājums",
  Subtotal: "Starpsumma",
  VAT: "PVN",
  "Total due": "Kopā apmaksai",
  Total: "Kopā",
  Description: "Apraksts",
  Quantity: "Daudzums",
  "Unit price": "Vienības cena",
  Net: "Bez PVN",
  Gross: "Ar PVN",
  "Download PDF": "Lejupielādēt PDF",
  Print: "Drukāt",
  "Recipient information is incomplete. Add a billing name or occupant name and billing address.":
    "Saņēmēja dati ir nepilnīgi. Norādiet saņēmēja vai iemītnieka vārdu un norēķinu adresi.",
  "Issuer or payment information is incomplete. Add the organization name, address, bank name and IBAN.":
    "Izrakstītāja vai maksājuma dati ir nepilnīgi. Norādiet organizācijas nosaukumu, adresi, banku un IBAN.",
  "Fix dwelling details": "Labot īpašuma datus",
  "Fix organization details": "Labot organizācijas datus",
  "After correcting the details, regenerate this draft in the workbench to refresh its snapshot.":
    "Pēc datu labošanas pārrēķiniet melnrakstu darbvietā, lai atjauninātu rēķina datus.",
  "Delivery history": "Nosūtīšanas vēsture",
  "Current invoice": "Pašreizējais rēķins",
  "Your billing, readings and messages in one place.":
    "Jūsu rēķini, rādījumi un ziņojumi vienuviet.",
  "Meter readings": "Skaitītāju rādījumi",
  "Reading received": "Rādījums saņemts",
  Reading: "Rādījums",
  "Current value": "Pašreizējais rādījums",
  "Submit reading": "Iesniegt rādījumu",
  "The reading deadline has passed. Contact your administrator.":
    "Rādījumu iesniegšanas termiņš ir pagājis. Sazinieties ar administratoru.",
  "No current invoice yet.": "Pašreizējais rēķins vēl nav izveidots.",
  "Consumption history": "Patēriņa vēsture",
  "Contact administrator": "Sazināties ar administratoru",
  "Recent invoices": "Jaunākie rēķini",
  "View all": "Skatīt visus",
  "No invoices yet.": "Vēl nav rēķinu.",
  "Your dwellings": "Jūsu īpašumi",
  "Choose a dwelling to view its invoices and readings.":
    "Izvēlieties īpašumu, lai skatītu tā rēķinus un rādījumus.",
  Electricity: "Elektrība",
  Gas: "Gāze",
  Heat: "Siltums",
  Administrator: "Administrators",
  Resident: "Iedzīvotājs",
  Import: "Imports",
  Reply: "Atbildēt",
  Message: "Ziņojums",
  Subject: "Temats",
  "New message": "Jauns ziņojums",
  "Send reply": "Nosūtīt atbildi",
  "Resident conversations and billing questions.":
    "Iedzīvotāju sarunas un jautājumi par norēķiniem.",
  "Configure your organization, billing and access.":
    "Pārvaldiet organizāciju, norēķinus un piekļuvi.",
  Organization: "Organizācija",
  Billing: "Norēķini",
  "Tariffs & rules": "Tarifi un noteikumi",
  "Invoice template": "Rēķina veidne",
  "Users & access": "Lietotāji un piekļuve",
  Data: "Dati",
  "Legal, bank, and contact details.":
    "Juridiskie, bankas un kontaktinformācijas dati.",
  "Admin membership and resident access.":
    "Administratoru un iedzīvotāju piekļuve.",
  "Automation and due-date defaults.": "Automatizācija un noklusējuma termiņi.",
  "Billing calculation rules.": "Rēķinu aprēķina noteikumi.",
  "Invoice appearance.": "Rēķina izskats.",
  "Import and export.": "Imports un eksports.",
  "Audit history": "Audita vēsture",
  "Review recorded organization activity.":
    "Pārskatiet reģistrētās organizācijas darbības.",
  Save: "Saglabāt",
  "Billing name": "Rēķina saņēmējs",
  Email: "E-pasts",
  "Working…": "Apstrādā…",
  "Saved successfully.": "Veiksmīgi saglabāts.",
  "Use a decimal point and up to three decimal places.":
    "Izmantojiet punktu un ne vairāk kā trīs zīmes aiz komata.",
  "Toggle theme": "Pārslēgt motīvu",
  "Switch to light theme": "Pārslēgt uz gaišo motīvu",
  "Switch to dark theme": "Pārslēgt uz tumšo motīvu",
  "Light theme": "Gaišais motīvs",
  "Dark theme": "Tumšais motīvs",
  "Add resident": "Pievienot iedzīvotāju",
  "Additional information": "Papildu informācija",
  "Adjustments will appear here.": "Korekcijas parādīsies šeit.",
  "All adjustments and balance history.":
    "Visas korekcijas un atlikuma vēsture.",
  "Apartment number": "Dzīvokļa numurs",
  "Archive dwelling": "Arhivēt īpašumu",
  "Archive this dwelling?": "Arhivēt šo īpašumu?",
  "Archiving hides it from new periods and active lists. Past invoices and readings remain intact.":
    "Arhivēšana to paslēpj no jauniem periodiem un aktīvajiem sarakstiem. Iepriekšējie rēķini un rādījumi paliek neskarti.",
  Area: "Platība",
  "Basic information": "Pamatinformācija",
  "Billing details": "Norēķinu dati",
  Building: "Ēka",
  "Calculated consumption": "Aprēķinātais patēriņš",
  "Changes recorded against this dwelling.":
    "Šim īpašumam reģistrētās izmaiņas.",
  "Changes saved": "Izmaiņas saglabātas",
  Close: "Aizvērt",
  "Complete the details below to resolve invoice preparation blockers.":
    "Aizpildiet zemāk esošos datus, lai novērstu rēķina sagatavošanas šķēršļus.",
  "Consumption is calculated automatically.":
    "Patēriņš tiek aprēķināts automātiski.",
  "Conversations with residents will appear here.":
    "Sarunas ar iedzīvotājiem parādīsies šeit.",
  "Core information about this dwelling.":
    "Galvenā informācija par šo īpašumu.",
  "Create adjustment": "Izveidot korekciju",
  Created: "Izveidots",
  "Current reading": "Pašreizējais rādījums",
  DWELLING: "ĪPAŠUMS",
  Date: "Datums",
  "Discard unsaved changes? Your edits have not been saved.":
    "Atmest nesaglabātās izmaiņas? Jūsu labojumi nav saglabāti.",
  "Enter current meter readings for this period.":
    "Ievadiet šī perioda pašreizējos skaitītāju rādījumus.",
  "How this dwelling receives its invoices.": "Kā šis īpašums saņem rēķinus.",
  "Internal notes and metadata.": "Iekšējās piezīmes un metadati.",
  "Invoice delivery": "Rēķinu piegāde",
  "Last updated": "Pēdējoreiz atjaunināts",
  "Latest messages with this dwelling.": "Jaunākās ziņas ar šo īpašumu.",
  "Loading…": "Ielādē…",
  Method: "Metode",
  "No account entries yet": "Vēl nav konta ierakstu",
  "No audit events for this dwelling yet.":
    "Šim īpašumam vēl nav audita notikumu.",
  "No billing email on file": "Nav norādīts norēķinu e-pasts",
  "No messages yet": "Vēl nav ziņu",
  "No open period": "Nav atvērta perioda",
  Note: "Piezīme",
  Notes: "Piezīmes",
  "Open full dwelling": "Atvērt pilnu īpašumu",
  "Outstanding balance": "Parāda atlikums",
  Paper: "Papīrs",
  "Paper delivery": "Papīra piegāde",
  "People who can access their invoices and messages.":
    "Cilvēki, kuri var piekļūt saviem rēķiniem un ziņām.",
  "Previous reading": "Iepriekšējais rādījums",
  "Reading saved": "Rādījums saglabāts",
  Reason: "Iemesls",
  "Recent messages": "Jaunākās ziņas",
  "Save changes": "Saglabāt izmaiņas",
  "Save readings": "Saglabāt rādījumus",
  "Saving…": "Saglabā…",
  Sections: "Sadaļas",
  "Send a printed copy by mail": "Nosūtīt drukātu kopiju pa pastu",
  "Send invoices to": "Nosūtīt rēķinus uz",
  "Something went wrong. Please try again.":
    "Kaut kas nogāja greizi. Lūdzu, mēģiniet vēlreiz.",
  "This dwelling's billing case in every period it has existed for.":
    "Šī īpašuma norēķinu ieraksts katrā periodā, kurā tas pastāvējis.",
  "Total credits": "Kopējais kredīts",
  "Total debits": "Kopējais debets",
  "View current period": "Skatīt pašreizējo periodu",
  "Water and other utility meters in this dwelling.":
    "Ūdens un citi komunālo pakalpojumu skaitītāji šajā īpašumā.",
  archived: "arhivēts",
  "e.g. 123 Main Street, Apt 4B\nRiga, LV-1010":
    "piem., Brīvības iela 123, dz. 4B\nRīga, LV-1010",
  "e.g. John Smith or Company Ltd": "piem., Jānis Bērziņš vai SIA Uzņēmums",

  // Added: translation coverage pass (settings/rules/billing/messages/guide/dashboard)
  "-- none --": "-- nav --",
  "A descriptive name for this rule.": "Šī noteikuma aprakstošais nosaukums.",
  "English invoice label": "Angļu valodas nosaukums rēķinā",
  "Russian invoice label": "Krievu valodas nosaukums rēķinā",
  "Optional -- falls back to the Latvian name":
    "Neobligāti -- ja nav norādīts, tiek izmantots latviešu nosaukums",
  "Add a new tariff or billing rule. Fill in the details below.":
    "Pievienojiet jaunu tarifu vai norēķinu noteikumu. Aizpildiet informāciju zemāk.",
  "Add a note about this dwelling…": "Pievienojiet piezīmi par šo īpašumu…",
  Admin: "Administrators",
  "Admin dashboard with billing totals and work that needs attention.":
    "Administratora panelis ar norēķinu kopsummām un darbiem, kam nepieciešama uzmanība.",
  "Apply late fees to overdue invoices.":
    "Piemērot nokavējuma maksu kavētiem rēķiniem.",
  "Auto-send day of month": "Automātiskās nosūtīšanas diena mēnesī",
  "Automatic generation and sending run only for eligible billing periods.":
    "Automātiskā ģenerēšana un nosūtīšana notiek tikai atbilstošiem norēķinu periodiem.",
  "Automation scope": "Automatizācijas apjoms",
  "Avoid overlapping rules of the same type. When a new rate applies, create a new rule with a later effective date.":
    "Izvairieties no pārklājošiem viena veida noteikumiem. Kad stājas spēkā jauna likme, izveidojiet jaunu noteikumu ar vēlāku sākuma datumu.",
  "Billing information": "Norēķinu informācija",
  "Billing summary": "Norēķinu kopsavilkums",
  Breadcrumb: "Navigācijas ceļš",
  "Changes to late-payment rules affect future calculations only. Existing invoices keep their original financial snapshot.":
    "Izmaiņas nokavēto maksājumu noteikumos ietekmē tikai turpmākos aprēķinus. Esošie rēķini saglabā sākotnējos finanšu datus.",
  Code: "Kods",
  "Configure invoice defaults, automation, and late-payment rules.":
    "Iestatiet rēķinu noklusējuma vērtības, automatizāciju un nokavēto maksājumu noteikumus.",
  "Control automatic invoice generation and sending.":
    "Pārvaldiet automātisko rēķinu ģenerēšanu un nosūtīšanu.",
  "Core invoicing preferences for this organization.":
    "Šīs organizācijas galvenie norēķinu iestatījumi.",
  "Creates draft invoices for all eligible accounts at the start of each period.":
    "Katra perioda sākumā izveido melnrakstu rēķinus visiem atbilstošajiem kontiem.",
  "Current defaults for this organization.":
    "Šīs organizācijas pašreizējās noklusējuma vērtības.",
  "Daily late fee rate as a percentage.":
    "Dienas nokavējuma maksas likme procentos.",
  "Daily rate (%)": "Dienas likme (%)",
  "Date when this rule becomes active.":
    "Datums, kad šis noteikums stājas spēkā.",
  "Do not accrue additional fees once the maximum penalty is reached.":
    "Nepiemērot papildu maksu, kad sasniegts maksimālais soda apmērs.",
  "Due days": "Apmaksas termiņš (dienās)",
  "Each month, open the current period. Resolve missing inputs, prepare invoices, send them, and reconcile payments.":
    "Katru mēnesi atveriet pašreizējo periodu. Aizpildiet trūkstošos datus, sagatavojiet rēķinus, nosūtiet tos un saskaņojiet maksājumus.",
  "Each rule has an effective period and can be archived when no longer in use.":
    "Katram noteikumam ir spēkā esamības periods, un to var arhivēt, ja tas vairs netiek izmantots.",
  "Effective period": "Spēkā esamības periods",
  "Effective periods": "Spēkā esamības periodi",
  "Fill in the form to see a preview":
    "Aizpildiet formu, lai redzētu priekšskatījumu",
  "Filter by status": "Filtrēt pēc statusa",
  "Fixed rules": "Fiksētie noteikumi",
  "Follow these steps in order for your first billing run. After setup, repeat the monthly cycle every month.":
    "Izpildiet šos soļus secībā pirmajam norēķinu ciklam. Pēc iestatīšanas atkārtojiet ikmēneša ciklu katru mēnesi.",
  "Good to know": "Noderīgi zināt",
  "Grace period (days)": "Pagarinājuma periods (dienās)",
  "Help & guidance": "Palīdzība un norādes",
  History: "Vēsture",
  "How tariffs are applied": "Kā tiek piemēroti tarifi",
  "How the charge is calculated.": "Kā tiek aprēķināta maksa.",
  "Important details about billing settings.":
    "Svarīga informācija par norēķinu iestatījumiem.",
  "Internal note (optional)": "Iekšēja piezīme (nav obligāti)",
  "Invoice numbering": "Rēķinu numerācija",
  "Invoice prefix": "Rēķina prefikss",
  "Keep your details current so that invoices, payments, and official communication are processed without delays.":
    "Uzturiet savus datus aktuālus, lai rēķini, maksājumi un oficiālā saziņa notiktu bez kavēšanās.",
  "Keep your organization details up to date to ensure correct invoicing and communication.":
    "Uzturiet organizācijas datus aktuālus, lai nodrošinātu pareizu rēķinu izrakstīšanu un saziņu.",
  "Late-payment changes": "Nokavēto maksājumu izmaiņas",
  "Leave empty for ongoing.": "Atstājiet tukšu, ja periods turpinās.",
  "Manage legal, contact, and bank details for this organization.":
    "Pārvaldiet šīs organizācijas juridiskos, kontaktinformācijas un bankas datus.",
  "Manage utility rates, billing formulas, and effective periods.":
    "Pārvaldiet komunālo pakalpojumu likmes, aprēķina formulas un spēkā esamības periodus.",
  "Mark resolved": "Atzīmēt kā atrisinātu",
  "Maximum penalty as a percentage of eligible principal.":
    "Maksimālais soda apmērs procentos no piemērojamās pamatsummas.",
  "Maximum total penalty (%)": "Maksimālā kopējā soda maksa (%)",
  "Meter type": "Skaitītāja veids",
  "Meter-based rules": "Uz skaitītāju balstīti noteikumi",
  "Need help?": "Nepieciešama palīdzība?",
  "No billing rules match this filter.":
    "Nevienam norēķinu noteikumam neatbilst šis filtrs.",
  "No resident": "Nav iedzīvotāja",
  "Number of days after the due date before late fees apply.":
    "Dienu skaits pēc apmaksas termiņa, pirms tiek piemērota nokavējuma maksa.",
  "Number of days after the invoice date.":
    "Dienu skaits pēc rēķina izrakstīšanas datuma.",
  "Number, occupant, address...": "Numurs, iedzīvotājs, adrese...",
  "Only for meter consumption rules.": "Tikai skaitītāja patēriņa noteikumiem.",
  "Open dwelling": "Atvērt īpašumu",
  "Organization summary": "Organizācijas kopsavilkums",
  "Prefix for newly generated invoice numbers.":
    "Prefikss jaunizveidoto rēķinu numuriem.",
  "Price per unit (excl. VAT).": "Cena par vienību (bez PVN).",
  "Resident information": "Iedzīvotāja informācija",
  "Review resident questions, send updates, and keep billing conversations in context.":
    "Skatiet iedzīvotāju jautājumus, sūtiet paziņojumus un uzturiet norēķinu sarunas pārskatāmas.",
  "Rule summary": "Noteikuma kopsavilkums",
  "Rules applied to future late-fee calculations. Existing invoices keep their original financial snapshot.":
    "Noteikumi tiek piemēroti turpmākajiem nokavējuma maksas aprēķiniem. Esošie rēķini saglabā sākotnējos finanšu datus.",
  "Search messages by subject or content...":
    "Meklēt ziņas pēc tēmas vai satura...",
  "Search rules by name or code...":
    "Meklēt noteikumus pēc nosaukuma vai koda...",
  "Select a conversation to view it here.":
    "Izvēlieties sarunu, lai to skatītu šeit.",
  "Send message": "Sūtīt ziņu",
  "Sends invoices to recipients automatically.":
    "Automātiski nosūta rēķinus saņēmējiem.",
  "Show unread only": "Rādīt tikai nelasītās",
  "Showing conversations for one dwelling only.":
    "Tiek rādītas sarunas tikai par vienu īpašumu.",
  "Tariffs define how charges are calculated for each billing period.":
    "Tarifi nosaka, kā tiek aprēķināta maksa katram norēķinu periodam.",
  "The invoice number prefix is applied to newly generated invoices.":
    "Rēķina numura prefikss tiek piemērots jaunizveidotajiem rēķiniem.",
  "The summary will show how this rule will appear in the list and how it will be applied to bills.":
    "Kopsavilkumā redzēsiet, kā šis noteikums izskatīsies sarakstā un kā tas tiks piemērots rēķiniem.",
  "This information is used for receiving payments.":
    "Šī informācija tiek izmantota maksājumu saņemšanai.",
  "This information is used on invoices and for official communication.":
    "Šī informācija tiek izmantota rēķinos un oficiālajā saziņā.",
  "This is how your organization details appear on invoices.":
    "Tā jūsu organizācijas dati tiks attēloti rēķinos.",
  "Type your reply...": "Ierakstiet savu atbildi...",
  "Unique identifier (e.g. cold_water).":
    "Unikāls identifikators (piem., cold_water).",
  "Unit of measurement.": "Mērvienība.",
  "Use fixed rules for regular charges like maintenance fees. The amount is the same each period (per unit).":
    "Izmantojiet fiksētos noteikumus regulārām maksām, piemēram, apsaimniekošanas maksai. Summa katru periodu ir vienāda (par vienību).",
  "Use meter consumption for utilities like water, heat, or electricity. Charges are calculated from the difference in meter readings.":
    "Izmantojiet skaitītāja patēriņu tādiem pakalpojumiem kā ūdens, siltums vai elektrība. Maksa tiek aprēķināta no skaitītāja rādījumu starpības.",
  "Use the status to see what you can do next.":
    "Izmantojiet statusu, lai redzētu, ko darīt tālāk.",
  "Used only when automatic sending is enabled.":
    "Tiek izmantots tikai tad, kad ir ieslēgta automātiskā nosūtīšana.",
  "Value added tax percentage.":
    "Pievienotās vērtības nodokļa procentuālā likme.",
  "e.g. Cold Water": "piem., Aukstais ūdens",
  "e.g. cold_water": "piem., cold_water",
  "e.g. m3, month, person": "piem., m3, mēnesis, persona",
  ongoing: "līdz šim",

  // Added: translation coverage pass 2 (guide setup/monthly steps, faqs, statuses; dashboard ternaries)
  "Add the legal name, address, contact details, bank name, and IBAN used on invoices.":
    "Pievienojiet juridisko nosaukumu, adresi, kontaktinformāciju, bankas nosaukumu un IBAN, ko izmanto rēķinos.",
  "Ready when the invoice issuer and payment details are complete.":
    "Gatavs, kad rēķina izdevēja un maksājuma dati ir pilnīgi.",
  "Create dwellings one at a time, or import them from a CSV file. Check each number, type, occupant, area, and resident count.":
    "Izveidojiet mājokļus pa vienam vai importējiet tos no CSV faila. Pārbaudiet katru numuru, tipu, īpašnieku, platību un iedzīvotāju skaitu.",
  "Ready when every billable unit appears in the dwelling list.":
    "Gatavs, kad visas rēķināmās vienības ir redzamas mājokļu sarakstā.",
  "Dwelling list with filters and dwelling details.":
    "Mājokļu saraksts ar filtriem un mājokļu datiem.",
  "Open each dwelling. Assign resident access. Add billing contact details. Register its meters.":
    "Atveriet katru mājokli. Piešķiriet iedzīvotāja piekļuvi. Pievienojiet rēķinu kontaktinformāciju. Reģistrējiet tā skaitītājus.",
  "Ready when residents can access their dwelling and all meters are listed.":
    "Gatavs, kad iedzīvotāji var piekļūt savam mājoklim un visi skaitītāji ir uzskaitīti.",
  "Dwelling detail page with resident access and meter registration.":
    "Mājokļa detalizētā lapa ar iedzīvotāja piekļuvi un skaitītāju reģistrāciju.",
  "Set tariffs and rules": "Iestatiet tarifus un noteikumus",
  "Add the billing rules that set fixed, area, resident-count, or meter-consumption charges.":
    "Pievienojiet rēķinu noteikumus, kas nosaka fiksētas, platības, iedzīvotāju skaita vai skaitītāju patēriņa maksas.",
  "Tariffs and rules list with rule details.":
    "Tarifu un noteikumu saraksts ar noteikumu datiem.",
  "Set the billing window, reading deadline, invoice issue date, and due date. A new period creates a case for each active dwelling.":
    "Iestatiet rēķinu periodu, rādījumu iesniegšanas termiņu, rēķina izdošanas datumu un apmaksas termiņu. Jauns periods izveido lietu katram aktīvajam mājoklim.",
  "Ready when the new OPEN period appears in the period list.":
    "Gatavs, kad jaunais ATVĒRTAIS periods parādās periodu sarakstā.",
  "Billing period list and period actions.":
    "Rēķinu periodu saraksts un periodu darbības.",
  "Use the dashboard attention list or the monthly workbench to find missing readings. Residents can also submit readings when allowed.":
    "Izmantojiet informācijas paneļa uzmanības sarakstu vai ikmēneša darbvirsmu, lai atrastu trūkstošos rādījumus. Iedzīvotāji var arī iesniegt rādījumus, ja tas ir atļauts.",
  "Generate eligible invoices in the workbench. Review the calculation lines, recipient details, dates, and totals.":
    "Ģenerējiet atbilstošos rēķinus darbvietā. Pārskatiet aprēķina rindas, saņēmēja datus, datumus un kopsummas.",
  "Ready when correct invoices are in DRAFT and you have fixed all validation blockers.":
    "Gatavs, kad pareizie rēķini ir statusā MELNRAKSTS un visi validācijas šķēršļi ir novērsti.",
  "Monthly workbench with the billing workflow and case list.":
    "Ikmēneša darbvirsma ar rēķinu darbplūsmu un lietu sarakstu.",
  "Prepare approved drafts. Send the prepared invoices. Delivery moves each case to SENT and locks the invoice.":
    "Sagatavojiet apstiprinātos melnrakstus. Nosūtiet sagatavotos rēķinus. Piegāde pārvieto katru lietu uz statusu NOSŪTĪTS un bloķē rēķinu.",
  "Ready when sent invoices show SENT, or show a clear delivery error to fix.":
    "Gatavs, kad nosūtītie rēķini rāda statusu NOSŪTĪTS vai skaidru piegādes kļūdu, kas jālabo.",
  "Import a bank statement. Check the preview. Confirm the import. Review proposed or unmatched transactions.":
    "Importējiet bankas izrakstu. Pārbaudiet priekšskatījumu. Apstipriniet importu. Pārskatiet piedāvātos vai nesaskaņotos darījumus.",
  "Ready when you have confirmed valid matches and the matching invoices show PAID.":
    "Gatavs, kad esat apstiprinājis derīgas atbilstības un attiecīgie rēķini rāda statusu APMAKSĀTS.",
  "Review resident messages, overdue invoices, unmatched payments, and delivery failures. Resolve each conversation once its issue is fixed.":
    "Pārskatiet iedzīvotāju ziņas, kavētus rēķinus, nesaskaņotus maksājumus un piegādes kļūdas. Atrisiniet katru saraksti, kad tās problēma ir novērsta.",
  "Ready when every attention item has an owner or is resolved.":
    "Gatavs, kad katram uzmanības vienumam ir atbildīgā persona vai tas ir atrisināts.",
  "Messages inbox with a resident conversation open.":
    "Ziņu iesūtne ar atvērtu sarunu ar iedzīvotāju.",
  "MISSING DATA means a required input is missing. READY means all required readings are in. DRAFT means you can still review and regenerate it. PREPARED is approved and ready to send. SENT means delivery succeeded. OVERDUE means the due date passed unpaid. PAID means the invoice is fully paid.":
    "MISSING DATA nozīmē, ka trūkst nepieciešamās informācijas. READY nozīmē, ka visi nepieciešamie rādījumi ir ievadīti. DRAFT nozīmē, ka joprojām varat to pārskatīt un no jauna ģenerēt. PREPARED nozīmē, ka rēķins ir apstiprināts un gatavs nosūtīšanai. SENT nozīmē, ka piegāde bija sekmīga. OVERDUE nozīmē, ka apmaksas termiņš ir pagājis un rēķins nav apmaksāts. PAID nozīmē, ka rēķins ir pilnībā apmaksāts.",
  "Why can I not generate an invoice?": "Kāpēc nevaru ģenerēt rēķinu?",
  "The system blocks generation when required readings are missing or the period is locked. Open the affected dwelling in the workbench to see what is missing.":
    "Sistēma bloķē ģenerēšanu, ja trūkst nepieciešamo rādījumu vai periods ir bloķēts. Atveriet attiecīgo mājokli darbvietā, lai redzētu, kas trūkst.",
  "Why can I not prepare an invoice?": "Kāpēc nevaru sagatavot rēķinu?",
  "The invoice must be a DRAFT with complete issuer, recipient, and payment details. Fix the related settings. Regenerate the draft to update its snapshot.":
    "Rēķinam jābūt statusā MELNRAKSTS ar pilnīgiem izdevēja, saņēmēja un maksājuma datiem. Labojiet attiecīgos iestatījumus. Ģenerējiet melnrakstu no jauna, lai atjauninātu tā momentuzņēmumu.",
  "Why can I not send an invoice?": "Kāpēc nevaru nosūtīt rēķinu?",
  "You can send only PREPARED invoices that have a billing email. If delivery fails, fix the cause, then retry or resend.":
    "Varat nosūtīt tikai rēķinus statusā PREPARED, kuriem ir rēķinu e-pasts. Ja piegāde neizdodas, novērsiet cēloni un pēc tam mēģiniet vēlreiz vai nosūtiet atkārtoti.",
  "No. A sent invoice is a permanent financial record and cannot change. Changes to dwellings, tariffs, or settings apply only to future invoices.":
    "Nē. Nosūtīts rēķins ir pastāvīgs finanšu dokuments, un to nevar mainīt. Izmaiņas mājokļos, tarifos vai iestatījumos attiecas tikai uz turpmākajiem rēķiniem.",
  "Review its amount, currency, payer, and reference. Leave it unmatched until you find the correct invoice. Do not confirm a match you are not sure about.":
    "Pārskatiet tā summu, valūtu, maksātāju un atsauci. Atstājiet to nesaskaņotu, līdz atrodat pareizo rēķinu. Neapstipriniet atbilstību, par kuru neesat pārliecināts.",
  "Lock a period after its normal reading and invoice work is complete. A locked period stays available for history, but blocks reading edits and invoice regeneration.":
    "Bloķējiet periodu pēc tam, kad parastais rādījumu un rēķinu darbs ir pabeigts. Bloķēts periods paliek pieejams vēsturei, bet neļauj labot rādījumus un no jauna ģenerēt rēķinus.",
  "Required input is missing. Generation is blocked.":
    "Trūkst nepieciešamās informācijas. Ģenerēšana ir bloķēta.",
  "All required readings are in. You can now generate the invoice.":
    "Visi nepieciešamie rādījumi ir ievadīti. Tagad varat ģenerēt rēķinu.",
  "You can still review and regenerate the invoice.":
    "Joprojām varat pārskatīt un no jauna ģenerēt rēķinu.",
  "Delivery succeeded.": "Piegāde bija sekmīga.",
  "The invoice is fully paid.": "Rēķins ir pilnībā apmaksāts.",
  "The due date passed and the invoice is still unpaid.":
    "Apmaksas termiņš ir pagājis, un rēķins joprojām nav apmaksāts.",
  "Awaiting reply": "Gaida atbildi",

  // Added: translation coverage pass 3 (settings hub card grid)
  "Core settings": "Pamatiestatījumi",
  "Administration tools": "Administrēšanas rīki",
  "Automation, due dates, numbering, and defaults.":
    "Automatizācija, apmaksas termiņi, numerācija un noklusējuma vērtības.",
  "Utility rates and billing calculation rules.":
    "Komunālo pakalpojumu tarifi un rēķinu aprēķina noteikumi.",
  "Invoice appearance and document settings.":
    "Rēķina izskats un dokumenta iestatījumi.",
  "Import, export, and bulk updates.":
    "Importēšana, eksportēšana un masveida atjaunināšana.",
  "Track important changes in your organization.":
    "Sekojiet līdzi svarīgām izmaiņām jūsu organizācijā.",

  // Added: translation coverage pass 4 (manual billing rule input drawer)
  Value: "Vērtība",
  "Enter the quantity for this period.": "Ievadiet daudzumu šim periodam.",
  "Enter the amount to charge for this period.":
    "Ievadiet summu, kas jāiekasē par šo periodu.",

  // Added: translation coverage pass 5 (invoice template editor)
  "Template structure": "Veidnes struktūra",
  "Add, remove and configure sections. Drag to reorder.":
    "Pievienojiet, noņemiet un konfigurējiet sadaļas. Velciet, lai mainītu secību.",
  "Live preview": "Priekšskatījums reāllaikā",
  "This preview reflects your current template configuration.":
    "Šis priekšskatījums atspoguļo jūsu pašreizējo veidnes konfigurāciju.",
  "Section title": "Sadaļas nosaukums",
  "Line items": "Rindas",
  "Zoom level": "Tuvinājuma līmenis",
  "Expand section": "Izvērst sadaļu",
  "Collapse section": "Sakļaut sadaļu",
  "More options": "Citas iespējas",
  "Preview period": "Priekšskatījuma periods",
  "No billing periods yet — showing tariffs effective today.":
    "Vēl nav norēķinu periodu — tiek rādīti šodien spēkā esošie tarifi.",
  "Charge quantities shown here are illustrative (always 1) and do not reflect any real resident's bill.":
    "Šeit redzamie daudzumi ir ilustratīvi (vienmēr 1) un neatspoguļo neviena konkrēta iemītnieka rēķinu.",
  "Latvian is the canonical invoice language. English and Russian are optional translations; a missing translation falls back to Latvian.":
    "Latviešu valoda ir rēķina kanoniskā valoda. Angļu un krievu valoda ir neobligāti tulkojumi; ja tulkojuma nav, tiek izmantots latviešu teksts.",
  "Editing language": "Rediģēšanas valoda",
  "Latvian is the canonical invoice document. English and Russian are optional translated copies of the same invoice — not separate invoices.":
    "Latviešu valoda ir rēķina kanoniskais dokuments. Angļu un krievu valoda ir šī paša rēķina neobligātas tulkotas kopijas — ne atsevišķi rēķini.",
  "Document language": "Dokumenta valoda",
  "Control what appears on generated invoices, in what order, and how each section looks.":
    "Kontrolējiet, kas parādās uz izveidotajiem rēķiniem, kādā secībā un kā katra sadaļa izskatās.",
  "Add text block": "Pievienot teksta bloku",
  "Reset layout": "Atiestatīt izkārtojumu",
  "Invoice sections": "Rēķina sadaļas",
  "Invoice preview": "Rēķina priekšskatījums",
  "Sample resident": "Parauga iedzīvotājs",
  "Sample Street 1, Riga, LV-1010": "Parauga iela 1, Rīga, LV-1010",
  "Maintenance fee": "Apsaimniekošanas maksa",
  "Invoice details": "Rēķina informācija",
  "Sender and recipient": "Izdevējs un saņēmējs",
  "Charges table": "Maksājumu tabula",
  "Payment details": "Maksājuma dati",
  "Default note": "Noklusējuma piezīme",
  Footer: "Kājene",
  "Custom text": "Pielāgots teksts",
  Show: "Rādīt",
  Bold: "Treknraksts",
  Spacing: "Atstarpe",
  Align: "Līdzinājums",
  "Move up": "Pārvietot uz augšu",
  "Move down": "Pārvietot uz leju",
  Duplicate: "Dublēt",
  Delete: "Dzēst",
  "Reset the invoice layout to the default template? Custom text blocks, section titles, and any per-row formatting will be removed. Your header, footer, payment instructions, and note text are kept.":
    "Atiestatīt rēķina izkārtojumu uz noklusējuma veidni? Pielāgotie teksta bloki, sadaļu nosaukumi un jebkurš rindu formatējums tiks noņemts. Jūsu galvenes, kājenes, maksājuma instrukciju un piezīmes teksts tiks saglabāts.",
  "This invoice layout has reached the maximum of 30 sections.":
    "Šis rēķina izkārtojums ir sasniedzis maksimālo 30 sadaļu skaitu.",
  "Enter a valid unit price, for example 0.35 or 12.50. Use up to 4 decimal places.":
    "Ievadiet derīgu vienības cenu, piemēram, 0,35 vai 12,50. Izmantojiet ne vairāk kā 4 zīmes aiz komata.",
  "Enter a valid VAT percentage, for example 21 or 21.5.":
    "Ievadiet derīgu PVN procentu, piemēram, 21 vai 21,5.",
  "Enter a valid amount, for example 12.50 or -5.00. Use up to 2 decimal places.":
    "Ievadiet derīgu summu, piemēram, 12,50 vai -5,00. Izmantojiet ne vairāk kā 2 zīmes aiz komata.",
  "Enter a valid amount, for example 12.50. Use up to 2 decimal places.":
    "Ievadiet derīgu summu, piemēram, 12,50. Izmantojiet ne vairāk kā 2 zīmes aiz komata.",
  "Enter a valid daily rate, for example 0.05.":
    "Ievadiet derīgu dienas likmi, piemēram, 0,05.",
  "Enter a valid percentage, for example 10 or 10.5.":
    "Ievadiet derīgu procentu, piemēram, 10 vai 10,5.",
  "Enter a valid meter reading, for example 123.456. Use up to 3 decimal places.":
    "Ievadiet derīgu skaitītāja rādījumu, piemēram, 123,456. Izmantojiet ne vairāk kā 3 zīmes aiz komata.",
  "Enter a valid value, for example 12.3456. Use up to 4 decimal places.":
    "Ievadiet derīgu vērtību, piemēram, 12,3456. Izmantojiet ne vairāk kā 4 zīmes aiz komata.",
};

const ru: Record<string, string> = {
  "Current charges": "Текущие начисления",
  "Previous outstanding": "Предыдущий долг",
  "Previous balance": "Предыдущий остаток",
  "Credit applied": "Зачтённый кредит",
  "Account credit": "Кредит на счёте",
  "Amount due": "К оплате",
  "Late fee": "Плата за просрочку",
  "Manual adjustment": "Ручная корректировка",
  "Current bill": "Текущий счёт",
  "Account balance": "Остаток на счёте",
  "Account activity": "Операции по счёту",
  "Add adjustment": "Добавить корректировку",
  "Adjustments create an auditable account entry and never edit the balance directly.":
    "Каждая корректировка фиксируется в истории счёта и никогда не меняет остаток напрямую.",
  "Charge adjustment": "Корректировка начислений",
  "Credit adjustment": "Корректировка кредита",
  Debit: "Дебет",
  Credit: "Кредит",
  Balance: "Остаток",
  "Preparation checks": "Проверки перед подготовкой",
  "Recipient details complete": "Данные получателя заполнены",
  "Issuer and payment details complete":
    "Данные выставителя и реквизиты для оплаты заполнены",
  "Current charges calculated": "Текущие начисления рассчитаны",
  "Account balance resolved": "Остаток на счёте определён",
  "Late-payment rules": "Правила при просрочке оплаты",
  "Changes apply to future calculations. Sent invoices keep their original financial snapshot.":
    "Изменения коснутся только будущих расчётов. Отправленные счета сохраняют исходные финансовые данные.",
  "Late fees enabled": "Плата за просрочку включена",
  "Daily rate": "Дневная ставка",
  "Grace period": "Льготный период",
  "days after the due date": "дней после срока оплаты",
  "Maximum total penalty": "Максимальная сумма штрафа",
  "of eligible principal": "от суммы основного долга",
  "Stop accrual at cap": "Остановить начисление при достижении лимита",
  "Save late-payment rules": "Сохранить правила при просрочке оплаты",
  "Remaining after allocation": "Остаток после распределения",
  "Credit created": "Создан кредит",
  "carried balance": "перенесённый остаток",
  "credit applied": "зачтённый кредит",
  "Admin guide": "Руководство администратора",
  "Set up your organization and complete your first billing cycle.":
    "Настройте организацию и проведите первый расчётный цикл.",
  "Start here": "Начните здесь",
  "Initial setup": "Первоначальная настройка",
  "Monthly billing cycle": "Ежемесячный расчётный цикл",
  "Frequently asked questions": "Часто задаваемые вопросы",
  "On this page": "На этой странице",
  "Quick reference": "Краткая справка",
  Help: "Помощь",
  "Invoice status guide": "Справочник статусов счетов",
  "Use the status to understand what can happen next.":
    "По статусу можно понять, что делать дальше.",
  "Work from the current period: resolve missing inputs, prepare invoices, send them and reconcile payments.":
    "Работайте в текущем периоде: внесите недостающие данные, подготовьте и отправьте счета, а затем сверьте платежи.",
  "Organization settings with issuer and payment details.":
    "Настройки организации с данными выставителя и реквизитами для оплаты.",
  "Dwelling directory with filters and dwelling details.":
    "Список помещений с фильтрами и подробными данными.",
  "Billing period history and period actions.":
    "История расчётных периодов и действия с ними.",
  "Admin dashboard with billing totals and work requiring attention.":
    "Панель администратора с итогами расчётов и задачами, требующими внимания.",
  "Payment reconciliation workspace with transaction states.":
    "Рабочая область сверки платежей со статусами операций.",
  "Required input is missing; generation is blocked.":
    "Не хватает обязательных данных; создание счёта заблокировано.",
  "The invoice can still be reviewed and regenerated.":
    "Счёт ещё можно проверить и пересчитать.",
  "The invoice is approved and ready to send.":
    "Счёт утверждён и готов к отправке.",
  "The invoice was delivered successfully.": "Счёт успешно доставлен.",
  "A full payment has been confirmed.": "Полная оплата подтверждена.",
  "The due date passed without a confirmed full payment.":
    "Срок оплаты прошёл, полная оплата не подтверждена.",
  "Follow these steps in order for your first billing run. After setup, repeat the monthly cycle from period creation onward.":
    "Для первого расчёта выполните эти шаги по порядку. После настройки повторяйте ежемесячный цикл, начиная с создания периода.",
  "First-time setup": "Первичная настройка",
  "Repeat every month": "Повторять каждый месяц",
  Step: "Шаг",
  "Open settings": "Открыть настройки",
  "Open dwellings": "Открыть помещения",
  "Open billing rules": "Открыть правила расчётов",
  "Open periods": "Открыть периоды",
  "Open dashboard": "Открыть панель управления",
  "Open payments": "Открыть платежи",
  "Open messages": "Открыть сообщения",
  "Complete organization details": "Заполните данные организации",
  "Add the legal name, address, contact details, bank name and IBAN used on invoices.":
    "Укажите юридическое наименование, адрес, контакты, название банка и IBAN для счетов.",
  "Ready when invoice issuer and payment details are complete.":
    "Готово, когда данные выставителя счёта и реквизиты для оплаты заполнены.",
  "Add dwellings": "Добавьте помещения",
  "Create dwellings individually or import them from CSV. Check numbers, types, occupants, areas and resident counts.":
    "Создайте помещения по одному или импортируйте их из CSV. Проверьте номера, типы, жильцов, площадь и количество жильцов.",
  "Ready when every billable unit appears in the dwelling directory.":
    "Готово, когда каждое расчётное помещение появилось в списке помещений.",
  "Assign residents and meters": "Назначьте жильцов и счётчики",
  "Open each dwelling to assign resident access, add billing contact details and register its meters.":
    "Откройте каждое помещение, чтобы настроить доступ жильца, указать контакты для счетов и привязать счётчики.",
  "Ready when residents can access the correct dwelling and required meters are listed.":
    "Готово, когда жильцы могут войти в своё помещение и нужные счётчики указаны.",
  "Configure tariffs and rules": "Настройте тарифы и правила",
  "Add the billing rules that determine fixed, area, resident-count or meter-consumption charges.":
    "Добавьте правила расчёта: фиксированные начисления, по площади, по числу жильцов или по расходу по счётчикам.",
  "Ready when every required charge has an enabled rule for the billing date.":
    "Готово, когда для каждого обязательного начисления включено правило на дату счёта.",
  "Create the billing period": "Создайте расчётный период",
  "Set the billing window, reading deadline, invoice issue date and due date. Creating a period creates a case for each active dwelling.":
    "Задайте границы периода, срок подачи показаний, дату выставления и срок оплаты. При создании периода для каждого активного помещения формируется расчётная запись.",
  "Ready when the new OPEN period appears in period history.":
    "Готово, когда новый ОТКРЫТЫЙ период появится в истории периодов.",
  "Collect missing readings": "Соберите недостающие показания",
  "Use the dashboard attention list or monthly workbench to find missing readings. Residents may submit their own readings while permitted.":
    "Используйте список задач на панели управления или ежемесячную рабочую область, чтобы найти недостающие показания. Жильцы могут сами передавать показания, пока это разрешено.",
  "Ready when required cases no longer show missing readings.":
    "Готово, когда в нужных расчётных записях больше нет пропущенных показаний.",
  "Generate and review invoices": "Сформируйте и проверьте счета",
  "Generate eligible invoices in the workbench, then review calculation lines, recipient details, dates and totals.":
    "Сформируйте готовые счета в рабочей области, затем проверьте строки расчёта, данные получателя, даты и итоговые суммы.",
  "Ready when correct invoices are in DRAFT and validation blockers are resolved.":
    "Готово, когда правильные счета находятся в статусе ЧЕРНОВИК и устранены ошибки проверки.",
  "Prepare and send invoices": "Подготовьте и отправьте счета",
  "Prepare approved drafts, then send prepared invoices. A successful delivery moves the case to SENT and preserves the financial document.":
    "Подготовьте утверждённые черновики, затем отправьте подготовленные счета. После успешной доставки статус счёта меняется на ОТПРАВЛЕН, а финансовый документ фиксируется.",
  "Ready when intended invoices show SENT or a clear delivery error to resolve.":
    "Готово, когда нужные счета показывают статус ОТПРАВЛЕН или понятную ошибку доставки для исправления.",
  "Reconcile incoming payments": "Сверьте поступившие платежи",
  "Import a bank statement, inspect the preview, confirm the import and review proposed or unmatched transactions.":
    "Импортируйте банковскую выписку, посмотрите предпросмотр, подтвердите импорт и проверьте предложенные или несопоставленные операции.",
  "Ready when valid matches are confirmed and the corresponding invoices show PAID.":
    "Готово, когда правильные совпадения подтверждены, а соответствующие счета перешли в статус ОПЛАЧЕН.",
  "Handle questions and exceptions": "Разберите вопросы и спорные ситуации",
  "Review resident messages, overdue invoices, unmatched payments and delivery failures. Resolve conversations when the issue is closed.":
    "Проверяйте сообщения жильцов, просроченные счета, несопоставленные платежи и ошибки доставки. Закрывайте переписку, когда вопрос решён.",
  "Ready when attention items have an owner or are resolved.":
    "Готово, когда по всем важным задачам назначен ответственный или вопрос решён.",
  "What do the invoice statuses mean?": "Что означают статусы счетов?",
  "MISSING DATA means a required input is absent. DRAFT can still be regenerated. PREPARED is approved for sending. SENT was delivered successfully. OVERDUE is sent and unpaid after its due date. PAID has a confirmed full payment.":
    "НЕТ ДАННЫХ означает, что не заполнены обязательные данные. ЧЕРНОВИК ещё можно пересчитать. ПОДГОТОВЛЕН — счёт утверждён для отправки. ОТПРАВЛЕН — счёт успешно доставлен. ПРОСРОЧЕН — счёт отправлен, но не оплачен в срок. ОПЛАЧЕН — подтверждена полная оплата.",
  "Why can’t I generate an invoice?": "Почему не получается создать счёт?",
  "Generation is blocked when required readings are missing or the period is locked. Open the affected dwelling from the workbench to see the required input.":
    "Создание счёта заблокировано, если нет обязательных показаний или период закрыт. Откройте нужное помещение в рабочей области, чтобы увидеть недостающие данные.",
  "Why can’t I prepare an invoice?": "Почему не получается подготовить счёт?",
  "The invoice must be a DRAFT with complete issuer, recipient and payment details. Correct the linked settings, then regenerate the draft to refresh its snapshot.":
    "Счёт должен быть в статусе ЧЕРНОВИК с заполненными данными выставителя, получателя и реквизитами для оплаты. Исправьте нужные настройки, затем пересчитайте черновик, чтобы обновить данные.",
  "Why can’t I send an invoice?": "Почему не получается отправить счёт?",
  "Only PREPARED invoices with a billing email can be sent normally. If delivery fails, correct the cause and use the available retry or resend action.":
    "Обычно отправить можно только счета в статусе ПОДГОТОВЛЕН, у которых указана эл. почта для счетов. Если доставка не удалась, устраните причину и повторите отправку.",
  "Can I edit a sent invoice?": "Можно ли изменить отправленный счёт?",
  "No. A sent invoice is an immutable financial record. Changes to dwellings, tariffs or organization settings apply to future generated invoices.":
    "Нет. Отправленный счёт — это неизменяемый финансовый документ. Изменения в помещениях, тарифах или настройках организации коснутся только будущих счетов.",
  "What should I do with an unmatched payment?":
    "Что делать с несопоставленным платежом?",
  "Review its amount, currency, payer and reference. Leave it unmatched until the correct invoice can be identified; do not confirm an uncertain match.":
    "Проверьте сумму, валюту, плательщика и назначение платежа. Оставьте его несопоставленным, пока не определите нужный счёт; не подтверждайте сомнительные совпадения.",
  "When should I lock a period?": "Когда нужно закрывать период?",
  "Lock a period after normal reading and invoice input work is complete. Locked periods remain available for history but block normal reading edits and invoice regeneration.":
    "Закрывайте период, когда все показания внесены и работа со счетами завершена. Закрытые периоды остаются в истории, но в них нельзя изменить обычные показания или пересчитать счета.",
  "Auto-send day of month (1-28)": "День месяца для автоотправки (1–28)",
  "Automatically generate invoices each period":
    "Автоматически формировать счета в каждом периоде",
  "Automatically send prepared invoices":
    "Автоматически отправлять подготовленные счета",
  "Only applies when auto-send is enabled above.":
    "Действует только при включённой автоотправке выше.",
  "Area (m2)": "Площадь (м²)",
  Fixed: "Фиксированный",
  "Manual amount": "Сумма вручную",
  "Manual quantity": "Количество вручную",
  "Meter consumption": "Расход по счётчику",
  "Meter type (only for meter consumption rules)":
    "Тип счётчика (только для правил по расходу)",
  "Code (unique identifier, e.g. cold_water)":
    "Код (уникальный идентификатор, напр. cold_water)",
  "Unit (e.g. m3, month, person)":
    "Единица измерения (напр. м³, месяц, человек)",
  "Effective until (optional)": "Действует до (необязательно)",
  Mode: "Режим",
  "Create only (default) -- existing numbers become errors":
    "Только создание (по умолчанию) — существующие номера вызовут ошибку",
  "Update -- existing numbers are updated":
    "Обновление — существующие номера обновляются",
  "Back to dwellings": "Назад к помещениям",
  "Back to payments": "Назад к платежам",
  "Export dwellings (CSV)": "Экспорт помещений (CSV)",
  "Export meter readings (CSV)": "Экспорт показаний счётчиков (CSV)",
  "Import bank statement (CSV)": "Импорт банковской выписки (CSV)",
  "Import dwellings (CSV)": "Импорт помещений (CSV)",
  "Confirm even if lower than previous":
    "Подтвердить, даже если меньше предыдущего",
  "This period is locked; readings can no longer be edited.":
    "Этот период закрыт; показания больше нельзя изменить.",
  "This dwelling has no active meters.":
    "В этом помещении нет активных счётчиков.",
  "This exact file has already been imported for this organization. Importing it again will be blocked.":
    "Этот же файл уже был импортирован для этой организации. Повторный импорт заблокирован.",
  Resend: "Отправить повторно",
  "Revoke access link": "Отозвать ссылку доступа",
  When: "Когда",
  To: "Кому",
  Error: "Ошибка",
  Invoiced: "Выставлено",
  "Next period →": "Следующий период →",
  "Next →": "Далее →",
  "View conversations for this dwelling →":
    "Посмотреть переписку по этому помещению →",
  "Resident access is assigned per dwelling, from each dwelling's detail page.":
    "Доступ для жильцов настраивается на странице каждого помещения.",
  "You don't belong to any organization yet. Create one below.":
    "Вы пока не состоите ни в одной организации. Создайте её ниже.",
  "You don't have access to any dwellings.":
    "У вас нет доступа ни к одному помещению.",
  "No active meters for this dwelling.":
    "Для этого помещения нет активных счётчиков.",
  "No archived meters for this dwelling.":
    "Для этого помещения нет архивных счётчиков.",
  "Filter meters": "Фильтр счётчиков",
  "No consumption history yet.": "Истории расхода пока нет.",
  "Invoice email is missing. Add a billing email before sending.":
    "Не указана эл. почта для счетов. Добавьте её перед отправкой.",
  "Correct the details and regenerate the draft before preparing it again.":
    "Исправьте данные и пересчитайте черновик перед повторной подготовкой.",
  Upload: "Загрузить",
  Preview: "Предпросмотр",
  "Confirm import": "Подтвердить импорт",
  "Choose another file": "Выбрать другой файл",
  "CSV file": "Файл CSV",
  "Import dwellings": "Импортировать помещения",
  "Bank statement CSV file": "Файл банковской выписки CSV",
  Row: "Строка",
  Errors: "Ошибки",
  "Review the preview before confirming. Only confirmation saves data.":
    "Проверьте данные перед подтверждением. Данные сохраняются только после подтверждения.",
  Name: "Название",
  Address: "Адрес",
  City: "Город",
  "Postal code": "Почтовый индекс",
  Phone: "Телефон",
  "Bank name": "Название банка",
  "Billing address": "Адрес для счетов",
  "Billing email": "Эл. почта для счетов",
  "Occupant name": "Имя жильца",
  "Resident count": "Количество жильцов",
  "Resident access": "Доступ для жильцов",
  Meters: "Счётчики",
  "Serial number": "Серийный номер",
  Label: "Название",
  Unit: "Единица измерения",
  "Add meter": "Добавить счётчик",
  Assign: "Назначить",
  Remove: "Удалить",
  "Add admin": "Добавить администратора",
  "Admin users": "Администраторы",
  "Your organizations": "Ваши организации",
  "Create organization": "Создать организацию",
  Create: "Создать",
  Account: "Аккаунт",
  "Dwelling access": "Доступ к помещениям",
  Timezone: "Часовой пояс",
  Locale: "Язык",
  "Invoice number prefix": "Префикс номера счёта",
  "Default due days": "Дней на оплату по умолчанию",
  "Tariffs and rules": "Тарифы и правила",
  "Create rule": "Создать правило",
  "VAT %": "НДС %",
  Effective: "Действует",
  Edit: "Редактировать",
  "Effective from": "Действует с",
  "Effective until": "Действует до",
  "Audit log": "Журнал аудита",
  "All actions": "Все действия",
  Action: "Действие",
  "Entity type": "Тип объекта",
  Time: "Время",
  Actor: "Пользователь",
  Entity: "Объект",
  Details: "Детали",
  Updated: "Обновлено",
  Resolve: "Отметить решённым",
  "No conversations match this filter.":
    "Нет сообщений, подходящих под этот фильтр.",
  "No conversations yet.": "Сообщений пока нет.",
  "This conversation is resolved.": "Этот вопрос решён.",
  "No residents assigned.": "Жильцы не назначены.",
  "Meter added": "Счётчик добавлен",
  "Resident added": "Житель добавлен",
  "This resident already has access.": "У этого жителя уже есть доступ.",
  "No billing rules yet.": "Правил расчёта пока нет.",
  "No dwellings assigned.": "Помещения не назначены.",
  "No transactions in this import.": "В этом импорте нет операций.",
  "Match status": "Статус сопоставления",
  "No audit events match this filter.": "Под этот фильтр нет событий аудита.",
  "Legal and contact details": "Юридические и контактные данные",
  "Bank details": "Банковские реквизиты",
  Automation: "Автоматизация",
  "Billing defaults": "Настройки расчётов по умолчанию",
  "Settings are not available yet. Existing invoice documents remain available from billing periods.":
    "Настройки пока недоступны. Уже выставленные счета по-прежнему доступны в расчётных периодах.",
  Dashboard: "Панель управления",
  Periods: "Периоды",
  Dwellings: "Помещения",
  Payments: "Платежи",
  Messages: "Сообщения",
  Settings: "Настройки",
  "Property Billing": "Счета за недвижимость",
  Administration: "Администрирование",
  "Resident portal": "Портал жильца",
  Portal: "Портал",
  "Sign out": "Выйти",
  "Switch organization": "Сменить организацию",
  Navigation: "Навигация",
  "Skip to content": "Перейти к содержимому",
  Menu: "Меню",
  Profile: "Профиль",
  Overview: "Обзор",
  Invoices: "Счета",
  Dwelling: "Помещение",
  "Missing data": "Нет данных",
  Draft: "Черновик",
  Prepared: "Подготовлен",
  Sent: "Отправлен",
  Paid: "Оплачен",
  Overdue: "Просрочен",
  Open: "Открыт",
  Locked: "Закрыт",
  Active: "Активен",
  Archived: "В архиве",
  New: "Новый",
  Resolved: "Решён",
  Proposed: "Предложен",
  Confirmed: "Подтверждён",
  Rejected: "Отклонён",
  Unmatched: "Не сопоставлен",
  Failed: "Не удалось",
  Pending: "Ожидает",
  Enabled: "Включено",
  Disabled: "Выключено",
  "Total invoiced": "Всего выставлено",
  Outstanding: "Не оплачен",
  "Cold water": "Холодная вода",
  "Hot water": "Горячая вода",
  Consumption: "Расход",
  "Needs attention": "Требует внимания",
  "Case status": "Статус расчёта",
  "Open workbench": "Открыть рабочую область",
  "Monitor billing, payments and work requiring attention.":
    "Следите за счетами, платежами и задачами, требующими внимания.",
  "No billing periods yet.": "Расчётных периодов пока нет.",
  "Create a period to start the monthly billing workflow.":
    "Создайте период, чтобы начать ежемесячный расчёт.",
  "Nothing needs attention right now.": "Сейчас ничего не требует внимания.",
  "Add readings": "Внести показания",
  "Review invoice": "Проверить счёт",
  "Review payments": "Проверить платежи",
  "Ready to generate": "Готов к формированию",
  "Ready to invoice": "Готов к счёту",
  "Generate the invoice": "Создать счёт",
  "Ready to send": "Готов к отправке",
  "Readings are required before generating an invoice.":
    "Перед созданием счёта нужно внести показания.",
  "Payment is past its due date. Review reconciliation.":
    "Срок оплаты прошёл. Проверьте сверку платежей.",
  "All readings are present. Generate the invoice in the workbench.":
    "Все показания внесены. Создайте счёт в рабочей области.",
  "Billing periods": "Расчётные периоды",
  "Period history": "История периодов",
  "Review past periods or open a monthly billing workbench.":
    "Посмотрите прошлые периоды или откройте рабочую область за месяц.",
  "Create period": "Создать период",
  "Total periods": "Всего периодов",
  "Latest period": "Последний период",
  Period: "Период",
  Dates: "Даты",
  "Reading deadline": "Срок подачи показаний",
  "Issue date": "Дата выставления",
  "Due date": "Срок оплаты",
  Status: "Статус",
  Actions: "Действия",
  View: "Посмотреть",
  Year: "Год",
  Month: "Месяц",
  "Billing window": "Границы периода",
  "Invoice dates": "Даты счёта",
  "Starts on": "Начало",
  "Ends on": "Окончание",
  "Invoice issue date": "Дата выставления счёта",
  "Invoice due date": "Срок оплаты счёта",
  "Monthly workbench": "Рабочая область за месяц",
  "Collect readings, generate invoices, then prepare and send.":
    "Внесите показания, создайте счета, затем подготовьте и отправьте.",
  "Period navigation": "Навигация по периодам",
  "Lock this period?": "Закрыть этот период?",
  "Locking this period prevents normal reading edits and invoice regeneration. Historical data will remain available.":
    "После закрытия этого периода нельзя будет менять показания и пересчитывать счета. История данных останется доступна.",
  Cancel: "Отмена",
  "Billing workflow": "Процесс расчётов",
  "billing cases in this period": "расчётных записей в этом периоде",
  "Select a stage to filter the queue":
    "Выберите этап, чтобы отфильтровать список",
  "Filter by workflow stage": "Фильтр по этапу расчёта",
  All: "Все",
  "All billing cases": "Все расчётные записи",
  "Resolve inputs": "Заполнить данные",
  "Review and prepare": "Проверить и подготовить",
  "Payment needs review": "Нужно проверить платёж",
  Delivered: "Доставлен",
  Complete: "Завершено",
  "Financial summary": "Финансовый итог",
  "invoices generated": "счетов создано",
  "invoices prepared": "счетов подготовлено",
  "invoices sent": "счетов отправлено",
  skipped: "пропущено",
  "Billing cases": "Расчётные записи",
  "Resolve blockers, then move each invoice to its next stage.":
    "Устраните проблемы и переведите каждый счёт на следующий этап.",
  "Search dwelling…": "Поиск помещения…",
  "Clear filters": "Сбросить фильтры",
  selected: "выбрано",
  "eligible to prepare": "можно подготовить",
  "eligible to send": "можно отправить",
  "Prepare eligible": "Подготовить подходящие",
  "Send eligible": "Отправить подходящие",
  "Clear selection": "Снять выбор",
  "Billing inputs": "Данные для счёта",
  "Next action": "Следующее действие",
  missing: "нет данных",
  "Required readings complete": "Обязательные показания внесены",
  "Billing email ready": "Эл. почта для счетов указана",
  "Billing email missing": "Не указана эл. почта для счетов",
  "Recipient details incomplete": "Данные получателя заполнены не полностью",
  "Issuer or payment details incomplete":
    "Данные выставителя или реквизиты для оплаты заполнены не полностью",
  "No invoice": "Нет счёта",
  "View invoice": "Посмотреть счёт",
  "Generate invoice": "Создать счёт",
  "Add billing email": "Добавить эл. почту для счетов",
  "Send invoice": "Отправить счёт",
  "Regenerate invoice": "Пересчитать счёт",
  "No dwellings are missing required billing data.":
    "Во всех помещениях заполнены обязательные данные для счетов.",
  "No billing cases match these filters.":
    "Нет расчётных записей, подходящих под эти фильтры.",
  "This period is locked. Readings and invoice generation cannot be changed.":
    "Этот период закрыт. Показания и создание счетов больше нельзя изменить.",
  "Select draft invoices to prepare, or prepared invoices to send.":
    "Выберите черновики для подготовки или подготовленные счета для отправки.",
  "Select invoice": "Выбрать счёт",
  "Select all eligible invoices": "Выбрать все подходящие счета",
  "Generate all eligible": "Создать все подходящие",
  "Prepare selected": "Подготовить выбранные",
  "Send selected": "Отправить выбранные",
  "Lock period": "Закрыть период",
  Generate: "Создать",
  Regenerate: "Пересчитать",
  Prepare: "Подготовить",
  Send: "Отправить",
  "Search dwelling": "Поиск помещения",
  "All statuses": "Все статусы",
  Apply: "Применить",
  Clear: "Очистить",
  "Missing readings": "Недостающие показания",
  Invoice: "Счёт",
  None: "Нет",
  "Enter readings": "Внести показания",
  "View readings": "Посмотреть показания",
  "Previous period": "Предыдущий период",
  "Next period": "Следующий период",
  "No billing cases for this period.": "В этом периоде нет расчётных записей.",
  Search: "Поиск",
  Filter: "Фильтровать",
  "All types": "Все типы",
  "Show archived": "Показывать архивные",
  Number: "Номер",
  Type: "Тип",
  Occupant: "Жилец",
  "Area (m²)": "Площадь (м²)",
  Residents: "Жильцы",
  Apartment: "Квартира",
  "Commercial unit": "Коммерческое помещение",
  Parking: "Парковка",
  Storage: "Кладовая",
  Other: "Другое",
  "Export CSV": "Экспорт CSV",
  "Import CSV": "Импорт CSV",
  "Add dwelling": "Добавить помещение",
  "Create dwelling": "Создать помещение",
  "View dwelling": "Посмотреть помещение",
  "More actions": "Другие действия",
  Archive: "Архивировать",
  "Manage dwelling details, occupants and resident access.":
    "Управляйте данными помещений, жильцами и доступом.",
  "New dwellings are included in future periods. Archive historically billed dwellings to preserve their invoices.":
    "Новые помещения войдут в будущие периоды. Архивируйте помещения с прошлыми счетами, чтобы сохранить эти счета.",
  "No dwellings match this filter.":
    "Нет помещений, подходящих под этот фильтр.",
  Previous: "Предыдущая",
  Next: "Следующая",
  Page: "Страница",
  "Import bank statement": "Импортировать банковскую выписку",
  "Bank imports": "Импорт из банка",
  Imports: "Импорты",
  "Review proposed matches and reconcile incoming payments.":
    "Проверьте предложенные совпадения и сверьте поступившие платежи.",
  Reconciliation: "Сверка платежей",
  "Import history": "История импорта",
  Filename: "Имя файла",
  Imported: "Импортирован",
  Rows: "Строки",
  Amount: "Сумма",
  Reference: "Назначение платежа",
  Payer: "Плательщик",
  "Booking date": "Дата проводки",
  Confirm: "Подтвердить",
  Reject: "Отклонить",
  "No imports yet.": "Импортов пока нет.",
  "No transactions in this view.": "В этом списке нет операций.",
  Currency: "Валюта",
  Issuer: "Выставитель",
  Recipient: "Получатель",
  Payment: "Платёж",
  Subtotal: "Промежуточный итог",
  VAT: "НДС",
  "Total due": "Итого к оплате",
  Total: "Итого",
  Description: "Описание",
  Quantity: "Количество",
  "Unit price": "Цена за единицу",
  Net: "Без НДС",
  Gross: "С НДС",
  "Download PDF": "Скачать PDF",
  Print: "Печать",
  "Recipient information is incomplete. Add a billing name or occupant name and billing address.":
    "Данные получателя заполнены не полностью. Укажите имя для счетов или имя жильца и адрес для счетов.",
  "Issuer or payment information is incomplete. Add the organization name, address, bank name and IBAN.":
    "Данные выставителя или реквизиты для оплаты заполнены не полностью. Укажите название организации, адрес, название банка и IBAN.",
  "Fix dwelling details": "Исправить данные помещения",
  "Fix organization details": "Исправить данные организации",
  "After correcting the details, regenerate this draft in the workbench to refresh its snapshot.":
    "После исправления данных пересчитайте этот черновик в рабочей области, чтобы обновить данные.",
  "Delivery history": "История доставки",
  "Current invoice": "Текущий счёт",
  "Your billing, readings and messages in one place.":
    "Ваши счета, показания и сообщения в одном месте.",
  "Meter readings": "Показания счётчиков",
  "Reading received": "Показание получено",
  Reading: "Показание",
  "Current value": "Текущее значение",
  "Submit reading": "Передать показание",
  "The reading deadline has passed. Contact your administrator.":
    "Срок подачи показаний прошёл. Свяжитесь с администратором.",
  "No current invoice yet.": "Текущего счёта пока нет.",
  "Consumption history": "История расхода",
  "Contact administrator": "Связаться с администратором",
  "Recent invoices": "Последние счета",
  "View all": "Посмотреть все",
  "No invoices yet.": "Счетов пока нет.",
  "Your dwellings": "Ваши помещения",
  "Choose a dwelling to view its invoices and readings.":
    "Выберите помещение, чтобы посмотреть его счета и показания.",
  Electricity: "Электричество",
  Gas: "Газ",
  Heat: "Отопление",
  Administrator: "Администратор",
  Resident: "Жилец",
  Import: "Импорт",
  Reply: "Ответить",
  Message: "Сообщение",
  Subject: "Тема",
  "New message": "Новое сообщение",
  "Send reply": "Отправить ответ",
  "Resident conversations and billing questions.":
    "Переписка с жильцами и вопросы по счетам.",
  "Configure your organization, billing and access.":
    "Настройте организацию, расчёты и доступ.",
  Organization: "Организация",
  Billing: "Расчёты",
  "Tariffs & rules": "Тарифы и правила",
  "Invoice template": "Шаблон счёта",
  "Users & access": "Пользователи и доступ",
  Data: "Данные",
  "Legal, bank, and contact details.":
    "Юридические, банковские и контактные данные.",
  "Admin membership and resident access.":
    "Администраторы и доступ для жильцов.",
  "Automation and due-date defaults.":
    "Автоматизация и сроки оплаты по умолчанию.",
  "Billing calculation rules.": "Правила расчёта счетов.",
  "Invoice appearance.": "Внешний вид счёта.",
  "Import and export.": "Импорт и экспорт.",
  "Audit history": "История аудита",
  "Review recorded organization activity.":
    "Посмотрите действия, записанные в организации.",
  Save: "Сохранить",
  "Billing name": "Имя для счетов",
  Email: "Эл. почта",
  "Working…": "Обработка…",
  "Saved successfully.": "Успешно сохранено.",
  "Use a decimal point and up to three decimal places.":
    "Используйте точку и не более трёх знаков после неё.",
  "Toggle theme": "Переключить тему",
  "Switch to light theme": "Переключить на светлую тему",
  "Switch to dark theme": "Переключить на тёмную тему",
  "Light theme": "Светлая тема",
  "Dark theme": "Тёмная тема",
  "Add resident": "Добавить жильца",
  "Additional information": "Дополнительная информация",
  "Adjustments will appear here.": "Корректировки появятся здесь.",
  "All adjustments and balance history.":
    "Все корректировки и история остатка.",
  "Apartment number": "Номер квартиры",
  "Archive dwelling": "Архивировать помещение",
  "Archive this dwelling?": "Архивировать это помещение?",
  "Archiving hides it from new periods and active lists. Past invoices and readings remain intact.":
    "Архивация скроет его из новых периодов и активных списков. Прошлые счета и показания останутся нетронутыми.",
  Area: "Площадь",
  "Basic information": "Основная информация",
  "Billing details": "Данные для счетов",
  Building: "Здание",
  "Calculated consumption": "Рассчитанный расход",
  "Changes recorded against this dwelling.":
    "Изменения, записанные по этому помещению.",
  "Changes saved": "Изменения сохранены",
  Close: "Закрыть",
  "Complete the details below to resolve invoice preparation blockers.":
    "Заполните данные ниже, чтобы устранить проблемы с подготовкой счёта.",
  "Consumption is calculated automatically.":
    "Расход рассчитывается автоматически.",
  "Conversations with residents will appear here.":
    "Переписка с жильцами появится здесь.",
  "Core information about this dwelling.":
    "Основная информация об этом помещении.",
  "Create adjustment": "Создать корректировку",
  Created: "Создано",
  "Current reading": "Текущее показание",
  DWELLING: "ПОМЕЩЕНИЕ",
  Date: "Дата",
  "Discard unsaved changes? Your edits have not been saved.":
    "Сбросить несохранённые изменения? Ваши правки не сохранены.",
  "Enter current meter readings for this period.":
    "Внесите текущие показания счётчиков за этот период.",
  "How this dwelling receives its invoices.":
    "Как это помещение получает счета.",
  "Internal notes and metadata.": "Внутренние примечания и метаданные.",
  "Invoice delivery": "Доставка счетов",
  "Last updated": "Последнее обновление",
  "Latest messages with this dwelling.":
    "Последние сообщения по этому помещению.",
  "Loading…": "Загрузка…",
  Method: "Способ",
  "No account entries yet": "Записей по счёту пока нет",
  "No audit events for this dwelling yet.":
    "Для этого помещения пока нет событий аудита.",
  "No billing email on file": "Не указана эл. почта для счетов",
  "No messages yet": "Сообщений пока нет",
  "No open period": "Нет открытого периода",
  Note: "Примечание",
  Notes: "Примечания",
  "Open full dwelling": "Открыть помещение полностью",
  "Outstanding balance": "Остаток долга",
  Paper: "На бумаге",
  "Paper delivery": "Доставка на бумаге",
  "People who can access their invoices and messages.":
    "Люди с доступом к своим счетам и сообщениям.",
  "Previous reading": "Предыдущее показание",
  "Reading saved": "Показание сохранено",
  Reason: "Причина",
  "Recent messages": "Последние сообщения",
  "Save changes": "Сохранить изменения",
  "Save readings": "Сохранить показания",
  "Saving…": "Сохранение…",
  Sections: "Разделы",
  "Send a printed copy by mail": "Отправить печатную копию по почте",
  "Send invoices to": "Отправлять счета по адресу",
  "Something went wrong. Please try again.":
    "Что-то пошло не так. Попробуйте ещё раз.",
  "This dwelling's billing case in every period it has existed for.":
    "Расчётная запись этого помещения в каждом периоде, когда оно существовало.",
  "Total credits": "Всего по кредиту",
  "Total debits": "Всего по дебету",
  "View current period": "Посмотреть текущий период",
  "Water and other utility meters in this dwelling.":
    "Счётчики воды и других коммунальных услуг в этом помещении.",
  archived: "в архиве",
  "e.g. 123 Main Street, Apt 4B\nRiga, LV-1010":
    "напр., ул. Бривибас 123, кв. 4B\nРига, LV-1010",
  "e.g. John Smith or Company Ltd": "напр., Иван Иванов или ООО Компания",

  // Added: translation coverage pass (settings/rules/billing/messages/guide/dashboard)
  "-- none --": "-- нет --",
  "A descriptive name for this rule.": "Понятное название этого правила.",
  "English invoice label": "Английское название в счёте",
  "Russian invoice label": "Русское название в счёте",
  "Optional -- falls back to the Latvian name":
    "Необязательно -- если не указано, используется латышское название",
  "Add a new tariff or billing rule. Fill in the details below.":
    "Добавьте новый тариф или правило расчёта. Заполните данные ниже.",
  "Add a note about this dwelling…": "Добавьте примечание об этом помещении…",
  Admin: "Администратор",
  "Admin dashboard with billing totals and work that needs attention.":
    "Панель администратора с итогами по счетам и задачами, требующими внимания.",
  "Apply late fees to overdue invoices.":
    "Начислять плату за просрочку на просроченные счета.",
  "Auto-send day of month": "День месяца для автоматической отправки",
  "Automatic generation and sending run only for eligible billing periods.":
    "Автоматическое формирование и отправка выполняются только для подходящих расчётных периодов.",
  "Automation scope": "Область автоматизации",
  "Avoid overlapping rules of the same type. When a new rate applies, create a new rule with a later effective date.":
    "Избегайте пересечения правил одного типа. Когда вступает в силу новая ставка, создайте новое правило с более поздней датой начала.",
  "Billing information": "Информация для счетов",
  "Billing summary": "Сводка по счетам",
  Breadcrumb: "Путь навигации",
  "Changes to late-payment rules affect future calculations only. Existing invoices keep their original financial snapshot.":
    "Изменения правил просрочки платежа влияют только на будущие расчёты. Существующие счета сохраняют исходные финансовые данные.",
  Code: "Код",
  "Configure invoice defaults, automation, and late-payment rules.":
    "Настройте параметры счетов по умолчанию, автоматизацию и правила просрочки платежа.",
  "Control automatic invoice generation and sending.":
    "Управляйте автоматическим формированием и отправкой счетов.",
  "Core invoicing preferences for this organization.":
    "Основные настройки выставления счетов для этой организации.",
  "Creates draft invoices for all eligible accounts at the start of each period.":
    "В начале каждого периода создаются черновики счетов для всех подходящих лицевых счетов.",
  "Current defaults for this organization.":
    "Текущие значения по умолчанию для этой организации.",
  "Daily late fee rate as a percentage.":
    "Дневная ставка платы за просрочку в процентах.",
  "Daily rate (%)": "Дневная ставка (%)",
  "Date when this rule becomes active.":
    "Дата, с которой это правило вступает в силу.",
  "Do not accrue additional fees once the maximum penalty is reached.":
    "Не начислять дополнительную плату после достижения максимального штрафа.",
  "Due days": "Срок оплаты (в днях)",
  "Each month, open the current period. Resolve missing inputs, prepare invoices, send them, and reconcile payments.":
    "Каждый месяц открывайте текущий период. Заполните недостающие данные, подготовьте счета, отправьте их и сверьте платежи.",
  "Each rule has an effective period and can be archived when no longer in use.":
    "У каждого правила есть период действия, и его можно архивировать, когда оно больше не используется.",
  "Effective period": "Период действия",
  "Effective periods": "Периоды действия",
  "Fill in the form to see a preview":
    "Заполните форму, чтобы увидеть предпросмотр",
  "Filter by status": "Фильтр по статусу",
  "Fixed rules": "Фиксированные правила",
  "Follow these steps in order for your first billing run. After setup, repeat the monthly cycle every month.":
    "Выполните эти шаги по порядку для первого цикла расчёта. После настройки повторяйте месячный цикл каждый месяц.",
  "Good to know": "Полезно знать",
  "Grace period (days)": "Льготный период (в днях)",
  "Help & guidance": "Справка и руководство",
  History: "История",
  "How tariffs are applied": "Как применяются тарифы",
  "How the charge is calculated.": "Как рассчитывается плата.",
  "Important details about billing settings.":
    "Важная информация о настройках выставления счетов.",
  "Internal note (optional)": "Внутренняя заметка (необязательно)",
  "Invoice numbering": "Нумерация счетов",
  "Invoice prefix": "Префикс счёта",
  "Keep your details current so that invoices, payments, and official communication are processed without delays.":
    "Поддерживайте свои данные в актуальном состоянии, чтобы счета, платежи и официальная переписка обрабатывались без задержек.",
  "Keep your organization details up to date to ensure correct invoicing and communication.":
    "Поддерживайте данные организации в актуальном состоянии для правильного выставления счетов и переписки.",
  "Late-payment changes": "Изменения по просрочке платежа",
  "Leave empty for ongoing.": "Оставьте пустым, если период продолжается.",
  "Manage legal, contact, and bank details for this organization.":
    "Управляйте юридическими, контактными и банковскими данными этой организации.",
  "Manage utility rates, billing formulas, and effective periods.":
    "Управляйте тарифами на коммунальные услуги, формулами расчёта и периодами действия.",
  "Mark resolved": "Отметить как решённое",
  "Maximum penalty as a percentage of eligible principal.":
    "Максимальный штраф в процентах от применимой основной суммы.",
  "Maximum total penalty (%)": "Максимальный общий штраф (%)",
  "Meter type": "Тип счётчика",
  "Meter-based rules": "Правила на основе показаний счётчика",
  "Need help?": "Нужна помощь?",
  "No billing rules match this filter.":
    "Нет правил расчёта, соответствующих этому фильтру.",
  "No resident": "Нет жильца",
  "Number of days after the due date before late fees apply.":
    "Количество дней после срока оплаты до начисления платы за просрочку.",
  "Number of days after the invoice date.":
    "Количество дней после даты выставления счёта.",
  "Number, occupant, address...": "Номер, жилец, адрес...",
  "Only for meter consumption rules.": "Только для правил расхода по счётчику.",
  "Open dwelling": "Открыть помещение",
  "Organization summary": "Сводка по организации",
  "Prefix for newly generated invoice numbers.":
    "Префикс для номеров новых счетов.",
  "Price per unit (excl. VAT).": "Цена за единицу (без НДС).",
  "Resident information": "Информация о жильце",
  "Review resident questions, send updates, and keep billing conversations in context.":
    "Просматривайте вопросы жильцов, отправляйте обновления и держите переписку по счетам в одном месте.",
  "Rule summary": "Сводка по правилу",
  "Rules applied to future late-fee calculations. Existing invoices keep their original financial snapshot.":
    "Правила применяются к будущим расчётам платы за просрочку. Существующие счета сохраняют исходные финансовые данные.",
  "Search messages by subject or content...":
    "Поиск сообщений по теме или содержанию...",
  "Search rules by name or code...": "Поиск правил по названию или коду...",
  "Select a conversation to view it here.":
    "Выберите переписку, чтобы просмотреть её здесь.",
  "Send message": "Отправить сообщение",
  "Sends invoices to recipients automatically.":
    "Автоматически отправляет счета получателям.",
  "Show unread only": "Показывать только непрочитанные",
  "Showing conversations for one dwelling only.":
    "Показана переписка только по одному помещению.",
  "Tariffs define how charges are calculated for each billing period.":
    "Тарифы определяют, как рассчитывается плата за каждый расчётный период.",
  "The invoice number prefix is applied to newly generated invoices.":
    "Префикс номера счёта применяется к новым счетам.",
  "The summary will show how this rule will appear in the list and how it will be applied to bills.":
    "В сводке будет показано, как это правило будет выглядеть в списке и как оно будет применяться к счетам.",
  "This information is used for receiving payments.":
    "Эта информация используется для получения платежей.",
  "This information is used on invoices and for official communication.":
    "Эта информация используется в счетах и в официальной переписке.",
  "This is how your organization details appear on invoices.":
    "Так данные вашей организации будут отображаться на счетах.",
  "Type your reply...": "Введите ваш ответ...",
  "Unique identifier (e.g. cold_water).":
    "Уникальный идентификатор (например, cold_water).",
  "Unit of measurement.": "Единица измерения.",
  "Use fixed rules for regular charges like maintenance fees. The amount is the same each period (per unit).":
    "Используйте фиксированные правила для регулярных платежей, например за обслуживание. Сумма одинакова каждый период (за единицу).",
  "Use meter consumption for utilities like water, heat, or electricity. Charges are calculated from the difference in meter readings.":
    "Используйте расход по счётчику для таких услуг, как вода, отопление или электричество. Плата рассчитывается по разнице показаний счётчика.",
  "Use the status to see what you can do next.":
    "Используйте статус, чтобы увидеть, что можно сделать дальше.",
  "Used only when automatic sending is enabled.":
    "Используется только при включённой автоматической отправке.",
  "Value added tax percentage.":
    "Процентная ставка налога на добавленную стоимость.",
  "e.g. Cold Water": "напр., Холодная вода",
  "e.g. cold_water": "напр., cold_water",
  "e.g. m3, month, person": "напр., м3, месяц, человек",
  ongoing: "по настоящее время",

  // Added: translation coverage pass 2 (guide setup/monthly steps, faqs, statuses; dashboard ternaries)
  "Add the legal name, address, contact details, bank name, and IBAN used on invoices.":
    "Укажите юридическое название, адрес, контактные данные, название банка и IBAN, используемые в счетах.",
  "Ready when the invoice issuer and payment details are complete.":
    "Готово, когда данные выставителя счета и реквизиты для оплаты заполнены.",
  "Create dwellings one at a time, or import them from a CSV file. Check each number, type, occupant, area, and resident count.":
    "Создавайте жилые объекты по одному или импортируйте их из файла CSV. Проверьте номер, тип, владельца, площадь и число жильцов каждого объекта.",
  "Ready when every billable unit appears in the dwelling list.":
    "Готово, когда все объекты для выставления счетов отображаются в списке жилых объектов.",
  "Dwelling list with filters and dwelling details.":
    "Список жилых объектов с фильтрами и подробными данными.",
  "Open each dwelling. Assign resident access. Add billing contact details. Register its meters.":
    "Откройте каждый жилой объект. Назначьте доступ жильцу. Добавьте контактные данные для счетов. Зарегистрируйте его счетчики.",
  "Ready when residents can access their dwelling and all meters are listed.":
    "Готово, когда жильцы могут получить доступ к своему жилому объекту и все счетчики внесены в список.",
  "Dwelling detail page with resident access and meter registration.":
    "Страница сведений о жилом объекте с доступом жильца и регистрацией счетчиков.",
  "Set tariffs and rules": "Настройте тарифы и правила",
  "Add the billing rules that set fixed, area, resident-count, or meter-consumption charges.":
    "Добавьте правила начисления, которые задают фиксированную плату, плату за площадь, за число жильцов или за показания счетчиков.",
  "Tariffs and rules list with rule details.":
    "Список тарифов и правил с подробными данными.",
  "Set the billing window, reading deadline, invoice issue date, and due date. A new period creates a case for each active dwelling.":
    "Задайте период выставления счетов, срок подачи показаний, дату выставления счета и срок оплаты. Новый период создает дело для каждого активного жилого объекта.",
  "Ready when the new OPEN period appears in the period list.":
    "Готово, когда новый ОТКРЫТЫЙ период появляется в списке периодов.",
  "Billing period list and period actions.":
    "Список периодов выставления счетов и действия с периодами.",
  "Use the dashboard attention list or the monthly workbench to find missing readings. Residents can also submit readings when allowed.":
    "Используйте список требующих внимания дел на панели управления или ежемесячную рабочую область, чтобы найти недостающие показания. Жильцы также могут подавать показания, если это разрешено.",
  "Generate eligible invoices in the workbench. Review the calculation lines, recipient details, dates, and totals.":
    "Формируйте подходящие счета в рабочей области. Проверьте строки расчета, данные получателя, даты и итоговые суммы.",
  "Ready when correct invoices are in DRAFT and you have fixed all validation blockers.":
    "Готово, когда верные счета имеют статус ЧЕРНОВИК и все ошибки проверки устранены.",
  "Monthly workbench with the billing workflow and case list.":
    "Ежемесячная рабочая область с рабочим процессом выставления счетов и списком дел.",
  "Prepare approved drafts. Send the prepared invoices. Delivery moves each case to SENT and locks the invoice.":
    "Подготовьте одобренные черновики. Отправьте подготовленные счета. Доставка переводит каждое дело в статус ОТПРАВЛЕНО и блокирует счет.",
  "Ready when sent invoices show SENT, or show a clear delivery error to fix.":
    "Готово, когда отправленные счета показывают статус ОТПРАВЛЕНО или четкую ошибку доставки, которую нужно исправить.",
  "Import a bank statement. Check the preview. Confirm the import. Review proposed or unmatched transactions.":
    "Импортируйте банковскую выписку. Проверьте предварительный просмотр. Подтвердите импорт. Просмотрите предложенные или несопоставленные транзакции.",
  "Ready when you have confirmed valid matches and the matching invoices show PAID.":
    "Готово, когда вы подтвердили верные совпадения и соответствующие счета показывают статус ОПЛАЧЕНО.",
  "Review resident messages, overdue invoices, unmatched payments, and delivery failures. Resolve each conversation once its issue is fixed.":
    "Просматривайте сообщения жильцов, просроченные счета, несопоставленные платежи и ошибки доставки. Закрывайте каждый разговор после устранения его проблемы.",
  "Ready when every attention item has an owner or is resolved.":
    "Готово, когда у каждого требующего внимания пункта есть ответственный или он решен.",
  "Messages inbox with a resident conversation open.":
    "Папка входящих сообщений с открытым разговором с жильцом.",
  "MISSING DATA means a required input is missing. READY means all required readings are in. DRAFT means you can still review and regenerate it. PREPARED is approved and ready to send. SENT means delivery succeeded. OVERDUE means the due date passed unpaid. PAID means the invoice is fully paid.":
    "MISSING DATA означает, что отсутствуют обязательные данные. READY означает, что все необходимые показания внесены. DRAFT означает, что счет еще можно проверить и сформировать заново. PREPARED означает, что счет одобрен и готов к отправке. SENT означает, что доставка прошла успешно. OVERDUE означает, что срок оплаты истек, а счет не оплачен. PAID означает, что счет оплачен полностью.",
  "Why can I not generate an invoice?": "Почему я не могу сформировать счет?",
  "The system blocks generation when required readings are missing or the period is locked. Open the affected dwelling in the workbench to see what is missing.":
    "Система блокирует формирование, если отсутствуют необходимые показания или период заблокирован. Откройте нужный жилой объект в рабочей области, чтобы увидеть, чего не хватает.",
  "Why can I not prepare an invoice?": "Почему я не могу подготовить счет?",
  "The invoice must be a DRAFT with complete issuer, recipient, and payment details. Fix the related settings. Regenerate the draft to update its snapshot.":
    "Счет должен иметь статус ЧЕРНОВИК с полными данными плательщика, получателя и оплаты. Исправьте соответствующие настройки. Сформируйте черновик заново, чтобы обновить его снимок данных.",
  "Why can I not send an invoice?": "Почему я не могу отправить счет?",
  "You can send only PREPARED invoices that have a billing email. If delivery fails, fix the cause, then retry or resend.":
    "Вы можете отправлять только счета со статусом PREPARED, у которых указан адрес электронной почты для счетов. Если доставка не удалась, устраните причину, затем повторите попытку или отправьте счет снова.",
  "No. A sent invoice is a permanent financial record and cannot change. Changes to dwellings, tariffs, or settings apply only to future invoices.":
    "Нет. Отправленный счет является постоянной финансовой записью и не может быть изменен. Изменения жилых объектов, тарифов или настроек применяются только к будущим счетам.",
  "Review its amount, currency, payer, and reference. Leave it unmatched until you find the correct invoice. Do not confirm a match you are not sure about.":
    "Проверьте его сумму, валюту, плательщика и назначение платежа. Оставьте его несопоставленным, пока не найдете правильный счет. Не подтверждайте совпадение, в котором вы не уверены.",
  "Lock a period after its normal reading and invoice work is complete. A locked period stays available for history, but blocks reading edits and invoice regeneration.":
    "Блокируйте период после завершения обычной работы с показаниями и счетами. Заблокированный период остается доступным для истории, но не позволяет изменять показания и заново формировать счета.",
  "Required input is missing. Generation is blocked.":
    "Отсутствуют обязательные данные. Формирование заблокировано.",
  "All required readings are in. You can now generate the invoice.":
    "Все необходимые показания внесены. Теперь вы можете сформировать счет.",
  "You can still review and regenerate the invoice.":
    "Счет еще можно проверить и сформировать заново.",
  "Delivery succeeded.": "Доставка прошла успешно.",
  "The invoice is fully paid.": "Счет оплачен полностью.",
  "The due date passed and the invoice is still unpaid.":
    "Срок оплаты истек, а счет до сих пор не оплачен.",
  "Awaiting reply": "Ожидает ответа",

  // Added: translation coverage pass 3 (settings hub card grid)
  "Core settings": "Основные настройки",
  "Administration tools": "Инструменты администрирования",
  "Automation, due dates, numbering, and defaults.":
    "Автоматизация, сроки оплаты, нумерация и настройки по умолчанию.",
  "Utility rates and billing calculation rules.":
    "Тарифы на коммунальные услуги и правила расчета счетов.",
  "Invoice appearance and document settings.":
    "Внешний вид счета и настройки документа.",
  "Import, export, and bulk updates.": "Импорт, экспорт и массовые обновления.",
  "Track important changes in your organization.":
    "Отслеживайте важные изменения в вашей организации.",

  // Added: translation coverage pass 4 (manual billing rule input drawer)
  Value: "Значение",
  "Enter the quantity for this period.": "Введите количество за этот период.",
  "Enter the amount to charge for this period.":
    "Введите сумму к начислению за этот период.",

  // Added: translation coverage pass 5 (invoice template editor)
  "Template structure": "Структура шаблона",
  "Add, remove and configure sections. Drag to reorder.":
    "Добавляйте, удаляйте и настраивайте разделы. Перетаскивайте, чтобы изменить порядок.",
  "Live preview": "Предпросмотр в реальном времени",
  "This preview reflects your current template configuration.":
    "Этот предпросмотр отражает текущую конфигурацию вашего шаблона.",
  "Section title": "Название раздела",
  "Line items": "Позиции",
  "Zoom level": "Уровень масштабирования",
  "Expand section": "Развернуть раздел",
  "Collapse section": "Свернуть раздел",
  "More options": "Другие параметры",
  "Preview period": "Период предпросмотра",
  "No billing periods yet — showing tariffs effective today.":
    "Расчётных периодов пока нет — показаны тарифы, действующие сегодня.",
  "Charge quantities shown here are illustrative (always 1) and do not reflect any real resident's bill.":
    "Указанные здесь количества являются иллюстративными (всегда 1) и не отражают счёт какого-либо конкретного жителя.",
  "Latvian is the canonical invoice language. English and Russian are optional translations; a missing translation falls back to Latvian.":
    "Латышский язык является каноническим языком счёта. Английский и русский — необязательные переводы; при отсутствии перевода используется латышский текст.",
  "Editing language": "Язык редактирования",
  "Latvian is the canonical invoice document. English and Russian are optional translated copies of the same invoice — not separate invoices.":
    "Латышский язык — канонический документ счёта. Английский и русский — необязательные переведённые копии того же счёта, а не отдельные счета.",
  "Document language": "Язык документа",
  "Control what appears on generated invoices, in what order, and how each section looks.":
    "Управляйте тем, что отображается в сформированных счетах, в каком порядке и как выглядит каждый раздел.",
  "Add text block": "Добавить текстовый блок",
  "Reset layout": "Сбросить макет",
  "Invoice sections": "Разделы счета",
  "Invoice preview": "Предпросмотр счета",
  "Sample resident": "Образец жильца",
  "Sample Street 1, Riga, LV-1010": "Образцовая улица 1, Рига, LV-1010",
  "Maintenance fee": "Плата за обслуживание",
  "Invoice details": "Данные счета",
  "Sender and recipient": "Отправитель и получатель",
  "Charges table": "Таблица начислений",
  "Payment details": "Платежные реквизиты",
  "Default note": "Примечание по умолчанию",
  Footer: "Нижний колонтитул",
  "Custom text": "Произвольный текст",
  Show: "Показать",
  Bold: "Жирный",
  Spacing: "Отступ",
  Align: "Выравнивание",
  "Move up": "Переместить вверх",
  "Move down": "Переместить вниз",
  Duplicate: "Дублировать",
  Delete: "Удалить",
  "Reset the invoice layout to the default template? Custom text blocks, section titles, and any per-row formatting will be removed. Your header, footer, payment instructions, and note text are kept.":
    "Сбросить макет счета к шаблону по умолчанию? Пользовательские текстовые блоки, названия разделов и любое форматирование строк будут удалены. Текст верхнего колонтитула, нижнего колонтитула, платежных инструкций и примечания будет сохранен.",
  "This invoice layout has reached the maximum of 30 sections.":
    "В этом макете счета достигнут максимум в 30 разделов.",
  "Enter a valid unit price, for example 0.35 or 12.50. Use up to 4 decimal places.":
    "Введите корректную цену за единицу, например 0,35 или 12,50. Используйте не более 4 знаков после запятой.",
  "Enter a valid VAT percentage, for example 21 or 21.5.":
    "Введите корректный процент НДС, например 21 или 21,5.",
  "Enter a valid amount, for example 12.50 or -5.00. Use up to 2 decimal places.":
    "Введите корректную сумму, например 12,50 или -5,00. Используйте не более 2 знаков после запятой.",
  "Enter a valid amount, for example 12.50. Use up to 2 decimal places.":
    "Введите корректную сумму, например 12,50. Используйте не более 2 знаков после запятой.",
  "Enter a valid daily rate, for example 0.05.":
    "Введите корректную дневную ставку, например 0,05.",
  "Enter a valid percentage, for example 10 or 10.5.":
    "Введите корректный процент, например 10 или 10,5.",
  "Enter a valid meter reading, for example 123.456. Use up to 3 decimal places.":
    "Введите корректное показание счётчика, например 123,456. Используйте не более 3 знаков после запятой.",
  "Enter a valid value, for example 12.3456. Use up to 4 decimal places.":
    "Введите корректное значение, например 12,3456. Используйте не более 4 знаков после запятой.",
};

export function translate(locale: Locale, text: string): string {
  if (locale === "lv") return lv[text] ?? text;
  if (locale === "ru") return ru[text] ?? text;
  return text;
}

// Shared by every page rendering an Astro Action's error: never shows raw
// Zod/ActionInputError JSON. When the action failed Zod input validation
// (`error.fields` present), shows the first field's plain-language message,
// translated -- every such message in this codebase is itself an English
// sentence used as the i18n dictionary key (see e.g. src/actions/billing.ts's
// UNIT_PRICE_MESSAGE), so this always resolves to a real, localized string.
// A path-less Zod issue (rare, but possible from an object-level .refine())
// leaves `.fields` present but with no usable message -- that falls back to
// a generic translated message, never to `.message` (which for an input
// error IS the raw "Failed to validate: [...]" blob). Only a genuine
// non-input error (domain ConflictError/NotFoundError/etc., already a safe
// human sentence -- see src/actions/_errors.ts) uses its own `.message`.
export function friendlyActionErrorMessage(
  error:
    { message: string; fields?: Record<string, string[]> } | null | undefined,
  locale: Locale
): string | undefined {
  if (!error) return undefined;
  if (error.fields) {
    const fieldMessage = Object.values(error.fields)[0]?.[0];
    return translate(
      locale,
      fieldMessage ?? "Something went wrong. Please try again."
    );
  }
  return translate(locale, error.message);
}

export function formatNumber(
  value: string | number,
  locale: Locale,
  maximumFractionDigits = 3
): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(
    Number(value)
  );
}

export function formatMoney(
  value: string,
  currency: string,
  locale: Locale
): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    Number(value)
  );
}

export function formatDate(
  value: string | Date | null,
  locale: Locale,
  timeZone = "UTC"
): string {
  if (!value) return "—";
  const dateOnly =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: dateOnly ? "UTC" : timeZone,
  }).format(new Date(value));
}

export function formatDateTime(
  value: string | Date | null,
  locale: Locale,
  timeZone = "UTC"
): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

export function formatPeriod(
  year: number,
  month: number,
  locale: Locale
): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

const names: Record<string, string> = {
  COLD_WATER: "Cold water",
  HOT_WATER: "Hot water",
  ELECTRICITY: "Electricity",
  GAS: "Gas",
  HEAT: "Heat",
  OTHER: "Other",
  APARTMENT: "Apartment",
  COMMERCIAL_UNIT: "Commercial unit",
  PARKING: "Parking",
  STORAGE: "Storage",
  ADMIN: "Administrator",
  RESIDENT: "Resident",
  IMPORT: "Import",
};
export function entityLabel(value: string, locale: Locale): string {
  return translate(locale, names[value] ?? value);
}
