import type { AstroCookies } from "astro";

export type Locale = "en" | "lv" | "ru";

// A presentation preference only; never changes organization or invoice data.
// First supported language in an Accept-Language header, by quality then
// order. Used once per browser (middleware sets the cookie), so a Latvian or
// Russian browser lands on its own language. Anything else gets English.
export function localeFromAcceptLanguage(header: string | null): Locale {
  if (!header) return "en";
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      const quality = q ? Number(q.trim().slice(2)) : 1;
      return {
        language: tag.trim().toLowerCase().split("-")[0],
        quality: Number.isFinite(quality) ? quality : 0,
        index,
      };
    })
    .filter((entry) => entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { language } of ranked) {
    if (language === "lv" || language === "ru" || language === "en") {
      return language;
    }
  }
  return "en";
}

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
  "Current charges": "Kārtējā perioda maksa",
  "Previous outstanding": "Iepriekšējais parāds",
  "Previous balance": "Iepriekšējais atlikums",
  "Credit applied": "Piemērotais kredīts",
  "Account credit": "Konta kredīts",
  "Amount due": "Apmaksai",
  "Late fee": "Nokavējuma maksa",
  "Manual adjustment": "Manuāla korekcija",
  "Current bill": "Pašreizējais rēķins",
  "Account balance": "Konta atlikums",
  "Account activity": "Konta operācijas",
  "Add adjustment": "Pievienot korekciju",
  "Adjustments create an auditable account entry and never edit the balance directly.":
    "Katra korekcija rada auditējamu konta ierakstu un nekad nemaina atlikumu tieši.",
  "Charge adjustment": "Maksas korekcija",
  "Credit adjustment": "Kredīta korekcija",
  Debit: "Debets",
  Credit: "Kredīts",
  Balance: "Atlikums",
  "Preparation checks": "Sagatavošanas pārbaudes",
  "Recipient details complete": "Norādīti visi saņēmēja dati",
  "Issuer and payment details complete":
    "Norādīti visi izrakstītāja un maksājuma dati",
  "Current charges calculated": "Kārtējā perioda maksa aprēķināta",
  "Account balance resolved": "Konta atlikums noteikts",
  "Late-payment rules": "Nokavēto maksājumu noteikumi",
  "Changes apply to future calculations. Sent invoices keep their original financial snapshot.":
    "Izmaiņas attiecas tikai uz nākamajiem aprēķiniem. Nosūtītie rēķini paliek tādi, kādi bija nosūtīšanas brīdī.",
  "Late fees enabled": "Nokavējuma maksa ir ieslēgta",
  "Daily rate": "Dienas likme",
  "Grace period": "Labvēlības periods",
  "days after the due date": "dienas pēc apmaksas termiņa",
  "Maximum total penalty": "Maksimālā kopējā soda maksa",
  "of eligible principal": "no piemērojamās pamatsummas",
  "Stop accrual at cap": "Pārtraukt uzkrāšanu, sasniedzot limitu",
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
    "Norēķinu periodu vēsture un darbības ar periodiem.",
  "Admin dashboard with billing totals and work requiring attention.":
    "Administratora pārskats ar norēķinu kopsummām un darbiem, kam jāpievērš uzmanība.",
  "Payment reconciliation workspace with transaction states.":
    "Maksājumu saskaņošanas darbvieta ar darījumu statusiem.",
  "Required input is missing; generation is blocked.":
    "Trūkst obligāto datu; rēķina izveide ir bloķēta.",
  "The invoice can still be reviewed and regenerated.":
    "Rēķinu vēl var pārskatīt un izveidot atkārtoti.",
  "The invoice is approved and ready to send.":
    "Rēķins ir apstiprināts un gatavs nosūtīšanai.",
  "The invoice was delivered successfully.": "Rēķins ir veiksmīgi piegādāts.",
  "A full payment has been confirmed.":
    "Maksājums pilnā apmērā ir apstiprināts.",
  "The due date passed without a confirmed full payment.":
    "Apmaksas termiņš ir beidzies, bet maksājums pilnā apmērā nav apstiprināts.",
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
    "Pievienojiet juridisko nosaukumu, adresi, kontaktinformāciju, bankas nosaukumu un IBAN, kas tiks izmantoti rēķinos.",
  "Ready when invoice issuer and payment details are complete.":
    "Gatavs, kad aizpildīti rēķina izrakstītāja un maksājuma dati.",
  "Add dwellings": "Pievienojiet īpašumus",
  "Create dwellings individually or import them from CSV. Check numbers, types, occupants, areas and resident counts.":
    "Izveidojiet īpašumus atsevišķi vai importējiet tos no CSV. Pārbaudiet numurus, veidus, iemītniekus, platības un iedzīvotāju skaitu.",
  "Ready when every billable unit appears in the dwelling directory.":
    "Gatavs, kad visi norēķinu objekti redzami īpašumu sarakstā.",
  "Assign residents and meters": "Piesaistiet iedzīvotājus un skaitītājus",
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
    "Gatavs, kad jaunais periods ar statusu ATVĒRTS redzams periodu vēsturē.",
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
    "Gatavs, kad paredzētie rēķini ir statusā NOSŪTĪTS vai redzama skaidra piegādes kļūda, kas jānovērš.",
  "Reconcile incoming payments": "Saskaņojiet saņemtos maksājumus",
  "Import a bank statement, inspect the preview, confirm the import and review proposed or unmatched transactions.":
    "Importējiet bankas izrakstu, pārskatiet priekšskatījumu, apstipriniet importu un pārbaudiet ierosinātos vai nesaskaņotos darījumus.",
  "Ready when valid matches are confirmed and the corresponding invoices show PAID.":
    "Gatavs, kad pareizās atbilstības ir apstiprinātas un attiecīgie rēķini ir APMAKSĀTI.",
  "Handle questions and exceptions": "Apstrādājiet jautājumus un izņēmumus",
  "Review resident messages, overdue invoices, unmatched payments and delivery failures. Resolve conversations when the issue is closed.":
    "Pārskatiet iedzīvotāju ziņojumus, kavētos rēķinus, nesaskaņotos maksājumus un piegādes kļūdas. Slēdziet sarunas, kad jautājums ir atrisināts.",
  "Ready when attention items have an owner or are resolved.":
    "Gatavs, kad katram uzmanību prasošam jautājumam ir noteikts atbildīgais vai tas ir atrisināts.",
  "What do the invoice statuses mean?": "Ko nozīmē rēķinu statusi?",
  "MISSING DATA means a required input is absent. DRAFT can still be regenerated. PREPARED is approved for sending. SENT was delivered successfully. OVERDUE is sent and unpaid after its due date. PAID has a confirmed full payment.":
    "TRŪKST DATU nozīmē, ka trūkst kādas nepieciešamas informācijas. MELNRAKSTU vēl var pārrēķināt. SAGATAVOTS ir apstiprināts nosūtīšanai. NOSŪTĪTS ir veiksmīgi piegādāts. KAVĒTS ir nosūtīts un nav apmaksāts pēc termiņa. APMAKSĀTS nozīmē, ka ir apstiprināta pilna apmaksa.",
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
    "Pārskatiet summu, valūtu, maksātāju un maksājuma mērķi. Atstājiet maksājumu nesaskaņotu, līdz var noteikt pareizo rēķinu; neapstipriniet nepārliecinošu atbilstību.",
  "When should I lock a period?": "Kad slēgt periodu?",
  "Lock a period after normal reading and invoice input work is complete. Locked periods remain available for history but block normal reading edits and invoice regeneration.":
    "Slēdziet periodu pēc rādījumu un rēķinu ievades darbu pabeigšanas. Slēgtie periodi paliek pieejami vēsturē, bet neļauj ierastajā kārtībā rediģēt rādījumus un pārrēķināt rēķinus.",
  "Auto-send day of month (1-28)":
    "Automātiskās nosūtīšanas mēneša diena (1–28)",
  "Automatically generate invoices each period":
    "Automātiski izveidot rēķinus katrā periodā",
  "Reuse the previous reading after the deadline":
    "Izmantot iepriekšējo rādījumu pēc termiņa",
  "When no meter reading arrives by the reading deadline, the previous reading is used and the consumption is zero. The next real reading bills the difference.":
    "Ja līdz rādījumu iesniegšanas termiņam skaitītāja rādījums netiek saņemts, tiek izmantots iepriekšējais rādījums un patēriņš ir nulle. Starpība tiek aprēķināta pēc nākamā faktiskā rādījuma.",
  "Automatically send prepared invoices":
    "Automātiski nosūtīt sagatavotos rēķinus",
  "Only applies when auto-send is enabled above.":
    "Tiek piemērots tikai tad, ja augstāk ir ieslēgta automātiskā nosūtīšana.",
  "Area (m2)": "Platība (m²)",
  Fixed: "Fiksēts",
  "Manual amount": "Manuāla summa",
  "Manual quantity": "Manuāls daudzums",
  "Meter consumption": "Skaitītāja patēriņš",
  "Meter type (only for meter consumption rules)":
    "Skaitītāja veids (tikai skaitītāja patēriņa noteikumiem)",
  "Code (unique identifier, e.g. cold_water)":
    "Kods (unikāls identifikators, piem., cold_water)",
  "Unit (e.g. m3, month, person)": "Mērvienība (piem., m3, mēnesis, persona)",
  "Effective until (optional)": "Spēkā līdz (neobligāti)",
  Mode: "Režīms",
  "Create only (default) -- existing numbers become errors":
    "Tikai izveidot (noklusējums) — esošie numuri rada kļūdas",
  "Update -- existing numbers are updated":
    "Atjaunināt — esošie numuri tiek atjaunināti",
  "Back to dwellings": "Atpakaļ uz īpašumiem",
  "Back to payments": "Atpakaļ uz maksājumiem",
  "Export dwellings (CSV)": "Eksportēt īpašumus (CSV)",
  "Export meter readings (CSV)": "Eksportēt skaitītāju rādījumus (CSV)",
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
  "Next →": "Tālāk →",
  "View conversations for this dwelling →": "Skatīt sarunas par šo īpašumu →",
  "Resident access is assigned per dwelling, from each dwelling's detail page.":
    "Iedzīvotāju piekļuve tiek piešķirta katra īpašuma detalizētajā skatā.",
  "You don't belong to any organization yet. Create one below.":
    "Jūs vēl neesat nevienā organizācijā. Izveidojiet to zemāk.",
  "You don't have access to any dwellings.":
    "Jums nav piekļuves nevienam īpašumam.",
  "No active meters for this dwelling.": "Šim īpašumam nav aktīvu skaitītāju.",
  "No archived meters for this dwelling.":
    "Šim īpašumam nav arhivētu skaitītāju.",
  "Filter meters": "Filtrēt skaitītājus",
  "No consumption history yet.": "Vēl nav patēriņa vēstures.",
  "Invoice email is missing. Add a billing email before sending.":
    "Nav norādīta rēķinu e-pasta adrese. Pievienojiet to pirms nosūtīšanas.",
  "Correct the details and regenerate the draft before preparing it again.":
    "Labojiet datus un no jauna ģenerējiet melnrakstu pirms atkārtotas sagatavošanas.",
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
  "Default due days": "Noklusējuma apmaksas termiņš dienās",
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
  Administration: "Administrēšana",
  "Resident portal": "Iedzīvotāja portāls",
  Portal: "Portāls",
  "Sign out": "Izrakstīties",
  "Switch organization": "Mainīt organizāciju",
  "Switch to resident view": "Pārslēgties uz iedzīvotāja skatu",
  "Switch to admin view": "Pārslēgties uz administratora skatu",
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
  Outstanding: "Neapmaksātā summa",
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
  "Ready to invoice": "Gatavs rēķina izrakstīšanai",
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
  "Invoice issue date": "Rēķina izrakstīšanas datums",
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
  "Clear selection": "Noņemt atlasi",
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
    "Periods ir slēgts. Nevar mainīt rādījumus un izveidot rēķinus.",
  "Select draft invoices to prepare, or prepared invoices to send.":
    "Izvēlieties melnrakstus sagatavošanai vai sagatavotos rēķinus nosūtīšanai.",
  "Select invoice": "Izvēlēties rēķinu",
  "Select all eligible invoices": "Izvēlēties visus atbilstošos rēķinus",
  "Generate all eligible": "Izveidot visus atbilstošos",
  "Prepare selected": "Sagatavot izvēlētos",
  "Send selected": "Nosūtīt izvēlētos",
  "Lock period": "Slēgt periodu",
  "Reopen period": "Atvērt periodu",
  "To bill a dwelling for this period after the fact, reopen the period.":
    "Lai izrakstītu rēķinu īpašumam par šo periodu ar atpakaļejošu datumu, atveriet periodu.",
  "Dwellings not in this period": "Šajā periodā neiekļautie īpašumi",
  "These dwellings have no billing case in this period, so they get no invoice for it. Add a dwelling to bill it for this period. The invoice uses the issue and due dates of this period.":
    "Šiem īpašumiem šajā periodā nav norēķinu ieraksta, tāpēc tiem netiek izrakstīts rēķins. Pievienojiet īpašumu, lai izrakstītu tam rēķinu par šo periodu. Rēķinā tiek izmantoti šī perioda izrakstīšanas datums un apmaksas termiņš.",
  "Add to period": "Pievienot periodam",
  "An archived dwelling cannot be added to a billing period":
    "Arhivētu īpašumu nevar pievienot norēķinu periodam",
  "This dwelling already has a billing case in this period":
    "Šim īpašumam šajā periodā jau ir norēķinu ieraksts",
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
    "Pārvaldiet īpašuma datus, iemītniekus un iedzīvotāju piekļuvi.",
  "New dwellings are included in every currently open billing period. Archive historically billed dwellings to preserve their invoices.":
    "Jauni īpašumi tiks iekļauti visos pašlaik atvērtajos norēķinu periodos. Arhivējiet īpašumus, par kuriem iepriekš izrakstīti rēķini, lai saglabātu to rēķinus.",
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
  "No imports yet.": "Vēl nekas nav importēts.",
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
    "Rādījumu iesniegšanas termiņš ir beidzies. Sazinieties ar administratoru.",
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
    "Sarunas ar iedzīvotājiem un jautājumi par norēķiniem.",
  "Configure your organization, billing and access.":
    "Pārvaldiet organizāciju, norēķinus un piekļuvi.",
  Organization: "Organizācija",
  Billing: "Norēķini",
  "Tariffs & rules": "Tarifi un noteikumi",
  "Tariffs in this period": "Tarifi šajā periodā",
  "Applying:": "Piemēroti:",
  "A tariff applies when its effective dates overlap the period. To bill an earlier period, give the tariff an earlier Effective from date.":
    "Tarifs tiek piemērots, ja tā spēkā esamības datumi pārklājas ar periodu. Lai izrakstītu rēķinu par agrāku periodu, norādiet tarifam agrāku datumu “Spēkā no”.",
  "Edit tariffs": "Rediģēt tarifus",
  "No tariffs exist yet.": "Vēl nav tarifu.",
  "Does not apply: the tariff is archived.":
    "Netiek piemērots: tarifs ir arhivēts.",
  "Does not apply: the tariff is disabled.":
    "Netiek piemērots: tarifs ir izslēgts.",
  "Does not apply: it starts after this period ends.":
    "Netiek piemērots: tas sākas pēc šī perioda beigām.",
  "Does not apply: it ended before this period starts.":
    "Netiek piemērots: tas beidzās pirms šī perioda sākuma.",
  "Applies to all dwellings.": "Attiecas uz visiem īpašumiem.",
  "Applies to no dwelling: none is assigned.":
    "Neattiecas ne uz vienu īpašumu: neviens nav piešķirts.",
  "Applies only to the assigned dwellings:":
    "Attiecas tikai uz piešķirtajiem īpašumiem:",
  "Invoice template": "Rēķina veidne",
  "Users & access": "Lietotāji un piekļuve",
  Data: "Dati",
  "Legal, bank, and contact details.":
    "Juridiskā, bankas un kontaktinformācija.",
  "Admin membership and resident access.":
    "Administratoru un iedzīvotāju piekļuve.",
  "Automation and due-date defaults.":
    "Automatizācija un noklusējuma apmaksas termiņi.",
  "Billing calculation rules.": "Rēķinu aprēķina noteikumi.",
  "Invoice appearance.": "Rēķina izskats.",
  "Import and export.": "Imports un eksports.",
  "Audit history": "Audita vēsture",
  "Review recorded organization activity.":
    "Pārskatiet organizācijā reģistrētās darbības.",
  Save: "Saglabāt",
  "Billing name": "Rēķina saņēmējs",
  Email: "E-pasts",
  "Working…": "Notiek apstrāde…",
  "Saved successfully.": "Veiksmīgi saglabāts.",
  "Use a decimal point and up to three decimal places.":
    "Izmantojiet punktu un ne vairāk kā trīs zīmes aiz tā.",
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
    "Pēc arhivēšanas īpašums vairs netiks iekļauts jaunos periodos un aktīvo īpašumu sarakstos. Iepriekšējie rēķini un rādījumi paliek neskarti.",
  Area: "Platība",
  "Basic information": "Pamatinformācija",
  "Billing details": "Norēķinu dati",
  Building: "Ēka",
  "Calculated consumption": "Aprēķinātais patēriņš",
  "No reading arrived by the deadline, so the previous reading was reused. Enter the real value to replace it.":
    "Līdz rādījumu iesniegšanas termiņam rādījums netika saņemts, tāpēc tika izmantots iepriekšējais rādījums. Ievadiet faktisko vērtību, lai to aizstātu.",
  "Previous reading reused": "Izmantots iepriekšējais rādījums",
  "Changes recorded against this dwelling.":
    "Šim īpašumam reģistrētās izmaiņas.",
  "Changes saved": "Izmaiņas saglabātas",
  Close: "Aizvērt",
  "Complete the details below to resolve invoice preparation blockers.":
    "Norādiet zemāk minētos datus, lai novērstu rēķina sagatavošanas šķēršļus.",
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
  "Latest messages with this dwelling.": "Jaunākās ziņas par šo īpašumu.",
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
  "Open full dwelling": "Atvērt īpašumu pilnībā",
  "Outstanding balance": "Parāda atlikums",
  Paper: "Papīrs",
  "Paper delivery": "Piegāde papīra formātā",
  "People who can access their invoices and messages.":
    "Cilvēki, kuri var piekļūt saviem rēķiniem un ziņām.",
  "Previous reading": "Iepriekšējais rādījums",
  "Reading saved": "Rādījums saglabāts",
  Reason: "Iemesls",
  "Recent messages": "Jaunākās ziņas",
  "Save changes": "Saglabāt izmaiņas",
  "Save readings": "Saglabāt rādījumus",
  "Saving…": "Saglabā…",
  "Waiting for server…": "Gaida servera atbildi…",
  "Checking save status…": "Pārbauda saglabāšanas statusu…",
  "Outcome not confirmed": "Rezultāts nav apstiprināts",
  "Check again": "Pārbaudīt vēlreiz",
  "The original change was saved, but the item is no longer present. The page has been refreshed.":
    "Sākotnējā izmaiņa tika saglabāta, bet vienums vairs nav pieejams. Lapa ir atjaunināta.",
  "Applying changes…": "Piemēro izmaiņas…",
  Saved: "Saglabāts",
  Dismiss: "Aizvērt",
  "Sign in": "Pieteikties",
  Password: "Parole",
  "Resident sign in": "Iedzīvotāja pieteikšanās",
  "Admin sign in": "Administratora pieteikšanās",
  "Send sign-in link": "Nosūtīt pieteikšanās saiti",
  "Incorrect email or password.": "Nepareizs e-pasts vai parole.",
  "We couldn't find an account for that sign-in. If you believe this is a mistake, contact your administrator.":
    "Konts ar šādiem pieteikšanās datiem netika atrasts. Ja uzskatāt, ka tā ir kļūda, sazinieties ar savu administratoru.",
  "Too many sign-in attempts. Please wait a minute and try again.":
    "Pārāk daudz pieteikšanās mēģinājumu. Uzgaidiet minūti un mēģiniet vēlreiz.",
  "Enter your email and we'll send you a secure sign-in link.":
    "Ievadiet savu e-pastu, un mēs nosūtīsim drošu pieteikšanās saiti.",
  "If that email is registered, a sign-in link is on its way.":
    "Ja šis e-pasts ir reģistrēts, pieteikšanās saite jau ir ceļā.",
  "This sign-in link is invalid or has expired. Request a new one below.":
    "Šī pieteikšanās saite nav derīga vai tās derīguma termiņš ir beidzies. Pieprasiet jaunu zemāk.",
  "Page not found": "Lapa nav atrasta",
  "The page you are looking for does not exist or has moved.":
    "Meklētā lapa neeksistē vai ir pārvietota.",
  "Go to sign in": "Uz pieteikšanos",
  "Sign in as a resident with an email link, or as an administrator with a password.":
    "Piesakieties kā iedzīvotājs ar e-pasta saiti vai kā administrators ar paroli.",
  "Access denied": "Piekļuve liegta",
  "This area requires additional verification. Please complete sign-in with your second factor.":
    "Šai sadaļai nepieciešama papildu verifikācija. Lūdzu, pabeidziet pieteikšanos ar otro faktoru.",
  "You do not have access to this resource.":
    "Jums nav piekļuves šim resursam.",
  "Back to sign in": "Atpakaļ uz pieteikšanos",
  "Confirm sign-in": "Apstiprināt pieteikšanos",
  "Click below to finish signing in.":
    "Noklikšķiniet zemāk, lai pabeigtu pieteikšanos.",
  "Registration number": "Reģistrācijas numurs",
  "VAT number": "PVN reģistrācijas numurs",
  "View confirmed payments": "Skatīt apstiprinātos maksājumus",
  "Confirm this payment? The invoice balance will be updated.":
    "Vai apstiprināt šo maksājumu? Rēķina atlikums tiks atjaunināts.",
  "The period start date must not be after its end date.":
    "Perioda sākuma datums nedrīkst būt vēlāks par beigu datumu.",
  "The due date must not be before the invoice issue date.":
    "Apmaksas termiņš nedrīkst būt agrāks par rēķina izrakstīšanas datumu.",
  "The reading deadline must not be after the invoice issue date.":
    "Rādījumu iesniegšanas termiņš nedrīkst būt vēlāks par rēķina izrakstīšanas datumu.",
  "Forgot password": "Paroles atjaunošana",
  "Forgot password?": "Aizmirsāt paroli?",
  "Enter your admin email and we'll send you a link to choose a new password.":
    "Ievadiet administratora e-pastu, un mēs nosūtīsim saiti jaunas paroles iestatīšanai.",
  "If that email belongs to an admin account, a reset link is on its way.":
    "Ja šī e-pasta adrese ir saistīta ar administratora kontu, paroles atjaunošanas saite ir nosūtīta.",
  "This reset link is invalid or has expired. Request a new one.":
    "Šī paroles atjaunošanas saite nav derīga vai tās derīguma termiņš ir beidzies. Pieprasiet jaunu.",
  "Send reset link": "Nosūtīt atjaunošanas saiti",
  "The password must be at least 8 characters.":
    "Parolei jābūt vismaz 8 rakstzīmes garai.",
  "The password is too long.": "Parole ir pārāk gara.",
  "The two passwords do not match.": "Abas paroles nesakrīt.",
  "Your new password can't be the same as your old one.":
    "Jaunā parole nedrīkst sakrist ar veco.",
  "This password is too weak. Choose a longer or less predictable one.":
    "Šī parole ir pārāk vienkārša. Izvēlieties garāku vai mazāk paredzamu paroli.",
  "Too many attempts. Wait a few minutes and try again.":
    "Pārāk daudz mēģinājumu. Uzgaidiet dažas minūtes un mēģiniet vēlreiz.",
  "Something went wrong changing your password. Try again.":
    "Neizdevās nomainīt paroli. Mēģiniet vēlreiz.",
  "Choose a new password": "Iestatiet jaunu paroli",
  "Use at least 8 characters.": "Izmantojiet vismaz 8 rakstzīmes.",
  "New password": "Jaunā parole",
  "Repeat new password": "Atkārtojiet jauno paroli",
  "Change password": "Nomainīt paroli",
  "Password updated. Sign in with your new password.":
    "Parole ir atjaunota. Piesakieties ar savu jauno paroli.",
  "Reset your password": "Atjaunojiet savu paroli",
  "Click below to choose a new password.":
    "Noklikšķiniet zemāk, lai iestatītu jaunu paroli.",
  Continue: "Turpināt",
  "Adjust this draft": "Pielāgot šo melnrakstu",
  "You can change these amounts until you prepare the invoice.":
    "Šīs summas var mainīt, līdz rēķins ir sagatavots.",
  "Calculated late fee": "Aprēķinātā nokavējuma maksa",
  "Applied late fee": "Piemērotā nokavējuma maksa",
  "New late fee amount": "Jaunā nokavējuma maksas summa",
  "Update late fee": "Atjaunināt nokavējuma maksu",
  "Bank processing delay": "Bankas maksājuma apstrādes aizkavēšanās",
  "Billing dispute": "Strīds par rēķinu",
  "Meter issue": "Problēma ar skaitītāju",
  "Agreement with resident": "Vienošanās ar iedzīvotāju",
  "Administrative waiver": "Administratīvs atbrīvojums",
  "Note (required when the reason is Other)":
    "Piezīme (obligāta, ja iemesls ir “Cits”)",
  "Adjustment amount": "Korekcijas summa",
  "A negative amount lowers the amount due.":
    "Negatīva summa samazina apmaksājamo summu.",
  "Save adjustment": "Saglabāt korekciju",
  "Late fee updated.": "Nokavējuma maksa atjaunināta.",
  "Adjustment saved.": "Korekcija saglabāta.",
  "Override status": "Aizstāt statusu",
  "Use this only to correct a status that is wrong. The change is recorded with your reason.":
    "Izmantojiet šo tikai, lai labotu nepareizu statusu. Izmaiņa tiek reģistrēta ar jūsu norādīto iemeslu.",
  "Change the status of this invoice? This change is recorded in the audit log.":
    "Vai mainīt šī rēķina statusu? Šī izmaiņa tiek reģistrēta audita žurnālā.",
  "New status": "Jaunais statuss",
  "Choose a status": "Izvēlieties statusu",
  "Status changed.": "Statuss mainīts.",
  "Installed on": "Uzstādīšanas datums",
  "Invoice total due": "Rēķina kopsumma apmaksai",
  "Paid so far": "Apmaksāts līdz šim",
  "Amount still due": "Atlikusī summa apmaksai",
  "All entity types": "Visi objektu veidi",
  "All actors": "Visi lietotāji",
  "From date": "Datums no",
  "To date": "Datums līdz",
  Enable: "Iespējot",
  Disable: "Atspējot",
  "Account disabled": "Konts atspējots",
  "Disable this account? The person cannot sign in until you enable it again.":
    "Vai atspējot šo kontu? Persona nevarēs pieteikties, kamēr to atkal neiespējosiet.",
  "Invoice, reference or payer": "Rēķins, maksājuma mērķis vai maksātājs",
  "No payments match these filters.": "Filtriem neatbilst neviens maksājums.",
  of: "no",
  "How do I waive a late fee or adjust a draft invoice?":
    "Kā atcelt nokavējuma maksu vai pielāgot rēķina melnrakstu?",
  "Open the DRAFT invoice. Use the Adjust this draft panel. Enter a reason for each change. You cannot adjust an invoice after you prepare it.":
    "Atveriet rēķinu ar statusu “Melnraksts”. Izmantojiet paneli “Pielāgot šo melnrakstu”. Katrai izmaiņai norādiet iemeslu. Pēc rēķina sagatavošanas to vairs nevar pielāgot.",
  "How do I fix a wrong invoice status?": "Kā labot nepareizu rēķina statusu?",
  "Open the invoice. Use the Override status panel. Choose the correct status and enter a reason. The system records the change in the audit log. The list always offers DRAFT, PREPARED, and OVERDUE. It offers SENT only if the invoice was sent, and PAID only if the invoice is paid.":
    "Atveriet rēķinu. Izmantojiet paneli “Aizstāt statusu”. Izvēlieties pareizo statusu un ievadiet iemeslu. Sistēma reģistrē izmaiņas audita žurnālā. Sarakstā vienmēr tiek piedāvāti “Melnraksts”, “Sagatavots” un “Kavēts”. “Nosūtīts” tiek piedāvāts tikai tad, ja rēķins tika nosūtīts, un “Apmaksāts” — tikai tad, ja rēķins ir apmaksāts.",
  "How do I disable a resident's access?": "Kā atspējot iedzīvotāja piekļuvi?",
  "Open the dwelling. Click Disable next to the resident. The resident cannot access the system until you click Enable. You cannot disable an administrator or a resident who has access to another organization.":
    "Atveriet īpašumu. Nospiediet “Atspējot” blakus iedzīvotājam. Iedzīvotājs nevarēs piekļūt sistēmai, līdz nospiedīsiet “Iespējot”. Administratoru vai iedzīvotāju, kuram ir piekļuve citai organizācijai, atspējot nevar.",
  "What does a resident see on an invoice?": "Ko iedzīvotājs redz rēķinā?",
  "The resident sees the invoice, the amount that they paid, and the amount that they still owe.":
    "Iedzīvotājs redz rēķinu, samaksāto summu un summu, kas vēl jāmaksā.",
  "How do I identify who changed something?": "Kā noskaidrot, kas ko mainījis?",
  "Open the audit log. Filter by action, entity type, actor, or date. Click Export CSV to download the rows that match. The file holds up to 5,000 rows.":
    "Atveriet audita žurnālu. Filtrējiet pēc darbības, objekta veida, lietotāja vai datuma. Nospiediet “Eksportēt CSV”, lai lejupielādētu atbilstošās rindas. Failā ir ne vairāk kā 5000 rindu.",
  Reversed: "Atcelts",
  Reverse: "Atcelt",
  "Reason for reversal": "Atcelšanas iemesls",
  "Reverse payment": "Atcelt maksājumu",
  "Reverse this payment? The original payment stays in the history and a cancelling entry is added. The invoice becomes unpaid again.":
    "Vai atcelt šo maksājumu? Sākotnējais maksājums paliek vēsturē, un tiek pievienots atcelšanas ieraksts. Rēķins atkal kļūst neapmaksāts.",
  "Choose an invoice": "Izvēlieties rēķinu",
  "Match to invoice": "Piesaistīt rēķinam",
  "Match this payment to the chosen invoice? The payment is applied right away.":
    "Vai piesaistīt šo maksājumu izvēlētajam rēķinam? Maksājums tiks ieskaitīts uzreiz.",
  "Record a payment": "Reģistrēt maksājumu",
  "Record payment": "Reģistrēt maksājumu",
  "Use this for a bank transfer that is not in an imported statement. The payment is applied right away.":
    "Izmantojiet šo funkciju, lai reģistrētu bankas pārskaitījumu, kas nav iekļauts importētajā izrakstā. Maksājums tiks ieskaitīts uzreiz.",
  "Bank reference": "Bankas maksājuma mērķis",
  "Record this payment? It is applied to the invoice right away.":
    "Vai reģistrēt šo maksājumu? Tas tiks uzreiz ieskaitīts rēķina apmaksā.",
  "Payment reversed.": "Maksājums atcelts.",
  "Payment matched.": "Maksājums piesaistīts.",
  "Payment recorded.": "Maksājums reģistrēts.",
  "How do I record a payment that is not in a bank statement?":
    "Kā reģistrēt maksājumu, kura nav bankas izrakstā?",
  "Click Record a payment on the Payments page. Choose the invoice. Enter the amount, date, payer, bank reference, and a reason. The payment applies right away. The app blocks a second entry with the same reference, amount, and date. You can record bank transfers only.":
    "Maksājumu lapā nospiediet “Reģistrēt maksājumu”. Izvēlieties rēķinu. Ievadiet summu, datumu, maksātāju, bankas maksājuma mērķi un iemeslu. Maksājums tiek piemērots uzreiz. Lietotne bloķē atkārtotu ierakstu ar to pašu maksājuma mērķi, summu un datumu. Var reģistrēt tikai bankas pārskaitījumus.",
  "How do I undo a payment that I matched to the wrong invoice?":
    "Kā atcelt maksājumu, ko piesaistīju nepareizam rēķinam?",
  "Open the Confirmed tab on the Payments page. Click Reverse next to the payment and enter a reason. The original payment stays in the history. The invoice becomes unpaid again. The payment returns to the Unmatched tab. There you can match it to the correct invoice. You cannot reverse a payment if a later invoice already used its credit.":
    "Maksājumu lapā atveriet cilni “Apstiprināts”. Blakus maksājumam nospiediet “Atcelt” un ievadiet iemeslu. Sākotnējais maksājums paliek vēsturē. Rēķins atkal kļūst neapmaksāts. Maksājums atgriežas cilnē “Nesaskaņots”. Tur to var piesaistīt pareizajam rēķinam. Maksājumu nevar atcelt, ja vēlāks rēķins jau izmantojis tā kredītu.",
  "The CSV file is too large (up to 2 MB).":
    "CSV fails ir pārāk liels (līdz 2 MB).",
  "The CSV file has too many rows (up to 5,000).":
    "CSV failā ir pārāk daudz rindu (līdz 5 000).",
  "Too many requests. Try again in a minute.":
    "Pārāk daudz pieprasījumu. Mēģiniet vēlreiz pēc minūtes.",
  "An explanation is required when reason is Other":
    "Ja iemesls ir “Cits”, nepieciešams paskaidrojums",
  "Late fee cannot be negative": "Nokavējuma maksa nevar būt negatīva",
  "Invoice not found": "Rēķins nav atrasts",
  "A prepared or sent invoice cannot have its financial statement changed":
    "Sagatavotam vai nosūtītam rēķinam nevar mainīt finanšu pārskatu",
  "Applied late fee cannot exceed the calculated amount":
    "Piemērotā nokavējuma maksa nevar pārsniegt aprēķināto summu",
  "A reason is required": "Nepieciešams norādīt iemeslu",
  "Adjustment amount must be positive": "Korekcijas summai jābūt pozitīvai",
  "Charges and late fees cannot be negative":
    "Maksas un nokavējuma maksa nevar būt negatīvas",
  "Account entry was not created": "Konta ieraksts netika izveidots",
  "Dwelling not found": "Īpašums nav atrasts",
  "A late-fee policy already exists for this effective date":
    "Šim spēkā stāšanās datumam jau pastāv nokavējuma maksas politika",
  "Organization not found": "Organizācija nav atrasta",
  "Billing period not found": "Norēķinu periods nav atrasts",
  "This billing period is locked": "Šis norēķinu periods ir slēgts",
  "No billing case exists for this dwelling in this period":
    "Šim īpašumam šajā periodā nav norēķinu ieraksta",
  "This dwelling has missing data for this period and cannot be invoiced yet":
    "Šim īpašumam trūkst datu šajā periodā, un tam vēl nevar izrakstīt rēķinu",
  "No billing rules apply to this dwelling for this period":
    "Šim īpašumam šajā periodā nav piemērojams neviens norēķinu noteikums",
  "A billing rule assigned to this dwelling has no active meter for this period":
    "Šim īpašumam piesaistītajam norēķinu noteikumam šajā periodā nav aktīva skaitītāja",
  "No billing rule applies": "Nav piemērojams neviens norēķinu noteikums",
  "no active meter": "nav aktīva skaitītāja",
  "This invoice has already been sent and can no longer be regenerated; issue a correction document instead":
    "Šis rēķins jau ir nosūtīts, un to vairs nevar pārrēķināt; tā vietā izrakstiet korekcijas dokumentu",
  "This invoice has already moved past DRAFT and can no longer be regenerated":
    "Šis rēķins vairs nav statusā “Melnraksts”, un to vairs nevar pārrēķināt",
  "Only a DRAFT invoice can be prepared":
    "Sagatavot var tikai rēķinu statusā “Melnraksts”",
  "Issuer details are incomplete; update organization settings before preparing":
    "Izrakstītāja dati nav pilnīgi; pirms sagatavošanas atjauniniet organizācijas iestatījumus",
  "This dwelling is missing a billing/occupant name or a billing address":
    "Šim īpašumam trūkst saņēmēja/iemītnieka vārda vai norēķinu adreses",
  "Organization payment details are incomplete (both bank name and IBAN are required)":
    "Organizācijas maksājuma dati nav pilnīgi (nepieciešams gan bankas nosaukums, gan IBAN)",
  "A reason is required for a manual status override":
    "Manuālai statusa aizstāšanai nepieciešams norādīt iemeslu",
  "Billing case not found": "Norēķinu ieraksts nav atrasts",
  "A case can be set to Sent only when its invoice was sent":
    "Ieraksta statusu var iestatīt uz “Nosūtīts” tikai tad, ja tā rēķins ir nosūtīts",
  "A case can be set to Paid only when its invoice is paid":
    "Ieraksta statusu var iestatīt uz “Apmaksāts” tikai tad, ja tā rēķins ir apmaksāts",
  "A case that already has an invoice cannot go back to Missing data or Ready":
    "Ieraksts, kuram jau ir rēķins, nevar atgriezties statusā “Trūkst datu” vai “Gatavs”",
  "Invalid or expired invoice link":
    "Rēķina saite nav derīga vai tās derīguma termiņš ir beidzies",
  "A meter consumption rule requires a meter type":
    "Skaitītāja patēriņa noteikumam nepieciešams skaitītāja veids",
  "This rule requires a unit price (it would otherwise always bill 0)":
    "Šim noteikumam nepieciešama vienības cena (citādi tas vienmēr aprēķinātu 0)",
  "A rule that applies to all dwellings cannot also have specific dwelling assignments":
    "Noteikumam, kas attiecas uz visiem īpašumiem, nevar vienlaikus piešķirt konkrētus īpašumus",
  "A one-to-one rule must be assigned to exactly one dwelling":
    "Noteikumam “viens pret vienu” jābūt piesaistītam tieši vienam īpašumam",
  "A selected-dwellings rule must be assigned to at least one dwelling":
    "Izvēlēto īpašumu noteikumam jābūt piesaistītam vismaz vienam īpašumam",
  "One or more selected dwellings do not belong to this organization":
    "Viens vai vairāki izvēlētie īpašumi nepieder šai organizācijai",
  "Billing rule not found": "Norēķinu noteikums nav atrasts",
  "Invoice send attempt not found": "Rēķina nosūtīšanas mēģinājums nav atrasts",
  "This dwelling has no electronic delivery method enabled; use Record paper dispatch instead.":
    "Šim īpašumam nav ieslēgts neviens elektroniskās piegādes veids; tā vietā izmantojiet “Reģistrēt papīra nosūtīšanu”.",
  "Invoice email is missing. Add a billing email before resending.":
    "Trūkst rēķina e-pasta adreses. Pievienojiet to pirms atkārtotas nosūtīšanas.",
  "This invoice has not been sent by email yet; use Send instead.":
    "Šis rēķins vēl nav nosūtīts pa e-pastu; tā vietā izmantojiet “Nosūtīt”.",
  "A delivery attempt is currently in progress for this invoice; wait for it to finish before resending.":
    "Šim rēķinam pašlaik notiek piegādes mēģinājums; pagaidiet, līdz tas beidzas, pirms sūtāt atkārtoti.",
  "Paper delivery is not enabled for this dwelling":
    "Šim īpašumam nav iespējota papīra piegāde",
  "SEPA QR codes are EUR-only": "SEPA QR kodi ir paredzēti tikai EUR",
  "A BIC is required to generate a SEPA QR code":
    "Lai ģenerētu SEPA QR kodu, nepieciešams BIC",
  "Invalid BIC": "Nederīgs BIC",
  "Invalid IBAN": "Nederīgs IBAN",
  "Amount is out of the SEPA QR's representable range":
    "Summa ir ārpus SEPA QR koda pieļaujamā diapazona",
  "A beneficiary name is required": "Nepieciešams norādīt saņēmēja nosaukumu",
  "Beneficiary name exceeds the SEPA QR's 70-character limit":
    "Saņēmēja nosaukums pārsniedz SEPA QR koda 70 rakstzīmju ierobežojumu",
  "Remittance information exceeds the SEPA QR's 140-character limit":
    "Maksājuma informācija pārsniedz SEPA QR koda 140 rakstzīmju ierobežojumu",
  "SEPA QR payload exceeds the 331-byte limit":
    "SEPA QR koda dati pārsniedz 331 baita ierobežojumu",
  "Conversation not found": "Saruna nav atrasta",
  "This request key was already used":
    "Šī pieprasījuma atslēga jau tika izmantota",
  "Select at least one invoice delivery method (email or paper)":
    "Izvēlieties vismaz vienu rēķina piegādes veidu (pa e-pastu vai papīra formātā)",
  "The original item is no longer present":
    "Sākotnējais vienums vairs nepastāv",
  "The original access grant is no longer present":
    "Sākotnējās piekļuves tiesības vairs nepastāv",
  "You cannot disable your own account": "Jūs nevarat atspējot savu kontu",
  "Resident not found": "Iedzīvotājs nav atrasts",
  "This person also has access in another organization, so you cannot disable the account":
    "Šai personai ir piekļuve arī citā organizācijā, tāpēc jūs nevarat atspējot kontu",
  "Administrators cannot be disabled here. Remove the administrator on the Users page":
    "Administratorus šeit nevar atspējot. Noņemiet administratoru lapā “Lietotāji un piekļuve”",
  "The original meter is no longer present":
    "Sākotnējais skaitītājs vairs nepastāv",
  "Meter not found": "Skaitītājs nav atrasts",
  "An archived meter cannot be edited": "Arhivētu skaitītāju nevar rediģēt",
  "The unit cannot change after readings exist. Archive this meter and add a new one.":
    "Mērvienību nevar mainīt, ja skaitītājam jau ir rādījumi. Arhivējiet šo skaitītāju un pievienojiet jaunu.",
  "Auto-send day is required when auto-send is enabled":
    "Ja ir ieslēgta automātiskā nosūtīšana, ir jānorāda automātiskās nosūtīšanas diena",
  "Cannot remove the last admin of an organization":
    "Nevar noņemt organizācijas pēdējo administratoru",
  "This file has already been imported for this organization.":
    "Šis fails šai organizācijai jau ir importēts.",
  "Bank import not found": "Bankas imports nav atrasts",
  "Bank transaction not found": "Bankas darījums nav atrasts",
  "This payment is already matched": "Šis maksājums jau ir piesaistīts",
  "This payment was reversed from this invoice. Choose a different invoice":
    "Šis maksājums tika atcelts no šī rēķina. Izvēlieties citu rēķinu",
  "This invoice cannot receive a payment":
    "Šim rēķinam nevar piesaistīt maksājumu",
  "This invoice is already fully allocated":
    "Šis rēķins jau ir pilnībā piesaistīts",
  "Amount must be greater than 0": "Summai jābūt lielākai par 0",
  "Enter a valid booking date (YYYY-MM-DD)":
    "Ievadiet derīgu grāmatošanas datumu (YYYY-MM-DD)",
  "Reference must be between 1 and 140 characters":
    "Atsaucei jābūt no 1 līdz 140 rakstzīmēm",
  "Payer name must be up to 140 characters":
    "Maksātāja vārdam jābūt līdz 140 rakstzīmēm",
  "A reason is required (up to 500 characters)":
    "Nepieciešams norādīt iemeslu (līdz 500 rakstzīmēm)",
  "Booking date cannot be in the future":
    "Grāmatošanas datums nevar būt nākotnē",
  "A payment with this reference, amount, and date already exists":
    "Maksājums ar šādu atsauci, summu un datumu jau pastāv",
  "Payment match not found": "Maksājuma piesaiste nav atrasta",
  "This match was rejected and cannot be confirmed":
    "Šī piesaiste tika noraidīta, un to nevar apstiprināt",
  "This payment is already applied to another invoice":
    "Šis maksājums jau ir piesaistīts citam rēķinam",
  "This invoice is already paid": "Šis rēķins jau ir apmaksāts",
  "This match has already been confirmed and cannot be rejected":
    "Šī piesaiste jau ir apstiprināta, un to nevar noraidīt",
  "Only a confirmed payment can be reversed":
    "Atcelt var tikai apstiprinātu maksājumu",
  "The credit from this payment was already used on a later invoice. Fix the balance with an adjustment":
    "Šī maksājuma kredīts jau tika izmantots vēlākā rēķinā. Izlabojiet atlikumu ar korekciju",
  "Value must be a non-negative number with at most 4 decimal places":
    "Vērtībai jābūt nenegatīvam skaitlim ar ne vairāk kā 4 zīmēm aiz komata",
  "Current value must be a non-negative number with at most 3 decimal places":
    "Pašreizējai vērtībai jābūt nenegatīvam skaitlim ar ne vairāk kā 3 zīmēm aiz komata",
  "The reading deadline for this period has passed":
    "Šī perioda rādījumu iesniegšanas termiņš ir pagājis",
  "Cannot record a reading for an archived meter":
    "Nevar reģistrēt rādījumu arhivētam skaitītājam",
  "Cannot edit this reading: a later billing period already recorded a reading for this meter":
    "Šo rādījumu nevar rediģēt: vēlākā norēķinu periodā šim skaitītājam jau ir reģistrēts rādījums",
  "What's this about?": "Par ko ir runa?",
  "The previous delivery attempt's outcome could not be confirmed. Verify whether the invoice was actually delivered, then use Resend if it needs to go out again.":
    "Iepriekšējā piegādes mēģinājuma rezultātu nevarēja apstiprināt. Pārbaudiet, vai rēķins tika piegādāts, un, ja tas jānosūta vēlreiz, izmantojiet “Nosūtīt atkārtoti”.",
  "Invoices prepared by the end of this day are sent on this day. The app tries a failed send again on the next days.":
    "Rēķini, kas sagatavoti līdz šīs dienas beigām, tiek nosūtīti tajā pašā dienā. Ja nosūtīšana neizdodas, lietotne mēģina vēlreiz nākamajās dienās.",
  "This email address bounced or reported a complaint. Change the billing email or remove it from the suppressed list":
    "Uz šo e-pasta adresi vēstules neizdevās nogādāt vai par to ir saņemta sūdzība. Nomainiet norēķinu e-pastu vai noņemiet adresi no bloķēto saraksta",
  "Suppressed address not found": "Bloķētā adrese nav atrasta",
  "Suppressed email addresses": "Bloķētās e-pasta adreses",
  "Addresses that bounced or reported a complaint.":
    "Adreses, uz kurām vēstules neizdevās nogādāt vai no kurām saņemta sūdzība.",
  "Invoices are not sent to these addresses. The email provider reported a permanent bounce or a complaint. Remove an address after you fix the problem.":
    "Uz šīm adresēm rēķini netiek sūtīti. E-pasta pakalpojuma sniedzējs ziņoja par pastāvīgu piegādes kļūdu vai sūdzību. Noņemiet adresi pēc tam, kad esat novērsis problēmu.",
  "Address removed.": "Adrese noņemta.",
  "No suppressed email addresses.": "Nav bloķētu e-pasta adrešu.",
  "Email address": "E-pasta adrese",
  Added: "Pievienots",
  Bounce: "Piegādes kļūda",
  Complaint: "Sūdzība",
  "Remove this address from the suppressed list? Invoices can be sent to it again.":
    "Noņemt šo adresi no bloķēto saraksta? Uz to atkal varēs sūtīt rēķinus.",
  "Remove from list": "Noņemt no saraksta",
  "Only an incoming payment can be applied to an invoice":
    "Rēķinam var piesaistīt tikai ienākošu maksājumu",
  "Administrators sign in with a password. Use the Admin sign in form on this page.":
    "Administratori piesakās ar paroli. Izmantojiet šajā lapā administratora pieteikšanās veidlapu.",
  "Request ID": "Pieprasījuma ID",
  "Audit log entries": "Audita žurnāla ieraksti",
  "Billing rules": "Norēķinu noteikumi",
  "Dwellings to import": "Importējamie īpašumi",
  "Imported payments": "Importētie maksājumi",
  "Payment matches": "Maksājumu atbilstības",
  "Payments to import": "Importējamie maksājumi",
  "Unmatched payments": "Nesaskaņotie maksājumi",
  "What happens when an invoice email bounces?":
    "Kas notiek, ja rēķina e-pasts netiek piegādāts?",
  "The email provider tells the app about a permanent bounce or a complaint. The app adds the address to the suppressed list and sends no more invoices to it. Open Settings, then Suppressed email addresses. Fix the billing email, or remove the address from the list.":
    "E-pasta pakalpojuma sniedzējs paziņo lietotnei par pastāvīgu piegādes kļūdu vai sūdzību. Lietotne pievieno adresi bloķēto sarakstam un vairs nesūta uz to rēķinus. Atveriet “Iestatījumi”, pēc tam “Bloķētās e-pasta adreses”. Izlabojiet norēķinu e-pastu vai noņemiet adresi no saraksta.",
  "Why does a sign-in link not work for me as an administrator?":
    "Kāpēc man kā administratoram nedarbojas pieteikšanās saite?",
  "Administrators sign in with a password. Use the Admin sign in form. A sign-in link works for residents only. Click Forgot password? if you do not know your password.":
    "Administratori piesakās ar paroli. Izmantojiet “Administratora pieteikšanās” veidlapu. Pieteikšanās saite darbojas tikai iedzīvotājiem. Ja nezināt paroli, nospiediet “Aizmirsāt paroli?”.",
  "This organization is archived. Restore it in Settings to make changes.":
    "Šī organizācija ir arhivēta. Lai veiktu izmaiņas, atjaunojiet to iestatījumos.",
  "A reason of 1 to 500 characters is required":
    "Nepieciešams iemesls no 1 līdz 500 rakstzīmēm",
  "This organization is closed": "Šī organizācija ir slēgta",
  "Your property manager has closed this account. You cannot see invoices or send messages here. Contact your property manager for help.":
    "Jūsu īpašuma pārvaldnieks ir slēdzis šo kontu. Šeit nevar skatīt rēķinus vai sūtīt ziņas. Vērsieties pēc palīdzības pie sava īpašuma pārvaldnieka.",
  "This organization is archived. You can read it but not change it. Residents cannot sign in. Restore it in Settings > Organization.":
    "Šī organizācija ir arhivēta. To var skatīt, bet nevar mainīt. Iedzīvotāji nevar pieteikties. Atjaunojiet to sadaļā “Iestatījumi” > “Organizācija”.",
  "Archive organization": "Arhivēt organizāciju",
  "Restore organization": "Atjaunot organizāciju",
  "This organization is archived. Restore it to make changes and to let residents sign in again.":
    "Šī organizācija ir arhivēta. Atjaunojiet to, lai veiktu izmaiņas un ļautu iedzīvotājiem atkal pieteikties.",
  "Archiving makes this organization read-only. Residents cannot sign in and their invoice links stop working. You can restore it later.":
    "Arhivēšana padara šo organizāciju tikai lasāmu. Iedzīvotāji nevar pieteikties, un viņu rēķinu saites pārstāj darboties. Vēlāk to var atjaunot.",
  "Archive this organization? Residents cannot sign in until you restore it.":
    "Arhivēt šo organizāciju? Iedzīvotāji nevarēs pieteikties, kamēr to neatjaunosiet.",
  "What can a resident change in the portal?":
    "Ko iedzīvotājs var mainīt portālā?",
  "A resident can change the display name on the Profile page. The email address cannot change. To use a new address, add the resident again with the new address. A resident can also click Download my data on the Profile page. The Payment history page shows each payment and each reversal. It does not show the payer name, the bank account, the reference, or the reason for a reversal.":
    "Iedzīvotājs var mainīt attēlojamo vārdu lapā “Profils”. E-pasta adresi mainīt nevar. Lai lietotu jaunu adresi, pievienojiet iedzīvotāju vēlreiz ar jauno adresi. Iedzīvotājs lapā “Profils” var arī nospiest “Lejupielādēt manus datus”. Lapa “Maksājumu vēsture” rāda katru maksājumu un katru atcelšanu. Tā nerāda maksātāja vārdu, bankas kontu, atsauci vai atcelšanas iemeslu.",
  "How do I download the data that the app holds about a resident?":
    "Kā lejupielādēt datus, ko lietotne glabā par iedzīvotāju?",
  "Open the dwelling page. Find the resident and click Export data. The app downloads one JSON file. The file has the data of this person in your organization: the dwelling details, sent invoices, payments, account entries, meter readings, messages, and the actions of the person in the app. It does not have bank account numbers, the email addresses of other people, or the data of dwellings that the person cannot use. The app writes an audit event for each download.":
    "Atveriet īpašuma lapu. Atrodiet iedzīvotāju un nospiediet “Eksportēt datus”. Lietotne lejupielādē vienu JSON failu. Failā ir šīs personas dati jūsu organizācijā: īpašuma dati, nosūtītie rēķini, maksājumi, konta ieraksti, skaitītāju rādījumi, ziņas un personas darbības lietotnē. Failā nav bankas kontu numuru, citu personu e-pasta adrešu un to īpašumu datu, kuriem persona nevar piekļūt. Lietotne katrai lejupielādei ieraksta audita notikumu.",
  "How do I archive an organization?": "Kā arhivēt organizāciju?",
  "Open Settings, then Organization. In the Archive organization box, enter a reason and click Archive organization. Confirm the message. The organization becomes read-only. You can read every page, but you cannot change anything. Residents cannot sign in. The links in old invoice emails stop working. The scheduled jobs stop. The app does not delete any data.":
    "Atveriet “Iestatījumi”, pēc tam “Organizācija”. Lodziņā “Arhivēt organizāciju” ievadiet iemeslu un nospiediet “Arhivēt organizāciju”. Apstipriniet ziņojumu. Organizācija kļūst tikai lasāma. Varat skatīt visas lapas, bet neko nevarat mainīt. Iedzīvotāji nevar pieteikties. Saites vecajos rēķinu e-pastos pārstāj darboties. Ieplānotie darbi apstājas. Lietotne neizdzēš nekādus datus.",
  "How do I restore an archived organization?":
    "Kā atjaunot arhivētu organizāciju?",
  "Open Settings, then Organization. Click Restore organization. The organization works as before. Residents can sign in again. The links in old invoice emails work again.":
    "Atveriet “Iestatījumi”, pēc tam “Organizācija”. Nospiediet “Atjaunot organizāciju”. Organizācija darbojas kā iepriekš. Iedzīvotāji atkal var pieteikties. Saites vecajos rēķinu e-pastos atkal darbojas.",
  "Person not found": "Persona nav atrasta",
  "unread conversations": "nelasītas sarunas",
  "Payment history": "Maksājumu vēsture",
  "No payments yet.": "Maksājumu vēl nav.",
  "Display name": "Attēlojamais vārds",
  "Enter a name of 1 to 100 characters.":
    "Ievadiet vārdu garumā no 1 līdz 100 rakstzīmēm.",
  "Export data": "Eksportēt datus",
  "Your data": "Jūsu dati",
  "Download a copy of the data this service holds about you, as a JSON file.":
    "Lejupielādējiet savu datu kopiju, ko šis pakalpojums glabā par jums, kā JSON failu.",
  "Download my data": "Lejupielādēt manus datus",
  "All changes saved": "Visas izmaiņas saglabātas",
  "Send this invoice to the resident by email now? Sent invoices cannot be edited.":
    "Vai nosūtīt šo rēķinu iedzīvotājam pa e-pastu tagad? Nosūtītos rēķinus nevar rediģēt.",
  "Send this invoice to the resident again by email?":
    "Vai nosūtīt šo rēķinu iedzīvotājam pa e-pastu vēlreiz?",
  "Revoke the resident's access link? They will no longer be able to open this invoice with it.":
    "Vai atsaukt iedzīvotāja piekļuves saiti? Ar to vairs nebūs iespējams atvērt šo rēķinu.",
  "Record that this invoice was physically posted? This cannot be undone.":
    "Vai atzīmēt, ka šis rēķins ir nosūtīts pa pastu? To nevar atsaukt.",
  "Send all selected invoices to residents by email now? Sent invoices cannot be edited.":
    "Vai nosūtīt visus atlasītos rēķinus iedzīvotājiem pa e-pastu tagad? Nosūtītos rēķinus nevar rediģēt.",
  "Archive this tariff? It will no longer be used for new invoices.":
    "Vai arhivēt šo tarifu? Tas vairs netiks izmantots jauniem rēķiniem.",
  "Invoice prepared.": "Rēķins sagatavots.",
  "Invoice sent.": "Rēķins nosūtīts.",
  "Sending has not finished yet. Check the delivery status.":
    "Sūtīšana vēl nav pabeigta. Pārbaudiet piegādes statusu.",
  "Resend submitted. Check the delivery status.":
    "Atkārtota nosūtīšana uzsākta. Pārbaudiet piegādes statusu.",
  "Access link revoked.": "Piekļuves saite atsaukta.",
  "Paper dispatch recorded.": "Nosūtīšana pa pastu atzīmēta.",
  "1 change saving": "Tiek saglabāta 1 izmaiņa",
  "{n} changes saving": "Tiek saglabātas {n} izmaiņas",
  "1 change needs attention": "1 izmaiņai jāpievērš uzmanība",
  "{n} changes need attention": "{n} izmaiņām jāpievērš uzmanība",
  "Recent changes": "Jaunākās izmaiņas",
  "Adding…": "Pievieno…",
  "Adding meter…": "Pievieno skaitītāju…",
  "Could not add meter": "Neizdevās pievienot skaitītāju",
  "Adding resident…": "Pievieno iedzīvotāju…",
  "Could not add resident": "Neizdevās pievienot iedzīvotāju",
  "Removing resident…": "Noņem iedzīvotāju…",
  "Resident removed": "Iedzīvotājs noņemts",
  "Creating dwelling…": "Izveido īpašumu…",
  "Dwelling created": "Īpašums izveidots",
  "Could not create dwelling": "Neizdevās izveidot īpašumu",
  "Saving dwelling information…": "Saglabā īpašuma informāciju…",
  "Could not save dwelling information":
    "Neizdevās saglabāt īpašuma informāciju",
  "Saving delivery preferences…": "Saglabā piegādes iestatījumus…",
  "Delivery preferences saved": "Piegādes iestatījumi saglabāti",
  "Could not save delivery preferences":
    "Neizdevās saglabāt piegādes iestatījumus",
  "Could not save": "Neizdevās saglabāt",
  "Saved, but the view could not be updated":
    "Saglabāts, bet skatu neizdevās atjaunināt",
  Retry: "Mēģināt vēlreiz",
  "Archiving…": "Arhivē…",
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
    "Administratora panelis ar norēķinu kopsummām un darbiem, kam jāpievērš uzmanība.",
  "Apply late fees to overdue invoices.":
    "Piemērot nokavējuma maksu kavētiem rēķiniem.",
  "Auto-send day of month": "Automātiskās nosūtīšanas diena mēnesī",
  "Automatic generation and sending run only for eligible billing periods.":
    "Automātiskā ģenerēšana un nosūtīšana notiek tikai atbilstošiem norēķinu periodiem.",
  "Automation scope": "Automatizācijas apjoms",
  "Avoid overlapping rules of the same type. When a new rate applies, create a new rule with a later effective date.":
    "Izvairieties no viena veida noteikumu pārklāšanās. Kad stājas spēkā jauna likme, izveidojiet jaunu noteikumu ar vēlāku sākuma datumu.",
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
    "Katra perioda sākumā izveido rēķinu melnrakstus visiem atbilstošajiem kontiem.",
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
    "Pirmajam norēķinu ciklam izpildiet šos soļus pēc kārtas. Pēc iestatīšanas atkārtojiet ikmēneša ciklu katru mēnesi.",
  "Good to know": "Noderīgi zināt",
  "Grace period (days)": "Labvēlības periods (dienās)",
  "Help & guidance": "Palīdzība un norādes",
  History: "Vēsture",
  "How tariffs are applied": "Kā tiek piemēroti tarifi",
  "How the charge is calculated.": "Kā tiek aprēķināta maksa.",
  "Important details about billing settings.":
    "Svarīga informācija par norēķinu iestatījumiem.",
  "Internal note (optional)": "Iekšējā piezīme (nav obligāti)",
  "Invoice numbering": "Rēķinu numerācija",
  "Invoice prefix": "Rēķina prefikss",
  "Keep your details current so that invoices, payments, and official communication are processed without delays.":
    "Uzturiet savus datus aktuālus, lai rēķini un maksājumi tiktu apstrādāti un oficiālā saziņa notiktu bez kavēšanās.",
  "Keep your organization details up to date to ensure correct invoicing and communication.":
    "Uzturiet organizācijas datus aktuālus, lai nodrošinātu pareizu rēķinu izrakstīšanu un saziņu.",
  "Late-payment changes": "Nokavēto maksājumu izmaiņas",
  "Leave empty for ongoing.": "Atstājiet tukšu, ja periods turpinās.",
  "Manage legal, contact, and bank details for this organization.":
    "Pārvaldiet šīs organizācijas juridisko informāciju, kontaktinformāciju un bankas rekvizītus.",
  "Manage utility rates, billing formulas, and effective periods.":
    "Pārvaldiet komunālo pakalpojumu likmes, aprēķina formulas un spēkā esamības periodus.",
  "Mark resolved": "Atzīmēt kā atrisinātu",
  "Maximum penalty as a percentage of eligible principal.":
    "Maksimālais soda apmērs procentos no piemērojamās pamatsummas.",
  "Maximum total penalty (%)": "Maksimālais kopējais soda apmērs (%)",
  "Meter type": "Skaitītāja veids",
  "Meter-based rules": "Skaitītāju noteikumi",
  "Need help?": "Nepieciešama palīdzība?",
  "No billing rules match this filter.":
    "Šim filtram neatbilst neviens norēķinu noteikums.",
  "No resident": "Nav iedzīvotāja",
  "Number of days after the due date before late fees apply.":
    "Dienu skaits no apmaksas termiņa līdz nokavējuma maksas piemērošanai.",
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
    "Izskatiet iedzīvotāju jautājumus, sūtiet paziņojumus un saglabājiet norēķinu sarunu kontekstu.",
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
  "Add the legal name, address, contact details, bank name, IBAN, registration number, and VAT number used on invoices.":
    "Pievienojiet juridisko nosaukumu, adresi, kontaktinformāciju, bankas nosaukumu, IBAN, reģistrācijas numuru un PVN numuru, ko izmanto rēķinos.",
  "Ready when the invoice issuer and payment details are complete.":
    "Gatavs, kad ir aizpildīti rēķina izrakstītāja dati un maksājuma rekvizīti.",
  "Click Create dwelling to add one dwelling, or import a CSV file for many. Check each number, type, occupant, area, and resident count. A new dwelling joins every currently open billing period.":
    "Spiediet “Izveidot īpašumu”, lai pievienotu vienu īpašumu, vai importējiet CSV failu, lai pievienotu vairākus. Pārbaudiet katra īpašuma numuru, tipu, iedzīvotāju, platību un iedzīvotāju skaitu. Jauns īpašums tiek iekļauts visos pašlaik atvērtajos norēķinu periodos.",
  "Open tariffs & rules": "Atvērt tarifus un noteikumus",
  "Why do some actions ask me to confirm?":
    "Kāpēc dažas darbības prasa apstiprinājumu?",
  "The Send, Resend, Revoke access link, and Record paper dispatch actions require confirmation. The Archive, Remove, Disable, Override status, Confirm payment, Reverse payment, Match to invoice, and Record payment actions also require confirmation. Confirmation helps prevent changes that are difficult to undo.":
    "Rēķina nosūtīšanai un atkārtotai nosūtīšanai, piekļuves saites atsaukšanai un papīra nosūtīšanas reģistrēšanai ir nepieciešams apstiprinājums. Apstiprinājums ir nepieciešams arī arhivēšanai, noņemšanai, atspējošanai, statusa aizstāšanai, maksājuma apstiprināšanai, maksājuma atcelšanai, piesaistīšanai rēķinam un maksājuma reģistrēšanai. Tas palīdz nepieļaut grūti atsaucamas izmaiņas.",
  "What if I forget my password?": "Ko darīt, ja aizmirstu paroli?",
  "Click Forgot password? on the sign-in page. Enter your email address. Follow the link in the email to set a new password.":
    "Pieteikšanās lapā spiediet “Aizmirsāt paroli?”. Ievadiet savu e-pasta adresi. Sekojiet e-pastā saņemtajai saitei, lai iestatītu jaunu paroli.",
  "Ready when every billable unit appears in the dwelling list.":
    "Gatavs, kad īpašumu sarakstā ir redzamas visas vienības, par kurām jāizraksta rēķini.",
  "Dwelling list with filters and dwelling details.":
    "Īpašumu saraksts ar filtriem un īpašumu datiem.",
  "Open each dwelling. Assign resident access. Add billing contact details. Register its meters. You can edit a meter later, but you cannot change its unit of measurement after a reading exists.":
    "Atveriet katru īpašumu. Piešķiriet iedzīvotājam piekļuvi. Pievienojiet norēķinu kontaktinformāciju. Reģistrējiet īpašuma skaitītājus. Skaitītāju var rediģēt arī vēlāk, bet pēc pirmā rādījuma ievadīšanas tā mērvienību mainīt nevar.",
  "Ready when residents can access their dwelling and all meters are listed.":
    "Gatavs, kad iedzīvotāji var piekļūt savam īpašumam un visi skaitītāji ir uzskaitīti.",
  "Dwelling detail page with resident access and meter registration.":
    "Īpašuma informācijas lapa ar iedzīvotāja piekļuvi un skaitītāju reģistrāciju.",
  "Set tariffs and rules": "Iestatiet tarifus un noteikumus",
  "Add the billing rules that set fixed, area, resident-count, or meter-consumption charges.":
    "Pievienojiet norēķinu noteikumus, kas nosaka fiksētu maksu vai maksu pēc platības, iedzīvotāju skaita vai skaitītāja uzskaitītā patēriņa.",
  "Tariffs and rules list with rule details.":
    "Tarifu un noteikumu saraksts ar noteikumu datiem.",
  "Set the billing window, reading deadline, invoice issue date, and due date. A new period creates a case for each active dwelling. Residents can submit readings through the deadline date in the organization time zone. Administrators can enter readings later.":
    "Iestatiet norēķinu periodu, rādījumu iesniegšanas termiņu, rēķina izdošanas datumu un apmaksas termiņu. Jauns periods izveido lietu katram aktīvajam īpašumam. Iedzīvotāji var iesniegt rādījumus līdz termiņa dienas beigām organizācijas laika joslā. Administratori var ievadīt rādījumus arī vēlāk.",
  "Ready when the new OPEN period appears in the period list.":
    "Gatavs, kad jaunais ATVĒRTAIS periods parādās periodu sarakstā.",
  "Billing period list and period actions.":
    "Norēķinu periodu saraksts un darbības ar periodiem.",
  "Use the dashboard attention list or the monthly workbench to find missing readings. Residents can also submit readings when allowed.":
    "Izmantojiet informācijas paneļa sarakstu ar lietām, kam jāpievērš uzmanība, vai ikmēneša darbvirsmu, lai atrastu trūkstošos rādījumus. Iedzīvotāji var arī iesniegt rādījumus, ja tas ir atļauts.",
  "Generate eligible invoices in the workbench. Review the calculation lines, recipient details, dates, and totals. You can waive the late fee or add a manual adjustment only before you prepare a DRAFT invoice.":
    "Ģenerējiet atbilstošos rēķinus darbvietā. Pārskatiet aprēķina rindas, saņēmēja datus, datumus un kopsummas. Nokavējuma maksu var atcelt vai pievienot manuālu korekciju tikai pirms rēķina ar statusu “Melnraksts” sagatavošanas.",
  "Ready when correct invoices are in DRAFT and you have fixed all validation blockers.":
    "Gatavs, kad pareizie rēķini ir statusā MELNRAKSTS un visas validācijas kļūdas ir novērstas.",
  "Monthly workbench with the billing workflow and case list.":
    "Ikmēneša darbvirsma ar norēķinu darbplūsmu un lietu sarakstu.",
  "Prepare approved drafts. Send the prepared invoices. Delivery moves each case to SENT and locks the invoice. With automatic sending on, the app sends the invoices that you prepared by the end of the send day. It tries again on the next days if a send fails.":
    "Sagatavojiet apstiprinātos melnrakstus. Nosūtiet sagatavotos rēķinus. Pēc nosūtīšanas katra lieta iegūst statusu NOSŪTĪTS, un rēķins tiek bloķēts. Ja automātiskā sūtīšana ir ieslēgta, lietotne nosūta līdz sūtīšanas dienas beigām sagatavotos rēķinus. Ja sūtīšana neizdodas, tā mēģina vēlreiz nākamajās dienās.",
  "Ready when sent invoices show SENT, or show a clear delivery error to fix.":
    "Gatavs, kad nosūtītajiem rēķiniem ir statuss NOSŪTĪTS vai ir redzama skaidra piegādes kļūda, kas jālabo.",
  "Import a bank statement. Check the preview. Confirm the import. Review proposed or unmatched payments. Use the search box and date fields to find a payment in the selected view. You can also record a payment by hand, reverse a wrong payment, or match an unmatched payment.":
    "Importējiet bankas izrakstu. Pārbaudiet priekšskatījumu. Apstipriniet importu. Pārskatiet piedāvātos vai nesaskaņotos maksājumus. Izmantojiet meklēšanas lauku un datumu laukus, lai izvēlētajā skatā atrastu maksājumu. Varat arī ievadīt maksājumu manuāli, atcelt kļūdainu maksājumu vai piesaistīt nesaskaņotu maksājumu rēķinam.",
  "Ready when you have confirmed valid matches and the matching invoices show PAID.":
    "Gatavs, kad pareizie piesaistījumi ir apstiprināti un attiecīgajiem rēķiniem ir statuss APMAKSĀTS.",
  "Review resident messages, overdue invoices, unmatched payments, and delivery failures. Resolve each conversation once its issue is fixed.":
    "Pārskatiet iedzīvotāju ziņas, kavētos rēķinus, nepiesaistītos maksājumus un piegādes kļūdas. Kad sarakstes problēma ir novērsta, atzīmējiet to kā atrisinātu.",
  "Ready when every attention item has an owner or is resolved.":
    "Gatavs, kad katram vienumam, kam jāpievērš uzmanība, ir atbildīgā persona vai tas ir atrisināts.",
  "Messages inbox with a resident conversation open.":
    "Ziņu iesūtne ar atvērtu sarunu ar iedzīvotāju.",
  "MISSING DATA means something blocks the invoice: a required input is missing, a rule has no active meter, or no billing rule applies. READY means the invoice can be generated. DRAFT means you can still review and regenerate it. PREPARED is approved and ready to send. SENT means delivery succeeded. OVERDUE means the due date passed unpaid. PAID means the invoice is fully paid.":
    "MISSING DATA nozīmē, ka rēķinu kaut kas bloķē: trūkst nepieciešamās informācijas, noteikumam nav aktīva skaitītāja vai nav piemērojams neviens norēķinu noteikums. READY nozīmē, ka rēķinu var ģenerēt. DRAFT nozīmē, ka joprojām varat to pārskatīt un no jauna ģenerēt. PREPARED nozīmē, ka rēķins ir apstiprināts un gatavs nosūtīšanai. SENT nozīmē, ka piegāde bija sekmīga. OVERDUE nozīmē, ka apmaksas termiņš ir pagājis un rēķins nav apmaksāts. PAID nozīmē, ka rēķins ir pilnībā apmaksāts.",
  "Why can I not generate an invoice?": "Kāpēc nevaru ģenerēt rēķinu?",
  "The system blocks generation when required inputs are missing or the period is locked. Open the affected dwelling in the workbench to see what is missing.":
    "Sistēma bloķē ģenerēšanu, ja trūkst nepieciešamo datu vai periods ir bloķēts. Atveriet attiecīgo īpašumu darbvietā, lai redzētu, kas trūkst.",
  "Why can I not prepare an invoice?": "Kāpēc nevaru sagatavot rēķinu?",
  "The invoice must be a DRAFT with complete issuer, recipient, and payment details. Fix the related settings. Regenerate the draft to update its snapshot.":
    "Rēķinam jābūt statusā MELNRAKSTS ar pilnīgiem izdevēja, saņēmēja un maksājuma datiem. Labojiet attiecīgos iestatījumus. Ģenerējiet melnrakstu no jauna, lai atjauninātu tā momentuzņēmumu.",
  "Why can I not send an invoice?": "Kāpēc nevaru nosūtīt rēķinu?",
  "You can send email to a PREPARED invoice. You can also send it to a SENT, PAID, or OVERDUE invoice that first used paper delivery. The invoice needs a billing email. If delivery fails, fix the cause, then retry or resend.":
    "Varat pa e-pastu nosūtīt rēķinu statusā PREPARED. Tāpat varat nosūtīt arī rēķinu statusā SENT, PAID vai OVERDUE, kas sākotnēji piegādāts papīra formātā. Rēķinam nepieciešama norēķinu e-pasta adrese. Ja piegāde neizdodas, novērsiet cēloni un pēc tam mēģiniet vēlreiz vai nosūtiet atkārtoti.",
  "No. A sent invoice is a permanent financial record and cannot change. Changes to dwellings, tariffs, or settings apply only to future invoices.":
    "Nē. Nosūtīts rēķins ir pastāvīgs finanšu dokuments, un to nevar mainīt. Izmaiņas īpašumos, tarifos vai iestatījumos attiecas tikai uz turpmākajiem rēķiniem.",
  "Review its amount, currency, payer, and reference. When you find the correct invoice, choose it in the Unmatched tab and click Match to invoice. The payment applies right away. Do not match a payment if you are not sure.":
    "Pārbaudiet summu, valūtu, maksātāju un atsauci. Kad atrodat pareizo rēķinu, izvēlieties to cilnē “Nesaskaņotie” un noklikšķiniet uz “Piesaistīt rēķinam”. Maksājums tiks ieskaitīts uzreiz. Nepiesaistiet maksājumu, ja neesat pārliecināts.",
  "Lock a period after its normal reading and invoice work is complete. A locked period stays available for history, but blocks reading edits and invoice regeneration.":
    "Bloķējiet periodu, kad ir pabeigta ierastā rādījumu apstrāde un rēķinu sagatavošana. Bloķēts periods joprojām ir pieejams vēsturē, taču tajā nevar labot rādījumus vai no jauna ģenerēt rēķinus.",
  "Required input is missing. Generation is blocked.":
    "Trūkst nepieciešamās informācijas. Ģenerēšana ir bloķēta.",
  "Nothing blocks the invoice. You can now generate it.":
    "Nekas nebloķē rēķinu. Tagad varat to ģenerēt.",
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
    "Sekojiet līdzi svarīgām izmaiņām savā organizācijā.",

  // Added: translation coverage pass 4 (manual billing rule input drawer)
  Value: "Vērtība",
  "Enter the quantity for this period.": "Ievadiet daudzumu par šo periodu.",
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
  "Line items": "Pozīcijas",
  "Zoom level": "Tuvinājuma līmenis",
  "Expand section": "Izvērst sadaļu",
  "Collapse section": "Sakļaut sadaļu",
  "More options": "Citas iespējas",
  "Preview period": "Priekšskatījuma periods",
  "No billing periods yet — showing tariffs effective today.":
    "Vēl nav norēķinu periodu — tiek rādīti šodien spēkā esošie tarifi.",
  "Charge quantities shown here are illustrative (always 1) and do not reflect any real resident's bill.":
    "Šeit redzamie daudzumi ir ilustratīvi (vienmēr 1) un neatspoguļo neviena reāla iedzīvotāja rēķinu.",
  "Latvian is the canonical invoice language. English and Russian are optional translations; a missing translation falls back to Latvian.":
    "Latviešu valoda ir rēķina kanoniskā valoda. Angļu un krievu valoda ir neobligāti tulkojumi; ja tulkojuma nav, tiek izmantots latviešu teksts.",
  "Editing language": "Rediģēšanas valoda",
  "Latvian is the canonical invoice document. English and Russian are optional translated copies of the same invoice — not separate invoices.":
    "Rēķins latviešu valodā ir kanoniskais dokuments. Versijas angļu un krievu valodā ir šī paša rēķina neobligātas tulkotas kopijas — nevis atsevišķi rēķini.",
  "Document language": "Dokumenta valoda",
  "Control what appears on generated invoices, in what order, and how each section looks.":
    "Kontrolējiet, kas parādās izveidotajos rēķinos, kādā secībā un kā izskatās katra sadaļa.",
  "Add text block": "Pievienot teksta bloku",
  "Reset layout": "Atiestatīt izkārtojumu",
  "Invoice sections": "Rēķina sadaļas",
  "Invoice preview": "Rēķina priekšskatījums",
  "Sample resident": "Parauga iedzīvotājs",
  "Sample Street 1, Riga, LV-1010": "Parauga iela 1, Rīga, LV-1010",
  "Maintenance fee": "Apsaimniekošanas maksa",
  "Invoice details": "Rēķina informācija",
  "Sender and recipient": "Izdevējs un saņēmējs",
  "Charges table": "Aprēķinu tabula",
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
    "Atiestatīt rēķina izkārtojumu uz noklusējuma veidni? Pielāgotie teksta bloki, sadaļu nosaukumi un rindu formatējums tiks noņemti. Jūsu galvenes, kājenes, maksājuma instrukciju un piezīmes teksts tiks saglabāts.",
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
  "Delivery outcome could not be confirmed. The email provider may have accepted this invoice, but the application did not receive confirmation. Verify the recipient mailbox or provider logs before resending.":
    "Piegādes rezultātu neizdevās apstiprināt. E-pasta pakalpojumu sniedzējs, iespējams, pieņēma šo rēķinu, taču lietojumprogramma nesaņēma apstiprinājumu. Pirms atkārtotas nosūtīšanas pārbaudiet saņēmēja pastkasti vai pakalpojumu sniedzēja žurnālus.",
  "Sending in progress…": "Notiek nosūtīšana…",
  "Record paper dispatch": "Reģistrēt nosūtīšanu papīra formātā",
  "Paper dispatched": "Nosūtīts papīra formātā",
  "This invoice was delivered by email previously. A later attempt's outcome could not be confirmed -- verify the recipient mailbox or provider logs before resending.":
    "Šis rēķins iepriekš tika nosūtīts pa e-pastu. Vēlākā mēģinājuma rezultātu neizdevās apstiprināt -- pirms atkārtotas nosūtīšanas pārbaudiet saņēmēja pastkasti vai pakalpojumu sniedzēja žurnālus.",
  "This invoice was delivered by email previously. The most recent resend failed -- use Resend to try again.":
    'Šis rēķins iepriekš tika nosūtīts pa e-pastu. Jaunākais atkārtotas nosūtīšanas mēģinājums neizdevās -- izmantojiet "Nosūtīt atkārtoti", lai mēģinātu vēlreiz.',
  "Paper (unverified legacy record)":
    "Papīra formāts (nepārbaudīts vēsturisks ieraksts)",
  "Recorded automatically under the old delivery workflow -- not a confirmed manual physical dispatch.":
    "Automātiski reģistrēts iepriekšējā piegādes darbplūsmā -- tas neapstiprina manuālu nosūtīšanu papīra formātā.",

  // Recurring tariffs (Tariffs & rules + dwelling read-only view).
  "Recurring tariffs": "Regulārie tarifi",
  "Automatically applied": "Automātiski piemēroti",
  "Assigned specifically": "Piešķirti individuāli",
  "All dwellings": "Visi īpašumi",
  "Selected dwellings": "Izvēlētie īpašumi",
  "One dwelling": "Viens īpašums",
  "assigned here": "piešķirts šeit",
  automatic: "automātiski",
  "this dwelling": "šim īpašumam",
  "Edit tariff": "Rediģēt tarifu",
  "View all tariffs": "Skatīt visus tarifus",
  "No recurring tariffs apply to this dwelling.":
    "Šim īpašumam nav piemērojams neviens regulārs tarifs.",
  "Recurring tariffs are configured and assigned from Tariffs & rules.":
    "Regulārie tarifi tiek konfigurēti un piešķirti sadaļā “Tarifi un noteikumi”.",
  "Amount set per period": "Summa tiek noteikta katram periodam",
  "Not assigned yet": "Vēl nav piešķirts",
  dwellings: "īpašumi",
  "Applies to": "Attiecas uz",

  // Tariff drawer (create/edit form) -- section headings, field hints,
  // and scope-option descriptive copy.
  TARIFF: "TARIFS",
  General: "Vispārīgi",
  Calculation: "Aprēķins",
  "A price of 0.00 is valid and will show on the invoice.":
    "Cena 0,00 ir derīga un tiks rādīta rēķinā.",
  "Applies to every current and future dwelling.":
    "Attiecas uz visiem esošajiem un turpmākajiem īpašumiem.",
  "Applies to exactly one dwelling.": "Attiecas tieši uz vienu īpašumu.",
  "Applies only to the dwellings you choose. New dwellings are not included automatically.":
    "Attiecas tikai uz jūsu izvēlētajiem īpašumiem. Jauni īpašumi netiek pievienoti automātiski.",
  "Search dwellings": "Meklēt īpašumus",
  "Filter by dwelling number...": "Filtrēt pēc īpašuma numura...",
  "Select all visible": "Atlasīt visus redzamos",
  "-- select a dwelling --": "-- izvēlieties īpašumu --",
  Validity: "Derīgums",
  Advanced: "Papildu",
  "Sort order": "Kārtošanas secība",
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
    "Счёт ещё можно проверить и сформировать заново.",
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
    "Создайте помещения по одному или импортируйте их из CSV. Проверьте номера, типы, проживающих, площади и количество жильцов.",
  "Ready when every billable unit appears in the dwelling directory.":
    "Готово, когда каждое расчётное помещение появилось в списке помещений.",
  "Assign residents and meters": "Привяжите жильцов и счётчики",
  "Open each dwelling to assign resident access, add billing contact details and register its meters.":
    "Откройте каждое помещение, чтобы настроить доступ жильца, указать контакты для счетов и привязать счётчики.",
  "Ready when residents can access the correct dwelling and required meters are listed.":
    "Готово, когда у жильцов есть доступ к нужному помещению и нужные счётчики указаны.",
  "Configure tariffs and rules": "Настройте тарифы и правила",
  "Add the billing rules that determine fixed, area, resident-count or meter-consumption charges.":
    "Добавьте правила расчёта: фиксированные начисления, по площади, по числу жильцов или по показаниям счётчиков.",
  "Ready when every required charge has an enabled rule for the billing date.":
    "Готово, когда для каждого обязательного начисления включено правило на дату счёта.",
  "Create the billing period": "Создайте расчётный период",
  "Set the billing window, reading deadline, invoice issue date and due date. Creating a period creates a case for each active dwelling.":
    "Задайте границы периода, срок подачи показаний, дату выставления и срок оплаты. При создании периода для каждого активного помещения формируется расчётная запись.",
  "Ready when the new OPEN period appears in period history.":
    "Готово, когда новый период со статусом ОТКРЫТ появится в истории периодов.",
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
    "Готово, когда нужные счета имеют статус ОТПРАВЛЕН или отображается понятная ошибка доставки, которую нужно устранить.",
  "Reconcile incoming payments": "Сверьте поступившие платежи",
  "Import a bank statement, inspect the preview, confirm the import and review proposed or unmatched transactions.":
    "Импортируйте банковскую выписку, ознакомьтесь с предпросмотром, подтвердите импорт и проверьте предложенные или несопоставленные операции.",
  "Ready when valid matches are confirmed and the corresponding invoices show PAID.":
    "Готово, когда правильные совпадения подтверждены, а соответствующие счета перешли в статус ОПЛАЧЕН.",
  "Handle questions and exceptions": "Разберите вопросы и спорные ситуации",
  "Review resident messages, overdue invoices, unmatched payments and delivery failures. Resolve conversations when the issue is closed.":
    "Проверяйте сообщения жильцов, просроченные счета, несопоставленные платежи и ошибки доставки. Закрывайте переписку, когда вопрос решён.",
  "Ready when attention items have an owner or are resolved.":
    "Готово, когда у каждого требующего внимания вопроса есть ответственный либо вопрос решён.",
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
    "Закрывайте период, когда все показания внесены и работа со счетами завершена. Закрытые периоды остаются доступными в истории, но блокируют обычное редактирование показаний и пересчёт счетов.",
  "Auto-send day of month (1-28)": "День месяца для автоотправки (1–28)",
  "Automatically generate invoices each period":
    "Автоматически формировать счета в каждом периоде",
  "Reuse the previous reading after the deadline":
    "Использовать предыдущее показание после истечения срока",
  "When no meter reading arrives by the reading deadline, the previous reading is used and the consumption is zero. The next real reading bills the difference.":
    "Если до срока подачи показаний показание счётчика не поступило, используется предыдущее показание, а расход равен нулю. Разница рассчитывается по следующему фактическому показанию.",
  "Automatically send prepared invoices":
    "Автоматически отправлять подготовленные счета",
  "Only applies when auto-send is enabled above.":
    "Действует, только если выше включена автоотправка.",
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
    "Этот же файл уже был импортирован для этой организации. Повторный импорт будет заблокирован.",
  Resend: "Отправить повторно",
  "Revoke access link": "Отозвать ссылку для доступа",
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
    "Исправьте данные и заново сформируйте черновик перед повторной подготовкой.",
  Upload: "Загрузить",
  Preview: "Предпросмотр",
  "Confirm import": "Подтвердить импорт",
  "Choose another file": "Выбрать другой файл",
  "CSV file": "Файл CSV",
  "Import dwellings": "Импортировать помещения",
  "Bank statement CSV file": "CSV-файл банковской выписки",
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
    "Нет диалогов, соответствующих этому фильтру.",
  "No conversations yet.": "Диалогов пока нет.",
  "This conversation is resolved.": "Этот вопрос решён.",
  "No residents assigned.": "Жильцы не назначены.",
  "Meter added": "Счётчик добавлен",
  "Resident added": "Жилец добавлен",
  "This resident already has access.": "У этого жильца уже есть доступ.",
  "No billing rules yet.": "Правил расчёта пока нет.",
  "No dwellings assigned.": "Помещения не назначены.",
  "No transactions in this import.": "В этом импорте нет операций.",
  "Match status": "Статус сопоставления",
  "No audit events match this filter.":
    "Нет событий аудита, соответствующих этому фильтру.",
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
  Administration: "Администрирование",
  "Resident portal": "Портал жильца",
  Portal: "Портал",
  "Sign out": "Выйти",
  "Switch organization": "Сменить организацию",
  "Switch to resident view": "Переключиться на вид жильца",
  "Switch to admin view": "Переключиться на вид администратора",
  Navigation: "Навигация",
  "Skip to content": "Перейти к содержимому",
  Menu: "Меню",
  Profile: "Профиль",
  Overview: "Обзор",
  Invoices: "Счета",
  Dwelling: "Помещение",
  "Missing data": "Недостающие данные",
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
  Outstanding: "Неоплаченная сумма",
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
  "Ready to invoice": "Готов к выставлению счёта",
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
    "После закрытия этого периода нельзя будет менять показания и пересчитывать счета. Исторические данные останутся доступны.",
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
  "Clear selection": "Снять выделение",
  "Billing inputs": "Данные для счёта",
  "Next action": "Следующее действие",
  missing: "нет данных",
  "Required readings complete": "Обязательные показания внесены",
  "Billing email ready": "Эл. почта для счетов указана",
  "Billing email missing": "Не указана эл. почта для счетов",
  "Recipient details incomplete": "Данные получателя заполнены не полностью",
  "Issuer or payment details incomplete":
    "Данные организации или платёжные реквизиты заполнены не полностью",
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
    "Этот период закрыт. Нельзя изменять показания и создавать счета.",
  "Select draft invoices to prepare, or prepared invoices to send.":
    "Выберите черновики для подготовки или подготовленные счета для отправки.",
  "Select invoice": "Выбрать счёт",
  "Select all eligible invoices": "Выбрать все подходящие счета",
  "Generate all eligible": "Создать все подходящие",
  "Prepare selected": "Подготовить выбранные",
  "Send selected": "Отправить выбранные",
  "Lock period": "Закрыть период",
  "Reopen period": "Открыть период",
  "To bill a dwelling for this period after the fact, reopen the period.":
    "Чтобы выставить счёт помещению за этот период задним числом, откройте период.",
  "Dwellings not in this period": "Помещения, не включённые в этот период",
  "These dwellings have no billing case in this period, so they get no invoice for it. Add a dwelling to bill it for this period. The invoice uses the issue and due dates of this period.":
    "У этих помещений нет расчётной записи в этом периоде, поэтому для них не выставляется счёт. Добавьте помещение, чтобы выставить ему счёт за этот период. В счёте используются дата выставления и срок оплаты этого периода.",
  "Add to period": "Добавить в период",
  "An archived dwelling cannot be added to a billing period":
    "Архивное помещение нельзя добавить в расчётный период",
  "This dwelling already has a billing case in this period":
    "Для этого помещения в этом периоде уже есть расчётная запись",
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
  "New dwellings are included in every currently open billing period. Archive historically billed dwellings to preserve their invoices.":
    "Новые помещения будут включены во все открытые на данный момент расчётные периоды. Архивируйте помещения, по которым ранее выставлялись счета, чтобы сохранить эти счета.",
  "No dwellings match this filter.":
    "Нет помещений, подходящих под этот фильтр.",
  Previous: "Предыдущая",
  Next: "Следующая",
  Page: "Страница",
  "Import bank statement": "Импортировать банковскую выписку",
  "Bank imports": "Импорт из банка",
  Imports: "Импорт",
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
  Issuer: "Выставитель счёта",
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
    "Данные получателя заполнены не полностью. Укажите имя или наименование для выставления счёта либо имя жильца, а также адрес для выставления счёта.",
  "Issuer or payment information is incomplete. Add the organization name, address, bank name and IBAN.":
    "Данные выставителя счёта или реквизиты для оплаты заполнены не полностью. Укажите название организации, адрес, название банка и IBAN.",
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
  "Tariffs in this period": "Тарифы в этом периоде",
  "Applying:": "Применяются:",
  "A tariff applies when its effective dates overlap the period. To bill an earlier period, give the tariff an earlier Effective from date.":
    "Тариф применяется, если даты его действия пересекаются с периодом. Чтобы выставить счёт за более ранний период, укажите для тарифа более раннюю дату «Действует с».",
  "Edit tariffs": "Редактировать тарифы",
  "No tariffs exist yet.": "Тарифов пока нет.",
  "Does not apply: the tariff is archived.": "Не применяется: тариф в архиве.",
  "Does not apply: the tariff is disabled.": "Не применяется: тариф выключен.",
  "Does not apply: it starts after this period ends.":
    "Не применяется: он начинается после окончания этого периода.",
  "Does not apply: it ended before this period starts.":
    "Не применяется: он закончился до начала этого периода.",
  "Applies to all dwellings.": "Применяется ко всем помещениям.",
  "Applies to no dwelling: none is assigned.":
    "Не применяется ни к одному помещению: ни одно не назначено.",
  "Applies only to the assigned dwellings:":
    "Применяется только к назначенным помещениям:",
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
    "Просмотрите записи о действиях в организации.",
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
    "После архивации помещение не будет отображаться в новых периодах и списках активных помещений. Предыдущие счета и показания сохранятся.",
  Area: "Площадь",
  "Basic information": "Основная информация",
  "Billing details": "Данные для счетов",
  Building: "Здание",
  "Calculated consumption": "Рассчитанный расход",
  "No reading arrived by the deadline, so the previous reading was reused. Enter the real value to replace it.":
    "До срока подачи показаний показание не поступило, поэтому было использовано предыдущее показание. Введите фактическое значение, чтобы заменить его.",
  "Previous reading reused": "Использовано предыдущее показание",
  "Changes recorded against this dwelling.":
    "Изменения, зафиксированные по этому помещению.",
  "Changes saved": "Изменения сохранены",
  Close: "Закрыть",
  "Complete the details below to resolve invoice preparation blockers.":
    "Укажите данные ниже, чтобы устранить проблемы с подготовкой счёта.",
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
  "Open full dwelling": "Открыть полную карточку помещения",
  "Outstanding balance": "Остаток долга",
  Paper: "На бумаге",
  "Paper delivery": "Доставка в бумажном виде",
  "People who can access their invoices and messages.":
    "Люди с доступом к своим счетам и сообщениям.",
  "Previous reading": "Предыдущее показание",
  "Reading saved": "Показание сохранено",
  Reason: "Причина",
  "Recent messages": "Последние сообщения",
  "Save changes": "Сохранить изменения",
  "Save readings": "Сохранить показания",
  "Saving…": "Сохранение…",
  "Waiting for server…": "Ожидание ответа сервера…",
  "Checking save status…": "Проверка статуса сохранения…",
  "Outcome not confirmed": "Результат не подтверждён",
  "Check again": "Проверить снова",
  "The original change was saved, but the item is no longer present. The page has been refreshed.":
    "Исходное изменение было сохранено, но элемент больше не существует. Страница обновлена.",
  "Applying changes…": "Применение изменений…",
  Saved: "Сохранено",
  Dismiss: "Закрыть",
  "Sign in": "Войти",
  Password: "Пароль",
  "Resident sign in": "Вход для жильцов",
  "Admin sign in": "Вход для администраторов",
  "Send sign-in link": "Отправить ссылку для входа",
  "Incorrect email or password.": "Неверный e-mail или пароль.",
  "We couldn't find an account for that sign-in. If you believe this is a mistake, contact your administrator.":
    "Аккаунт с такими данными для входа не найден. Если вы считаете, что это ошибка, обратитесь к администратору.",
  "Too many sign-in attempts. Please wait a minute and try again.":
    "Слишком много попыток входа. Подождите минуту и повторите попытку.",
  "Enter your email and we'll send you a secure sign-in link.":
    "Введите свой e-mail, и мы отправим защищённую ссылку для входа.",
  "If that email is registered, a sign-in link is on its way.":
    "Если этот e-mail зарегистрирован, ссылка для входа уже отправлена.",
  "This sign-in link is invalid or has expired. Request a new one below.":
    "Эта ссылка для входа недействительна или срок её действия истёк. Запросите новую ниже.",
  "Page not found": "Страница не найдена",
  "The page you are looking for does not exist or has moved.":
    "Страница, которую вы ищете, не существует или была перемещена.",
  "Go to sign in": "Перейти ко входу",
  "Sign in as a resident with an email link, or as an administrator with a password.":
    "Войдите как жилец по ссылке из e-mail или как администратор по паролю.",
  "Access denied": "Доступ запрещён",
  "This area requires additional verification. Please complete sign-in with your second factor.":
    "Для этого раздела нужна дополнительная проверка. Завершите вход с помощью второго фактора.",
  "You do not have access to this resource.":
    "У вас нет доступа к этому ресурсу.",
  "Back to sign in": "Назад ко входу",
  "Confirm sign-in": "Подтвердить вход",
  "Click below to finish signing in.": "Нажмите ниже, чтобы завершить вход.",
  "Registration number": "Регистрационный номер",
  "VAT number": "Номер плательщика НДС",
  "View confirmed payments": "Показать подтверждённые платежи",
  "Confirm this payment? The invoice balance will be updated.":
    "Подтвердить этот платёж? Остаток по счёту будет обновлён.",
  "The period start date must not be after its end date.":
    "Дата начала периода не может быть позже даты окончания.",
  "The due date must not be before the invoice issue date.":
    "Срок оплаты не может быть раньше даты выставления счёта.",
  "The reading deadline must not be after the invoice issue date.":
    "Срок передачи показаний не может быть позже даты выставления счёта.",
  "Forgot password": "Забыли пароль",
  "Forgot password?": "Забыли пароль?",
  "Enter your admin email and we'll send you a link to choose a new password.":
    "Введите e-mail администратора, и мы отправим ссылку для выбора нового пароля.",
  "If that email belongs to an admin account, a reset link is on its way.":
    "Если этот e-mail принадлежит аккаунту администратора, ссылка для сброса пароля уже отправлена.",
  "This reset link is invalid or has expired. Request a new one.":
    "Эта ссылка для сброса недействительна или срок её действия истёк. Запросите новую.",
  "Send reset link": "Отправить ссылку для сброса",
  "The password must be at least 8 characters.":
    "Пароль должен содержать не менее 8 символов.",
  "The password is too long.": "Пароль слишком длинный.",
  "The two passwords do not match.": "Пароли не совпадают.",
  "Your new password can't be the same as your old one.":
    "Новый пароль не должен совпадать со старым.",
  "This password is too weak. Choose a longer or less predictable one.":
    "Этот пароль слишком простой. Выберите более длинный или менее предсказуемый пароль.",
  "Too many attempts. Wait a few minutes and try again.":
    "Слишком много попыток. Подождите несколько минут и попробуйте снова.",
  "Something went wrong changing your password. Try again.":
    "Не удалось изменить пароль. Попробуйте снова.",
  "Choose a new password": "Выберите новый пароль",
  "Use at least 8 characters.": "Используйте не менее 8 символов.",
  "New password": "Новый пароль",
  "Repeat new password": "Повторите новый пароль",
  "Change password": "Изменить пароль",
  "Password updated. Sign in with your new password.":
    "Пароль обновлён. Войдите с новым паролем.",
  "Reset your password": "Сброс пароля",
  "Click below to choose a new password.":
    "Нажмите ниже, чтобы выбрать новый пароль.",
  Continue: "Продолжить",
  "Adjust this draft": "Изменить этот черновик",
  "You can change these amounts until you prepare the invoice.":
    "Эти суммы можно менять, пока счёт не подготовлен.",
  "Calculated late fee": "Рассчитанная плата за просрочку",
  "Applied late fee": "Применённая плата за просрочку",
  "New late fee amount": "Новая сумма платы за просрочку",
  "Update late fee": "Обновить плату за просрочку",
  "Bank processing delay": "Задержка обработки платежа банком",
  "Billing dispute": "Спор по счёту",
  "Meter issue": "Проблема со счётчиком",
  "Agreement with resident": "Договорённость с жильцом",
  "Administrative waiver": "Списание по решению администрации",
  "Note (required when the reason is Other)":
    "Примечание (обязательно, если причина — «Другое»)",
  "Adjustment amount": "Сумма корректировки",
  "A negative amount lowers the amount due.":
    "Отрицательная сумма уменьшает сумму к оплате.",
  "Save adjustment": "Сохранить корректировку",
  "Late fee updated.": "Плата за просрочку обновлена.",
  "Adjustment saved.": "Корректировка сохранена.",
  "Override status": "Переопределить статус",
  "Use this only to correct a status that is wrong. The change is recorded with your reason.":
    "Используйте это только для исправления неверного статуса. Изменение записывается с указанием причины.",
  "Change the status of this invoice? This change is recorded in the audit log.":
    "Изменить статус этого счёта? Это изменение записывается в журнал аудита.",
  "New status": "Новый статус",
  "Choose a status": "Выберите статус",
  "Status changed.": "Статус изменён.",
  "Installed on": "Дата установки",
  "Invoice total due": "Итого к оплате по счёту",
  "Paid so far": "Оплачено на данный момент",
  "Amount still due": "Осталось оплатить",
  "All entity types": "Все типы объектов",
  "All actors": "Все пользователи",
  "From date": "Дата с",
  "To date": "Дата по",
  Enable: "Включить",
  Disable: "Отключить",
  "Account disabled": "Аккаунт отключён",
  "Disable this account? The person cannot sign in until you enable it again.":
    "Отключить этот аккаунт? Пользователь не сможет войти, пока вы не включите его снова.",
  "Invoice, reference or payer": "Счёт, назначение платежа или плательщик",
  "No payments match these filters.":
    "Нет платежей, соответствующих этим фильтрам.",
  of: "из",
  "How do I waive a late fee or adjust a draft invoice?":
    "Как отменить плату за просрочку или изменить черновик счёта?",
  "Open the DRAFT invoice. Use the Adjust this draft panel. Enter a reason for each change. You cannot adjust an invoice after you prepare it.":
    "Откройте счёт со статусом «Черновик». Используйте панель «Изменить этот черновик». Укажите причину каждого изменения. После подготовки счёт изменить нельзя.",
  "How do I fix a wrong invoice status?":
    "Как исправить неверный статус счёта?",
  "Open the invoice. Use the Override status panel. Choose the correct status and enter a reason. The system records the change in the audit log. The list always offers DRAFT, PREPARED, and OVERDUE. It offers SENT only if the invoice was sent, and PAID only if the invoice is paid.":
    "Откройте счёт. Используйте панель «Переопределить статус». Выберите правильный статус и введите причину. Система записывает изменение в журнал аудита. В списке всегда предлагаются «Черновик», «Подготовлен» и «Просрочен». «Отправлен» предлагается, только если счёт был отправлен, а «Оплачен» — только если счёт оплачен.",
  "How do I disable a resident's access?": "Как отключить доступ жильца?",
  "Open the dwelling. Click Disable next to the resident. The resident cannot access the system until you click Enable. You cannot disable an administrator or a resident who has access to another organization.":
    "Откройте помещение. Нажмите «Отключить» рядом с жильцом. Жилец не сможет пользоваться системой, пока вы не нажмёте «Включить». Нельзя отключить администратора или жильца, у которого есть доступ к другой организации.",
  "What does a resident see on an invoice?": "Что жилец видит в счёте?",
  "The resident sees the invoice, the amount that they paid, and the amount that they still owe.":
    "Жилец видит счёт, уплаченную сумму и сумму, которую ещё нужно оплатить.",
  "How do I identify who changed something?": "Как узнать, кто что изменил?",
  "Open the audit log. Filter by action, entity type, actor, or date. Click Export CSV to download the rows that match. The file holds up to 5,000 rows.":
    "Откройте журнал аудита. Фильтруйте по действию, типу объекта, пользователю или дате. Нажмите «Экспорт CSV», чтобы скачать подходящие строки. В файле не более 5000 строк.",
  Reversed: "Отменён",
  Reverse: "Отменить",
  "Reason for reversal": "Причина отмены",
  "Reverse payment": "Отменить платёж",
  "Reverse this payment? The original payment stays in the history and a cancelling entry is added. The invoice becomes unpaid again.":
    "Отменить этот платёж? Исходный платёж останется в истории, и будет добавлена сторнирующая запись. Счёт снова станет неоплаченным.",
  "Choose an invoice": "Выберите счёт",
  "Match to invoice": "Привязать к счёту",
  "Match this payment to the chosen invoice? The payment is applied right away.":
    "Привязать этот платёж к выбранному счёту? Платёж будет зачтён сразу.",
  "Record a payment": "Зарегистрировать платёж",
  "Record payment": "Зарегистрировать платёж",
  "Use this for a bank transfer that is not in an imported statement. The payment is applied right away.":
    "Используйте эту функцию, чтобы зарегистрировать банковский перевод, которого нет в импортированной выписке. Платёж будет зачтён сразу.",
  "Bank reference": "Банковское назначение платежа",
  "Record this payment? It is applied to the invoice right away.":
    "Зарегистрировать этот платёж? Он будет сразу зачтён в оплату счёта.",
  "Payment reversed.": "Платёж отменён.",
  "Payment matched.": "Платёж привязан.",
  "Payment recorded.": "Платёж зарегистрирован.",
  "How do I record a payment that is not in a bank statement?":
    "Как зарегистрировать платёж, которого нет в банковской выписке?",
  "Click Record a payment on the Payments page. Choose the invoice. Enter the amount, date, payer, bank reference, and a reason. The payment applies right away. The app blocks a second entry with the same reference, amount, and date. You can record bank transfers only.":
    "На странице «Платежи» нажмите «Зарегистрировать платёж». Выберите счёт. Введите сумму, дату, плательщика, банковское назначение платежа и причину. Платёж применяется сразу. Приложение блокирует повторную запись с тем же назначением, суммой и датой. Можно регистрировать только банковские переводы.",
  "How do I undo a payment that I matched to the wrong invoice?":
    "Как отменить платёж, который я сопоставил с неверным счётом?",
  "Open the Confirmed tab on the Payments page. Click Reverse next to the payment and enter a reason. The original payment stays in the history. The invoice becomes unpaid again. The payment returns to the Unmatched tab. There you can match it to the correct invoice. You cannot reverse a payment if a later invoice already used its credit.":
    "На странице «Платежи» откройте вкладку «Подтверждён». Нажмите «Отменить» рядом с платежом и введите причину. Исходный платёж остаётся в истории. Счёт снова становится неоплаченным. Платёж возвращается на вкладку «Не сопоставлен». Там его можно сопоставить с нужным счётом. Нельзя отменить платёж, если более поздний счёт уже использовал его кредит.",
  "The CSV file is too large (up to 2 MB).":
    "Файл CSV слишком большой (до 2 МБ).",
  "The CSV file has too many rows (up to 5,000).":
    "В файле CSV слишком много строк (до 5 000).",
  "Too many requests. Try again in a minute.":
    "Слишком много запросов. Попробуйте снова через минуту.",
  "An explanation is required when reason is Other":
    "Если причина — «Другое», требуется пояснение",
  "Late fee cannot be negative":
    "Плата за просрочку не может быть отрицательной",
  "Invoice not found": "Счёт не найден",
  "A prepared or sent invoice cannot have its financial statement changed":
    "У подготовленного или отправленного счёта нельзя изменить финансовый отчёт",
  "Applied late fee cannot exceed the calculated amount":
    "Применённая плата за просрочку не может превышать рассчитанную сумму",
  "A reason is required": "Необходимо указать причину",
  "Adjustment amount must be positive":
    "Сумма корректировки должна быть положительной",
  "Charges and late fees cannot be negative":
    "Начисления и плата за просрочку не могут быть отрицательными",
  "Account entry was not created": "Запись по счёту не была создана",
  "Dwelling not found": "Помещение не найдено",
  "A late-fee policy already exists for this effective date":
    "Для этой даты вступления в силу политика платы за просрочку уже существует",
  "Organization not found": "Организация не найдена",
  "Billing period not found": "Расчётный период не найден",
  "This billing period is locked": "Этот расчётный период закрыт",
  "No billing case exists for this dwelling in this period":
    "Для этого помещения в этом периоде нет расчётной записи",
  "This dwelling has missing data for this period and cannot be invoiced yet":
    "У этого помещения отсутствуют данные за этот период, и для него пока нельзя выставить счёт",
  "No billing rules apply to this dwelling for this period":
    "К этому помещению в этом периоде не применяется ни одно правило расчёта",
  "A billing rule assigned to this dwelling has no active meter for this period":
    "У назначенного этому помещению правила расчёта нет активного счётчика в этом периоде",
  "No billing rule applies": "Не применяется ни одно правило расчёта",
  "no active meter": "нет активного счётчика",
  "This invoice has already been sent and can no longer be regenerated; issue a correction document instead":
    "Этот счёт уже отправлен, и его больше нельзя пересчитать; оформите вместо этого корректирующий документ",
  "This invoice has already moved past DRAFT and can no longer be regenerated":
    "Этот счёт уже вышел из статуса «Черновик», и его больше нельзя пересчитать",
  "Only a DRAFT invoice can be prepared":
    "Подготовить можно только счёт в статусе «Черновик»",
  "Issuer details are incomplete; update organization settings before preparing":
    "Реквизиты организации заполнены не полностью; обновите настройки организации перед подготовкой",
  "This dwelling is missing a billing/occupant name or a billing address":
    "У этого помещения отсутствует имя для счетов/жильца или адрес для счетов",
  "Organization payment details are incomplete (both bank name and IBAN are required)":
    "Платёжные реквизиты организации заполнены не полностью (требуются и наименование банка, и IBAN)",
  "A reason is required for a manual status override":
    "Для ручного переопределения статуса необходимо указать причину",
  "Billing case not found": "Расчётная запись не найдена",
  "A case can be set to Sent only when its invoice was sent":
    "Запись можно перевести в статус «Отправлен» только тогда, когда её счёт был отправлен",
  "A case can be set to Paid only when its invoice is paid":
    "Запись можно перевести в статус «Оплачен» только тогда, когда её счёт оплачен",
  "A case that already has an invoice cannot go back to Missing data or Ready":
    "Запись, у которой уже есть счёт, нельзя вернуть в статус «Нет данных» или «Готов»",
  "Invalid or expired invoice link":
    "Ссылка на счёт недействительна или срок её действия истёк",
  "A meter consumption rule requires a meter type":
    "Для правила «Расход по счётчику» требуется тип счётчика",
  "This rule requires a unit price (it would otherwise always bill 0)":
    "Для этого правила требуется цена за единицу (иначе по нему всегда будет начисляться 0)",
  "A rule that applies to all dwellings cannot also have specific dwelling assignments":
    "Правило, применяемое ко всем помещениям, не может одновременно иметь привязку к конкретным помещениям",
  "A one-to-one rule must be assigned to exactly one dwelling":
    "Правило «один к одному» должно быть назначено ровно одному помещению",
  "A selected-dwellings rule must be assigned to at least one dwelling":
    "Правило для выбранных помещений должно быть назначено как минимум одному помещению",
  "One or more selected dwellings do not belong to this organization":
    "Одно или несколько выбранных помещений не принадлежат этой организации",
  "Billing rule not found": "Правило расчёта не найдено",
  "Invoice send attempt not found": "Попытка отправки счёта не найдена",
  "This dwelling has no electronic delivery method enabled; use Record paper dispatch instead.":
    "Для этого помещения не включён ни один электронный способ доставки; используйте вместо этого «Зафиксировать отправку на бумаге».",
  "Invoice email is missing. Add a billing email before resending.":
    "Не указана эл. почта для счетов. Добавьте её перед повторной отправкой.",
  "This invoice has not been sent by email yet; use Send instead.":
    "Этот счёт ещё не был отправлен по эл. почте; используйте вместо этого «Отправить».",
  "A delivery attempt is currently in progress for this invoice; wait for it to finish before resending.":
    "Для этого счёта сейчас выполняется попытка доставки; дождитесь её завершения перед повторной отправкой.",
  "Paper delivery is not enabled for this dwelling":
    "Для этого помещения доставка на бумаге не включена",
  "SEPA QR codes are EUR-only": "SEPA QR-коды поддерживают только EUR",
  "A BIC is required to generate a SEPA QR code":
    "Для создания SEPA QR-кода требуется BIC",
  "Invalid BIC": "Недействительный BIC",
  "Invalid IBAN": "Недействительный IBAN",
  "Amount is out of the SEPA QR's representable range":
    "Сумма выходит за пределы допустимого диапазона SEPA QR",
  "A beneficiary name is required":
    "Необходимо указать наименование получателя",
  "Beneficiary name exceeds the SEPA QR's 70-character limit":
    "Наименование получателя превышает лимит SEPA QR в 70 символов",
  "Remittance information exceeds the SEPA QR's 140-character limit":
    "Информация о платеже превышает лимит SEPA QR в 140 символов",
  "SEPA QR payload exceeds the 331-byte limit":
    "Размер данных SEPA QR превышает лимит в 331 байт",
  "Conversation not found": "Переписка не найдена",
  "This request key was already used": "Этот ключ запроса уже был использован",
  "Select at least one invoice delivery method (email or paper)":
    "Выберите хотя бы один способ доставки счёта (по эл. почте или на бумаге)",
  "The original item is no longer present":
    "Исходный элемент больше не существует",
  "The original access grant is no longer present":
    "Исходные права доступа больше не существуют",
  "You cannot disable your own account":
    "Вы не можете отключить свой собственный аккаунт",
  "Resident not found": "Жилец не найден",
  "This person also has access in another organization, so you cannot disable the account":
    "Этот человек также имеет доступ в другой организации, поэтому вы не можете отключить аккаунт",
  "Administrators cannot be disabled here. Remove the administrator on the Users page":
    "Администраторов нельзя отключить здесь. Удалите администратора на странице «Пользователи и доступ»",
  "The original meter is no longer present":
    "Исходный счётчик больше не существует",
  "Meter not found": "Счётчик не найден",
  "An archived meter cannot be edited": "Архивный счётчик нельзя редактировать",
  "The unit cannot change after readings exist. Archive this meter and add a new one.":
    "Единицу измерения нельзя изменить, если уже есть показания. Архивируйте этот счётчик и добавьте новый.",
  "Auto-send day is required when auto-send is enabled":
    "День автоотправки обязателен, когда включена автоотправка",
  "Cannot remove the last admin of an organization":
    "Нельзя удалить последнего администратора организации",
  "This file has already been imported for this organization.":
    "Этот файл уже был импортирован для этой организации.",
  "Bank import not found": "Банковский импорт не найден",
  "Bank transaction not found": "Банковская операция не найдена",
  "This payment is already matched": "Этот платёж уже привязан",
  "This payment was reversed from this invoice. Choose a different invoice":
    "Этот платёж был отменён для этого счёта. Выберите другой счёт",
  "This invoice cannot receive a payment":
    "К этому счёту нельзя привязать платёж",
  "This invoice is already fully allocated":
    "Этот счёт уже полностью распределён",
  "Amount must be greater than 0": "Сумма должна быть больше 0",
  "Enter a valid booking date (YYYY-MM-DD)":
    "Введите корректную дату проводки (YYYY-MM-DD)",
  "Reference must be between 1 and 140 characters":
    "Назначение платежа должно содержать от 1 до 140 символов",
  "Payer name must be up to 140 characters":
    "Имя плательщика должно содержать до 140 символов",
  "A reason is required (up to 500 characters)":
    "Необходимо указать причину (до 500 символов)",
  "Booking date cannot be in the future":
    "Дата проводки не может быть в будущем",
  "A payment with this reference, amount, and date already exists":
    "Платёж с таким назначением, суммой и датой уже существует",
  "Payment match not found": "Сопоставление платежа не найдено",
  "This match was rejected and cannot be confirmed":
    "Это сопоставление было отклонено и не может быть подтверждено",
  "This payment is already applied to another invoice":
    "Этот платёж уже привязан к другому счёту",
  "This invoice is already paid": "Этот счёт уже оплачен",
  "This match has already been confirmed and cannot be rejected":
    "Это сопоставление уже подтверждено и не может быть отклонено",
  "Only a confirmed payment can be reversed":
    "Отменить можно только подтверждённый платёж",
  "The credit from this payment was already used on a later invoice. Fix the balance with an adjustment":
    "Кредит по этому платежу уже был использован для оплаты более позднего счёта. Исправьте баланс с помощью корректировки",
  "Value must be a non-negative number with at most 4 decimal places":
    "Значение должно быть неотрицательным числом не более чем с 4 знаками после запятой",
  "Current value must be a non-negative number with at most 3 decimal places":
    "Текущее значение должно быть неотрицательным числом не более чем с 3 знаками после запятой",
  "The reading deadline for this period has passed":
    "Срок подачи показаний за этот период истёк",
  "Cannot record a reading for an archived meter":
    "Нельзя внести показание по архивному счётчику",
  "Cannot edit this reading: a later billing period already recorded a reading for this meter":
    "Нельзя отредактировать это показание: в более позднем расчётном периоде уже внесено показание по этому счётчику",
  "What's this about?": "О чём ваше сообщение?",
  "The previous delivery attempt's outcome could not be confirmed. Verify whether the invoice was actually delivered, then use Resend if it needs to go out again.":
    "Результат предыдущей попытки доставки не удалось подтвердить. Проверьте, был ли счёт доставлен, и, если его нужно отправить снова, используйте «Отправить повторно».",
  "Invoices prepared by the end of this day are sent on this day. The app tries a failed send again on the next days.":
    "Счета, подготовленные до конца этого дня, отправляются в тот же день. Если отправка не удалась, приложение повторяет попытку в последующие дни.",
  "This email address bounced or reported a complaint. Change the billing email or remove it from the suppressed list":
    "На этот адрес эл. почты не удалось доставить письмо или на него поступила жалоба. Измените эл. почту для счетов или удалите адрес из списка заблокированных",
  "Suppressed address not found": "Заблокированный адрес не найден",
  "Suppressed email addresses": "Заблокированные адреса эл. почты",
  "Addresses that bounced or reported a complaint.":
    "Адреса, на которые не удалось доставить письма или с которых поступила жалоба.",
  "Invoices are not sent to these addresses. The email provider reported a permanent bounce or a complaint. Remove an address after you fix the problem.":
    "На эти адреса счета не отправляются. Почтовый сервис сообщил о постоянной ошибке доставки или о жалобе. Удалите адрес после устранения проблемы.",
  "Address removed.": "Адрес удалён.",
  "No suppressed email addresses.": "Нет заблокированных адресов эл. почты.",
  "Email address": "Адрес эл. почты",
  Added: "Добавлено",
  Bounce: "Ошибка доставки",
  Complaint: "Жалоба",
  "Remove this address from the suppressed list? Invoices can be sent to it again.":
    "Удалить этот адрес из списка заблокированных? На него снова можно будет отправлять счета.",
  "Remove from list": "Удалить из списка",
  "Only an incoming payment can be applied to an invoice":
    "К счёту можно привязать только входящий платёж",
  "Administrators sign in with a password. Use the Admin sign in form on this page.":
    "Администраторы входят по паролю. Используйте форму входа для администраторов на этой странице.",
  "Request ID": "ID запроса",
  "Audit log entries": "Записи журнала аудита",
  "Billing rules": "Правила расчётов",
  "Dwellings to import": "Помещения для импорта",
  "Imported payments": "Импортированные платежи",
  "Payment matches": "Сопоставления платежей",
  "Payments to import": "Платежи для импорта",
  "Unmatched payments": "Несопоставленные платежи",
  "What happens when an invoice email bounces?":
    "Что происходит, если письмо со счётом не доставлено?",
  "The email provider tells the app about a permanent bounce or a complaint. The app adds the address to the suppressed list and sends no more invoices to it. Open Settings, then Suppressed email addresses. Fix the billing email, or remove the address from the list.":
    "Почтовый сервис сообщает приложению о постоянной ошибке доставки или о жалобе. Приложение добавляет адрес в список заблокированных и больше не отправляет на него счета. Откройте «Настройки», затем «Заблокированные адреса эл. почты». Исправьте эл. почту для счетов или удалите адрес из списка.",
  "Why does a sign-in link not work for me as an administrator?":
    "Почему у меня как администратора не работает ссылка для входа?",
  "Administrators sign in with a password. Use the Admin sign in form. A sign-in link works for residents only. Click Forgot password? if you do not know your password.":
    "Администраторы входят с паролем. Используйте форму «Вход для администраторов». Ссылка для входа работает только для жильцов. Если вы не знаете пароль, нажмите «Забыли пароль?».",
  "This organization is archived. Restore it in Settings to make changes.":
    "Эта организация в архиве. Чтобы вносить изменения, восстановите её в настройках.",
  "A reason of 1 to 500 characters is required":
    "Нужна причина длиной от 1 до 500 символов",
  "This organization is closed": "Эта организация закрыта",
  "Your property manager has closed this account. You cannot see invoices or send messages here. Contact your property manager for help.":
    "Ваш управляющий закрыл этот аккаунт. Здесь нельзя просматривать счета или отправлять сообщения. Обратитесь за помощью к своему управляющему.",
  "This organization is archived. You can read it but not change it. Residents cannot sign in. Restore it in Settings > Organization.":
    "Эта организация в архиве. Её можно просматривать, но нельзя менять. Жильцы не могут войти. Восстановите её в разделе «Настройки» > «Организация».",
  "Archive organization": "Архивировать организацию",
  "Restore organization": "Восстановить организацию",
  "This organization is archived. Restore it to make changes and to let residents sign in again.":
    "Эта организация в архиве. Восстановите её, чтобы вносить изменения и чтобы жильцы снова могли войти.",
  "Archiving makes this organization read-only. Residents cannot sign in and their invoice links stop working. You can restore it later.":
    "Архивирование делает эту организацию доступной только для чтения. Жильцы не могут войти, а ссылки на их счета перестают работать. Позже её можно восстановить.",
  "Archive this organization? Residents cannot sign in until you restore it.":
    "Архивировать эту организацию? Жильцы не смогут войти, пока вы её не восстановите.",
  "What can a resident change in the portal?":
    "Что жилец может изменить на портале?",
  "A resident can change the display name on the Profile page. The email address cannot change. To use a new address, add the resident again with the new address. A resident can also click Download my data on the Profile page. The Payment history page shows each payment and each reversal. It does not show the payer name, the bank account, the reference, or the reason for a reversal.":
    "Жилец может изменить отображаемое имя на странице «Профиль». Адрес электронной почты изменить нельзя. Чтобы использовать новый адрес, добавьте жильца заново с новым адресом. Жилец также может нажать «Скачать мои данные» на странице «Профиль». Страница «История платежей» показывает каждый платёж и каждую отмену. Она не показывает имя плательщика, банковский счёт, назначение платежа и причину отмены.",
  "How do I download the data that the app holds about a resident?":
    "Как скачать данные, которые приложение хранит о жильце?",
  "Open the dwelling page. Find the resident and click Export data. The app downloads one JSON file. The file has the data of this person in your organization: the dwelling details, sent invoices, payments, account entries, meter readings, messages, and the actions of the person in the app. It does not have bank account numbers, the email addresses of other people, or the data of dwellings that the person cannot use. The app writes an audit event for each download.":
    "Откройте страницу помещения. Найдите жильца и нажмите «Экспортировать данные». Приложение скачивает один файл JSON. В файле есть данные этого человека в вашей организации: сведения о помещении, отправленные счета, платежи, записи по счёту, показания счётчиков, сообщения и действия человека в приложении. В файле нет номеров банковских счетов, адресов электронной почты других людей и данных помещений, к которым у человека нет доступа. Приложение записывает событие аудита для каждого скачивания.",
  "How do I archive an organization?": "Как архивировать организацию?",
  "Open Settings, then Organization. In the Archive organization box, enter a reason and click Archive organization. Confirm the message. The organization becomes read-only. You can read every page, but you cannot change anything. Residents cannot sign in. The links in old invoice emails stop working. The scheduled jobs stop. The app does not delete any data.":
    "Откройте «Настройки», затем «Организация». В блоке «Архивировать организацию» введите причину и нажмите «Архивировать организацию». Подтвердите сообщение. Организация становится доступной только для чтения. Вы можете просматривать каждую страницу, но ничего не можете изменить. Жильцы не могут войти. Ссылки в старых письмах со счетами перестают работать. Запланированные задания останавливаются. Приложение не удаляет никаких данных.",
  "How do I restore an archived organization?":
    "Как восстановить архивированную организацию?",
  "Open Settings, then Organization. Click Restore organization. The organization works as before. Residents can sign in again. The links in old invoice emails work again.":
    "Откройте «Настройки», затем «Организация». Нажмите «Восстановить организацию». Организация работает как раньше. Жильцы снова могут войти. Ссылки в старых письмах со счетами снова работают.",
  "Person not found": "Человек не найден",
  "unread conversations": "непрочитанных бесед",
  "Payment history": "История платежей",
  "No payments yet.": "Платежей пока нет.",
  "Display name": "Отображаемое имя",
  "Enter a name of 1 to 100 characters.":
    "Введите имя длиной от 1 до 100 символов.",
  "Export data": "Экспортировать данные",
  "Your data": "Ваши данные",
  "Download a copy of the data this service holds about you, as a JSON file.":
    "Скачайте копию данных о вас, которые хранит этот сервис, в виде файла JSON.",
  "Download my data": "Скачать мои данные",
  "All changes saved": "Все изменения сохранены",
  "Send this invoice to the resident by email now? Sent invoices cannot be edited.":
    "Отправить этот счёт жильцу по электронной почте сейчас? Отправленные счета нельзя редактировать.",
  "Send this invoice to the resident again by email?":
    "Повторно отправить этот счёт жильцу по электронной почте?",
  "Revoke the resident's access link? They will no longer be able to open this invoice with it.":
    "Отозвать ссылку доступа жильца? С её помощью больше нельзя будет открыть этот счёт.",
  "Record that this invoice was physically posted? This cannot be undone.":
    "Отметить, что этот счёт отправлен по почте? Это нельзя отменить.",
  "Send all selected invoices to residents by email now? Sent invoices cannot be edited.":
    "Отправить все выбранные счета жильцам по электронной почте сейчас? Отправленные счета нельзя редактировать.",
  "Archive this tariff? It will no longer be used for new invoices.":
    "Архивировать этот тариф? Он больше не будет использоваться для новых счетов.",
  "Invoice prepared.": "Счёт подготовлен.",
  "Invoice sent.": "Счёт отправлен.",
  "Sending has not finished yet. Check the delivery status.":
    "Отправка ещё не завершена. Проверьте статус доставки.",
  "Resend submitted. Check the delivery status.":
    "Повторная отправка запущена. Проверьте статус доставки.",
  "Access link revoked.": "Ссылка доступа отозвана.",
  "Paper dispatch recorded.": "Отправка по почте отмечена.",
  "1 change saving": "Сохраняется 1 изменение",
  "{n} changes saving": "Сохраняется изменений: {n}",
  "1 change needs attention": "1 изменение требует внимания",
  "{n} changes need attention": "Изменений, требующих внимания: {n}",
  "Recent changes": "Недавние изменения",
  "Adding…": "Добавление…",
  "Adding meter…": "Добавление счётчика…",
  "Could not add meter": "Не удалось добавить счётчик",
  "Adding resident…": "Добавление жильца…",
  "Could not add resident": "Не удалось добавить жильца",
  "Removing resident…": "Удаление жильца…",
  "Resident removed": "Жилец удалён",
  "Creating dwelling…": "Создание помещения…",
  "Dwelling created": "Помещение создано",
  "Could not create dwelling": "Не удалось создать помещение",
  "Saving dwelling information…": "Сохранение информации о помещении…",
  "Could not save dwelling information":
    "Не удалось сохранить информацию о помещении",
  "Saving delivery preferences…": "Сохранение настроек доставки…",
  "Delivery preferences saved": "Настройки доставки сохранены",
  "Could not save delivery preferences":
    "Не удалось сохранить настройки доставки",
  "Could not save": "Не удалось сохранить",
  "Saved, but the view could not be updated":
    "Сохранено, но не удалось обновить отображение",
  Retry: "Повторить",
  "Archiving…": "Архивация…",
  Sections: "Разделы",
  "Send a printed copy by mail": "Отправить печатную копию по почте",
  "Send invoices to": "Отправлять счета по адресу",
  "Something went wrong. Please try again.":
    "Что-то пошло не так. Попробуйте ещё раз.",
  "This dwelling's billing case in every period it has existed for.":
    "Расчётная запись этого помещения за каждый период его существования.",
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
    "Начислять плату за просрочку по просроченным счетам.",
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
    "Поддерживайте свои данные в актуальном состоянии, чтобы счета и платежи обрабатывались, а официальная переписка велась без задержек.",
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
    "Так данные вашей организации будут отображаться в счетах.",
  "Type your reply...": "Введите ответ...",
  "Unique identifier (e.g. cold_water).":
    "Уникальный идентификатор (например, cold_water).",
  "Unit of measurement.": "Единица измерения.",
  "Use fixed rules for regular charges like maintenance fees. The amount is the same each period (per unit).":
    "Используйте фиксированные правила для регулярных начислений, например платы за обслуживание. Сумма одинакова в каждом периоде (за единицу).",
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
  "Add the legal name, address, contact details, bank name, IBAN, registration number, and VAT number used on invoices.":
    "Укажите юридическое наименование, адрес, контактные данные, название банка, IBAN, регистрационный номер и номер плательщика НДС, используемые в счетах.",
  "Ready when the invoice issuer and payment details are complete.":
    "Готово, когда данные выставителя счёта и реквизиты для оплаты заполнены.",
  "Click Create dwelling to add one dwelling, or import a CSV file for many. Check each number, type, occupant, area, and resident count. A new dwelling joins every currently open billing period.":
    "Нажмите «Создать помещение», чтобы добавить одно помещение, или импортируйте CSV-файл, чтобы добавить несколько. Проверьте номер, тип, жильца, площадь и число жильцов каждого помещения. Новое помещение включается во все открытые в данный момент расчётные периоды.",
  "Open tariffs & rules": "Открыть тарифы и правила",
  "Why do some actions ask me to confirm?":
    "Почему некоторые действия требуют подтверждения?",
  "The Send, Resend, Revoke access link, and Record paper dispatch actions require confirmation. The Archive, Remove, Disable, Override status, Confirm payment, Reverse payment, Match to invoice, and Record payment actions also require confirmation. Confirmation helps prevent changes that are difficult to undo.":
    "Отправка и повторная отправка счёта, отзыв ссылки доступа и регистрация отправки на бумаге требуют подтверждения. Архивирование, удаление, отключение, переопределение статуса, подтверждение платежа, отмена платежа, привязка к счёту и регистрация платежа также требуют подтверждения. Это помогает избежать изменений, которые трудно отменить.",
  "What if I forget my password?": "Что делать, если вы забыли пароль?",
  "Click Forgot password? on the sign-in page. Enter your email address. Follow the link in the email to set a new password.":
    "На странице входа нажмите «Забыли пароль?». Введите свой адрес электронной почты. Перейдите по ссылке из письма, чтобы задать новый пароль.",
  "Ready when every billable unit appears in the dwelling list.":
    "Готово, когда все расчётные единицы отображаются в списке помещений.",
  "Dwelling list with filters and dwelling details.":
    "Список помещений с фильтрами и подробными данными.",
  "Open each dwelling. Assign resident access. Add billing contact details. Register its meters. You can edit a meter later, but you cannot change its unit of measurement after a reading exists.":
    "Откройте каждое помещение. Предоставьте жильцу доступ. Добавьте контактные данные для выставления счетов. Зарегистрируйте счётчики помещения. Позже счётчик можно изменить, но после внесения первого показания изменить единицу измерения нельзя.",
  "Ready when residents can access their dwelling and all meters are listed.":
    "Готово, когда жильцы могут получить доступ к своему помещению и все счётчики внесены в список.",
  "Dwelling detail page with resident access and meter registration.":
    "Страница сведений о помещении с доступом жильца и регистрацией счётчиков.",
  "Set tariffs and rules": "Настройте тарифы и правила",
  "Add the billing rules that set fixed, area, resident-count, or meter-consumption charges.":
    "Добавьте правила начисления, которые задают фиксированную плату, плату за площадь, за число жильцов или за расход по счётчикам.",
  "Tariffs and rules list with rule details.":
    "Список тарифов и правил с подробными данными.",
  "Set the billing window, reading deadline, invoice issue date, and due date. A new period creates a case for each active dwelling. Residents can submit readings through the deadline date in the organization time zone. Administrators can enter readings later.":
    "Задайте расчётный период, срок подачи показаний, дату выставления счёта и срок оплаты. Новый период создаёт дело для каждого активного помещения. Жильцы могут подавать показания до конца установленной даты по часовому поясу организации. Администраторы могут вносить показания и позже.",
  "Ready when the new OPEN period appears in the period list.":
    "Готово, когда новый ОТКРЫТЫЙ период появится в списке периодов.",
  "Billing period list and period actions.":
    "Список расчётных периодов и действия с периодами.",
  "Use the dashboard attention list or the monthly workbench to find missing readings. Residents can also submit readings when allowed.":
    "Используйте список требующих внимания дел на панели управления или ежемесячную рабочую область, чтобы найти недостающие показания. Жильцы также могут подавать показания, если это разрешено.",
  "Generate eligible invoices in the workbench. Review the calculation lines, recipient details, dates, and totals. You can waive the late fee or add a manual adjustment only before you prepare a DRAFT invoice.":
    "Сформируйте подходящие счета в рабочей области. Проверьте строки расчёта, данные получателя, даты и итоговые суммы. Плату за просрочку можно отменить или добавить ручную корректировку только до подготовки счёта со статусом «Черновик».",
  "Ready when correct invoices are in DRAFT and you have fixed all validation blockers.":
    "Готово, когда верные счета имеют статус ЧЕРНОВИК и все ошибки проверки устранены.",
  "Monthly workbench with the billing workflow and case list.":
    "Ежемесячная рабочая область с рабочим процессом выставления счетов и списком дел.",
  "Prepare approved drafts. Send the prepared invoices. Delivery moves each case to SENT and locks the invoice. With automatic sending on, the app sends the invoices that you prepared by the end of the send day. It tries again on the next days if a send fails.":
    "Подготовьте одобренные черновики. Отправьте подготовленные счета. Доставка переводит каждое дело в статус ОТПРАВЛЕНО и блокирует счёт. Если автоматическая отправка включена, приложение отправляет подготовленные вами счета до конца дня отправки. Если отправка не удалась, оно повторяет попытку в следующие дни.",
  "Ready when sent invoices show SENT, or show a clear delivery error to fix.":
    "Готово, когда отправленные счета имеют статус ОТПРАВЛЕНО либо для них отображается понятная ошибка доставки, которую нужно исправить.",
  "Import a bank statement. Check the preview. Confirm the import. Review proposed or unmatched payments. Use the search box and date fields to find a payment in the selected view. You can also record a payment by hand, reverse a wrong payment, or match an unmatched payment.":
    "Импортируйте банковскую выписку. Проверьте предварительный просмотр. Подтвердите импорт. Просмотрите предложенные или несопоставленные платежи. Используйте поле поиска и поля дат, чтобы найти платёж в выбранном разделе. Вы также можете внести платёж вручную, отменить ошибочный платёж или сопоставить несопоставленный платёж со счётом.",
  "Ready when you have confirmed valid matches and the matching invoices show PAID.":
    "Готово, когда верные сопоставления подтверждены, а соответствующие счета имеют статус ОПЛАЧЕНО.",
  "Review resident messages, overdue invoices, unmatched payments, and delivery failures. Resolve each conversation once its issue is fixed.":
    "Просматривайте сообщения жильцов, просроченные счета, несопоставленные платежи и ошибки доставки. После устранения проблемы отмечайте переписку как решённую.",
  "Ready when every attention item has an owner or is resolved.":
    "Готово, когда у каждого требующего внимания пункта есть ответственный или он решён.",
  "Messages inbox with a resident conversation open.":
    "Входящие сообщения с открытой перепиской с жильцом.",
  "MISSING DATA means something blocks the invoice: a required input is missing, a rule has no active meter, or no billing rule applies. READY means the invoice can be generated. DRAFT means you can still review and regenerate it. PREPARED is approved and ready to send. SENT means delivery succeeded. OVERDUE means the due date passed unpaid. PAID means the invoice is fully paid.":
    "MISSING DATA означает, что счёту что-то препятствует: отсутствуют обязательные данные, у правила нет активного счётчика или не применяется ни одно правило расчёта. READY означает, что счёт можно сформировать. DRAFT означает, что счёт ещё можно проверить и сформировать заново. PREPARED означает, что счёт одобрен и готов к отправке. SENT означает, что доставка прошла успешно. OVERDUE означает, что срок оплаты истёк, а счёт не оплачен. PAID означает, что счёт оплачен полностью.",
  "Why can I not generate an invoice?": "Почему я не могу сформировать счёт?",
  "The system blocks generation when required inputs are missing or the period is locked. Open the affected dwelling in the workbench to see what is missing.":
    "Система блокирует формирование, если отсутствуют обязательные данные или период заблокирован. Откройте соответствующее помещение в рабочей области, чтобы увидеть, чего не хватает.",
  "Why can I not prepare an invoice?": "Почему я не могу подготовить счёт?",
  "The invoice must be a DRAFT with complete issuer, recipient, and payment details. Fix the related settings. Regenerate the draft to update its snapshot.":
    "Счёт должен иметь статус ЧЕРНОВИК и содержать полные данные выставителя, получателя и реквизиты для оплаты. Исправьте соответствующие настройки. Сформируйте черновик заново, чтобы обновить сохранённые в нём данные.",
  "Why can I not send an invoice?": "Почему я не могу отправить счёт?",
  "You can send email to a PREPARED invoice. You can also send it to a SENT, PAID, or OVERDUE invoice that first used paper delivery. The invoice needs a billing email. If delivery fails, fix the cause, then retry or resend.":
    "Вы можете отправить счёт со статусом PREPARED по электронной почте. Также можно отправить счёт со статусом SENT, PAID или OVERDUE, если сначала он был отправлен по почте. Для счёта нужен адрес электронной почты. Если доставка не удалась, устраните причину, затем повторите попытку или отправьте счёт снова.",
  "No. A sent invoice is a permanent financial record and cannot change. Changes to dwellings, tariffs, or settings apply only to future invoices.":
    "Нет. Отправленный счёт — неизменяемый финансовый документ. Изменения в данных помещений, тарифах или настройках применяются только к будущим счетам.",
  "Review its amount, currency, payer, and reference. When you find the correct invoice, choose it in the Unmatched tab and click Match to invoice. The payment applies right away. Do not match a payment if you are not sure.":
    "Проверьте сумму, валюту, плательщика и назначение платежа. Когда найдёте нужный счёт, выберите его на вкладке «Несопоставленные» и нажмите «Привязать к счёту». Платёж будет учтён сразу. Не сопоставляйте платёж, если вы не уверены.",
  "Lock a period after its normal reading and invoice work is complete. A locked period stays available for history, but blocks reading edits and invoice regeneration.":
    "Блокируйте период после завершения обычной работы с показаниями и счетами. Заблокированный период остается доступным для истории, но не позволяет изменять показания и заново формировать счета.",
  "Required input is missing. Generation is blocked.":
    "Отсутствуют обязательные данные. Формирование заблокировано.",
  "Nothing blocks the invoice. You can now generate it.":
    "Ничто не блокирует счёт. Теперь вы можете сформировать его.",
  "You can still review and regenerate the invoice.":
    "Счёт ещё можно проверить и сформировать заново.",
  "Delivery succeeded.": "Доставка прошла успешно.",
  "The invoice is fully paid.": "Счёт оплачен полностью.",
  "The due date passed and the invoice is still unpaid.":
    "Срок оплаты истёк, а счёт до сих пор не оплачен.",
  "Awaiting reply": "Ожидает ответа",

  // Added: translation coverage pass 3 (settings hub card grid)
  "Core settings": "Основные настройки",
  "Administration tools": "Инструменты администрирования",
  "Automation, due dates, numbering, and defaults.":
    "Автоматизация, сроки оплаты, нумерация и настройки по умолчанию.",
  "Utility rates and billing calculation rules.":
    "Тарифы на коммунальные услуги и правила расчета счетов.",
  "Invoice appearance and document settings.":
    "Внешний вид счёта и настройки документа.",
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
    "Указанные здесь количества приведены для примера (всегда 1) и не отражают счёт реального жильца.",
  "Latvian is the canonical invoice language. English and Russian are optional translations; a missing translation falls back to Latvian.":
    "Латышский язык является каноническим языком счёта. Английский и русский — необязательные переводы; при отсутствии перевода используется латышский текст.",
  "Editing language": "Язык редактирования",
  "Latvian is the canonical invoice document. English and Russian are optional translated copies of the same invoice — not separate invoices.":
    "Счёт на латышском языке — канонический документ. Английская и русская версии — необязательные переведённые копии того же счёта, а не отдельные счета.",
  "Document language": "Язык документа",
  "Control what appears on generated invoices, in what order, and how each section looks.":
    "Управляйте тем, что отображается в сформированных счетах, в каком порядке и как выглядит каждый раздел.",
  "Add text block": "Добавить текстовый блок",
  "Reset layout": "Сбросить макет",
  "Invoice sections": "Разделы счёта",
  "Invoice preview": "Предпросмотр счёта",
  "Sample resident": "Условный жилец",
  "Sample Street 1, Riga, LV-1010": "Примерная улица, 1, Рига, LV-1010",
  "Maintenance fee": "Плата за обслуживание",
  "Invoice details": "Данные счёта",
  "Sender and recipient": "Отправитель и получатель",
  "Charges table": "Таблица начислений",
  "Payment details": "Платёжные реквизиты",
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
    "Восстановить макет счёта по умолчанию? Пользовательские текстовые блоки, названия разделов и всё построчное форматирование будут удалены. Верхний и нижний колонтитулы, платёжные инструкции и текст примечания будут сохранены.",
  "This invoice layout has reached the maximum of 30 sections.":
    "В этом макете счёта достигнут максимум в 30 разделов.",
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
  "Delivery outcome could not be confirmed. The email provider may have accepted this invoice, but the application did not receive confirmation. Verify the recipient mailbox or provider logs before resending.":
    "Не удалось подтвердить результат доставки. Почтовый провайдер мог принять этот счёт, но приложение не получило подтверждения. Проверьте почтовый ящик получателя или логи провайдера перед повторной отправкой.",
  "Sending in progress…": "Выполняется отправка…",
  "Record paper dispatch": "Зафиксировать отправку бумажного экземпляра",
  "Paper dispatched": "Бумажный экземпляр отправлен",
  "This invoice was delivered by email previously. A later attempt's outcome could not be confirmed -- verify the recipient mailbox or provider logs before resending.":
    "Этот счёт ранее был доставлен по электронной почте. Результат более поздней попытки не удалось подтвердить -- проверьте почтовый ящик получателя или логи провайдера перед повторной отправкой.",
  "This invoice was delivered by email previously. The most recent resend failed -- use Resend to try again.":
    "Этот счёт ранее был доставлен по электронной почте. Последняя повторная отправка не удалась -- используйте «Отправить повторно», чтобы попробовать снова.",
  "Paper (unverified legacy record)":
    "Бумажный экземпляр (непроверенная историческая запись)",
  "Recorded automatically under the old delivery workflow -- not a confirmed manual physical dispatch.":
    "Зафиксировано автоматически в рамках прежнего процесса доставки -- это не подтверждает отправку бумажного экземпляра вручную.",

  // Recurring tariffs (Tariffs & rules + dwelling read-only view).
  "Recurring tariffs": "Регулярные тарифы",
  "Automatically applied": "Применяются автоматически",
  "Assigned specifically": "Назначены отдельно",
  "All dwellings": "Все помещения",
  "Selected dwellings": "Выбранные помещения",
  "One dwelling": "Одно помещение",
  "assigned here": "назначено здесь",
  automatic: "автоматически",
  "this dwelling": "этому помещению",
  "Edit tariff": "Редактировать тариф",
  "View all tariffs": "Смотреть все тарифы",
  "No recurring tariffs apply to this dwelling.":
    "К этому помещению не применяется ни один регулярный тариф.",
  "Recurring tariffs are configured and assigned from Tariffs & rules.":
    "Регулярные тарифы настраиваются и назначаются в разделе «Тарифы и правила».",
  "Amount set per period": "Сумма указывается за каждый период",
  "Not assigned yet": "Пока не назначено",
  dwellings: "помещений",
  "Applies to": "Применяется к",

  // Tariff drawer (create/edit form) -- section headings, field hints,
  // and scope-option descriptive copy.
  TARIFF: "ТАРИФ",
  General: "Общее",
  Calculation: "Расчёт",
  "A price of 0.00 is valid and will show on the invoice.":
    "Цена 0,00 действительна и будет отображена в счёте.",
  "Applies to every current and future dwelling.":
    "Применяется ко всем текущим и будущим помещениям.",
  "Applies to exactly one dwelling.": "Применяется ровно к одному помещению.",
  "Applies only to the dwellings you choose. New dwellings are not included automatically.":
    "Применяется только к выбранным вами помещениям. Новые помещения не добавляются автоматически.",
  "Search dwellings": "Поиск помещений",
  "Filter by dwelling number...": "Фильтр по номеру помещения...",
  "Select all visible": "Выбрать все видимые",
  "-- select a dwelling --": "-- выберите помещение --",
  Validity: "Срок действия",
  Advanced: "Дополнительно",
  "Sort order": "Порядок сортировки",
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

// Stored decimals ("15.0000") shown without trailing zeros, but never fewer
// than `min` places and never rounding away real precision (up to 6).
export function formatTrimmed(
  value: string | number,
  locale: Locale,
  min = 2
): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: min,
    maximumFractionDigits: 6,
  }).format(Number(value));
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
  CARRIED_FORWARD: "Previous reading reused",
};
export function entityLabel(value: string, locale: Locale): string {
  return translate(locale, names[value] ?? value);
}
