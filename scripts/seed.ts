// Phase B (Database) - Deterministic development seed data (spec Section 36).
// Run with: DATABASE_URL=... vite-node scripts/seed.ts
// Assumes a freshly migrated, empty database (see scripts/db-migrate-fresh.ts).
//
// app_users below use fixed UUIDs because Phase C (Supabase auth) will need
// to create matching auth.users rows with the same ids in local Supabase.
// Every other entity id is generated at seed-run time with randomUUID() --
// nothing outside this script depends on those being stable across runs.
//
// ponytail: money below is computed with plain floating-point arithmetic
// rounded to 2 decimals. Acceptable for this fixed, hand-picked static seed
// data, but NOT how the real billing engine (Phase F) must compute money --
// that engine must use exact Decimal arithmetic per spec Section 17/18.
import { createHash } from "node:crypto";
import { createDb } from "../src/db/client";
import { appUsers } from "../src/db/schema/auth";
import {
  organizations,
  organizationMemberships,
} from "../src/db/schema/organizations";
import { dwellings, dwellingAccess, meters } from "../src/db/schema/dwellings";
import {
  billingPeriods,
  meterReadings,
  billingRules,
  billingCases,
} from "../src/db/schema/billing";
import {
  invoices,
  invoiceLines,
  invoiceAccessTokens,
  invoiceDeliveries,
  invoiceTemplates,
} from "../src/db/schema/invoices";
import { accountEntries, paymentAllocations } from "../src/db/schema/accounts";
import {
  bankImports,
  bankTransactions,
  paymentMatches,
} from "../src/db/schema/payments";
import { conversations, messages } from "../src/db/schema/messaging";
import { auditLogs } from "../src/db/schema/audit";
import {
  buildInvoiceTemplateSnapshot,
  createDefaultInvoiceTemplateConfig,
} from "../src/domain/billing/invoice-template-schema";

const round2 = (n: number) => Math.round(n * 100) / 100;
const sha256 = (input: string) =>
  createHash("sha256").update(input).digest("hex");

// --- Fixed ids for Phase C to reconcile with Supabase auth.users ---
const ADMIN_A_ID = "10000000-0000-4000-8000-0000000000a1";
const ADMIN_B_ID = "10000000-0000-4000-8000-0000000000b1";
const RESIDENT_IDS = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
  "20000000-0000-4000-8000-000000000004",
  "20000000-0000-4000-8000-000000000005",
  "20000000-0000-4000-8000-000000000006",
];
const RESIDENT_B_ID = "20000000-0000-4000-8000-0000000000b1";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for db:seed");
  }
  const db = await createDb(connectionString);

  // --- Organizations ---
  const [orgA] = await db
    .insert(organizations)
    .values({
      name: "Brīvības 118 Demo",
      registrationNumber: "40103123456",
      vatNumber: "LV40103123456",
      addressLine1: "Brīvības iela 118",
      city: "Riga",
      postalCode: "LV-1001",
      countryCode: "LV",
      email: "admin@brivibas118.example.com",
      phone: "+37120000001",
      bankName: "Swedbank",
      iban: "LV80HABA0000123456789",
      bic: "HABALV22",
      currency: "EUR",
      timezone: "Europe/Riga",
      locale: "lv",
      invoicePrefix: "INV",
      defaultDueDays: 14,
    })
    .returning();

  const [orgB] = await db
    .insert(organizations)
    .values({
      name: "Cross Tenant Test",
      addressLine1: "Testa iela 1",
      city: "Riga",
      postalCode: "LV-1010",
      countryCode: "LV",
      email: "admin@crosstenant.example.com",
      currency: "EUR",
      timezone: "Europe/Riga",
      locale: "lv",
      invoicePrefix: "INV",
      defaultDueDays: 14,
    })
    .returning();

  // --- Users ---
  await db.insert(appUsers).values([
    {
      id: ADMIN_A_ID,
      role: "ADMIN",
      emailSnapshot: "admin.a@example.com",
      displayName: "Admin A",
    },
    {
      id: ADMIN_B_ID,
      role: "ADMIN",
      emailSnapshot: "admin.b@example.com",
      displayName: "Admin B",
    },
    ...RESIDENT_IDS.map((id, i) => ({
      id,
      role: "RESIDENT" as const,
      emailSnapshot: `resident${i + 1}@example.com`,
      displayName: `Resident ${i + 1}`,
    })),
    {
      id: RESIDENT_B_ID,
      role: "RESIDENT" as const,
      emailSnapshot: "resident.b1@example.com",
      displayName: "Resident B1",
    },
  ]);

  await db.insert(organizationMemberships).values([
    { organizationId: orgA.id, userId: ADMIN_A_ID },
    { organizationId: orgB.id, userId: ADMIN_B_ID },
  ]);

  // --- Dwellings for Organization A: 12 units, 1-10 apartments (metered),
  // 11 parking + 12 storage (unmetered, still billable via FIXED/AREA rules).
  type DwellingSpec = {
    number: string;
    type: "APARTMENT" | "PARKING" | "STORAGE";
    area: string;
    residentCount: number;
    hasMeters: boolean;
  };
  const dwellingSpecs: DwellingSpec[] = [
    ...Array.from({ length: 10 }, (_, i) => ({
      number: String(i + 1),
      type: "APARTMENT" as const,
      area: (40 + i * 3.2).toFixed(2),
      residentCount: 1 + (i % 4),
      hasMeters: true,
    })),
    {
      number: "11",
      type: "PARKING",
      area: "12.50",
      residentCount: 0,
      hasMeters: false,
    },
    {
      number: "12",
      type: "STORAGE",
      area: "6.00",
      residentCount: 0,
      hasMeters: false,
    },
  ];

  const dwellingRows = await db
    .insert(dwellings)
    .values(
      dwellingSpecs.map((d) => ({
        organizationId: orgA.id,
        type: d.type,
        number: d.number,
        displayName: `${d.type === "APARTMENT" ? "Apt" : d.type === "PARKING" ? "Parking" : "Storage"} ${d.number}`,
        occupantName:
          d.type === "APARTMENT" ? `Resident household ${d.number}` : null,
        billingName:
          d.type === "APARTMENT" ? `Resident household ${d.number}` : orgA.name,
        billingEmail:
          d.type === "APARTMENT" && Number(d.number) <= RESIDENT_IDS.length
            ? `resident${d.number}@example.com`
            : orgA.email,
        billingAddress: `${orgA.addressLine1}, ${orgA.city}, ${orgA.postalCode}`,
        areaM2: d.area,
        residentCount: d.residentCount,
      }))
    )
    .returning();

  // First 6 apartments get resident access, one resident per dwelling.
  await db.insert(dwellingAccess).values(
    RESIDENT_IDS.map((userId, i) => ({
      dwellingId: dwellingRows[i].id,
      userId,
    }))
  );

  const [orgBDwelling] = await db
    .insert(dwellings)
    .values({
      organizationId: orgB.id,
      type: "APARTMENT",
      number: "1",
      displayName: "Apt 1",
      areaM2: "50.00",
      residentCount: 2,
    })
    .returning();
  await db
    .insert(dwellingAccess)
    .values({ dwellingId: orgBDwelling.id, userId: RESIDENT_B_ID });

  // --- Meters for dwellings 1-10 ---
  const meteredDwellings = dwellingRows.slice(0, 10);
  const meterRows = await db
    .insert(meters)
    .values(
      meteredDwellings.flatMap((d) => [
        {
          organizationId: orgA.id,
          dwellingId: d.id,
          type: "COLD_WATER" as const,
          serialNumber: `CW-${d.number.padStart(3, "0")}`,
          unit: "m3",
          installedAt: "2023-01-01",
        },
        {
          organizationId: orgA.id,
          dwellingId: d.id,
          type: "HOT_WATER" as const,
          serialNumber: `HW-${d.number.padStart(3, "0")}`,
          unit: "m3",
          installedAt: "2023-01-01",
        },
      ])
    )
    .returning();

  const coldMeterByDwelling = new Map(
    meteredDwellings.map((d, i) => [d.id, meterRows[i * 2]])
  );
  const hotMeterByDwelling = new Map(
    meteredDwellings.map((d, i) => [d.id, meterRows[i * 2 + 1]])
  );

  // --- Billing rules for Organization A ---
  const [maintenanceRule, areaRule, coldRule, hotRule] = await db
    .insert(billingRules)
    .values([
      {
        organizationId: orgA.id,
        name: "Apsaimniekošanas maksa",
        nameEn: "Maintenance fee",
        nameRu: "Плата за обслуживание",
        code: "MAINT",
        calculationType: "FIXED",
        unit: "month",
        unitPrice: "15.00",
        vatRate: "21",
        effectiveFrom: "2024-01-01",
      },
      {
        organizationId: orgA.id,
        name: "Koplietošanas telpu uzturēšana",
        nameEn: "Common area maintenance",
        nameRu: "Содержание общих помещений",
        code: "AREA_FEE",
        calculationType: "AREA",
        unit: "m2",
        unitPrice: "0.35",
        vatRate: "21",
        effectiveFrom: "2024-01-01",
      },
      {
        organizationId: orgA.id,
        name: "Aukstais ūdens",
        nameEn: "Cold water",
        nameRu: "Холодная вода",
        code: "COLD_WATER",
        calculationType: "METER_CONSUMPTION",
        meterType: "COLD_WATER",
        unit: "m3",
        unitPrice: "1.20",
        vatRate: "21",
        effectiveFrom: "2024-01-01",
      },
      {
        organizationId: orgA.id,
        name: "Karstais ūdens",
        nameEn: "Hot water",
        nameRu: "Горячая вода",
        code: "HOT_WATER",
        calculationType: "METER_CONSUMPTION",
        meterType: "HOT_WATER",
        unit: "m3",
        unitPrice: "5.80",
        vatRate: "21",
        effectiveFrom: "2024-01-01",
      },
    ])
    .returning();

  const [template] = await db
    .insert(invoiceTemplates)
    .values({
      organizationId: orgA.id,
      headerText: orgA.name,
      paymentInstructions: "Maksājuma mērķī norādiet rēķina numuru.",
      footerText: "Paldies par savlaicīgu apmaksu.",
      config: createDefaultInvoiceTemplateConfig(),
    })
    .returning();
  const templateSnapshot = buildInvoiceTemplateSnapshot(template);

  // --- Billing periods: previous month (complete/paid), current month (mixed) ---
  // Fixed, not derived from the real current date: spec Section 36 requires a
  // deterministic seed, and the bank/CSV fixtures under fixtures/ hardcode
  // invoice numbers that embed this period's year/month -- if this drifted
  // with wall-clock time, re-seeding in a later month would silently break
  // every fixture that references those invoice numbers.
  const PREVIOUS_PERIOD = { year: 2026, month: 8 };
  const CURRENT_PERIOD = { year: 2026, month: 9 };

  const monthBounds = ({ year, month }: { year: number; month: number }) => {
    const startsOn = new Date(Date.UTC(year, month - 1, 1));
    const endsOn = new Date(Date.UTC(year, month, 0));
    const issueDate = endsOn;
    const dueDate = new Date(Date.UTC(year, month, 14));
    const iso = (dt: Date) => dt.toISOString().slice(0, 10);
    return {
      year,
      month,
      startsOn: iso(startsOn),
      endsOn: iso(endsOn),
      issueDate: iso(issueDate),
      dueDate: iso(dueDate),
    };
  };

  const prev = monthBounds(PREVIOUS_PERIOD);
  const cur = {
    ...monthBounds(CURRENT_PERIOD),
    issueDate: "2026-09-01",
    dueDate: "2026-09-29",
  };
  const yyyymm = (year: number, month: number) =>
    `${year}${String(month).padStart(2, "0")}`;

  const [prevPeriod] = await db
    .insert(billingPeriods)
    .values({
      organizationId: orgA.id,
      year: prev.year,
      month: prev.month,
      startsOn: prev.startsOn,
      endsOn: prev.endsOn,
      readingDeadline: prev.endsOn,
      invoiceIssueDate: prev.issueDate,
      invoiceDueDate: prev.dueDate,
      status: "LOCKED",
      lockedAt: new Date(),
    })
    .returning();

  const [curPeriod] = await db
    .insert(billingPeriods)
    .values({
      organizationId: orgA.id,
      year: cur.year,
      month: cur.month,
      startsOn: cur.startsOn,
      endsOn: cur.endsOn,
      readingDeadline: cur.endsOn,
      invoiceIssueDate: cur.issueDate,
      invoiceDueDate: cur.dueDate,
      status: "OPEN",
    })
    .returning();

  // --- Meter readings ---
  // Previous period: every metered dwelling has a reading (period is complete).
  // Current period: every metered dwelling EXCEPT dwellings 9 and 10 (index 8, 9)
  // has a reading -- those two stay missing on purpose (MISSING_DATA cases).
  const PREV_COLD_CONSUMPTION = "5.500";
  const PREV_HOT_CONSUMPTION = "3.200";
  const CUR_COLD_CONSUMPTION = "6.000";
  const CUR_HOT_CONSUMPTION = "3.500";
  const missingCurrentReadingDwellingNumbers = new Set(["9", "10"]);

  for (const [i, d] of meteredDwellings.entries()) {
    const coldMeter = coldMeterByDwelling.get(d.id)!;
    const hotMeter = hotMeterByDwelling.get(d.id)!;
    const coldBase = 100 + i * 10;
    const hotBase = 50 + i * 5;

    await db.insert(meterReadings).values([
      {
        organizationId: orgA.id,
        periodId: prevPeriod.id,
        meterId: coldMeter.id,
        previousValue: coldBase.toFixed(3),
        currentValue: (coldBase + Number(PREV_COLD_CONSUMPTION)).toFixed(3),
        consumption: PREV_COLD_CONSUMPTION,
        source: "ADMIN",
        submittedByUserId: ADMIN_A_ID,
      },
      {
        organizationId: orgA.id,
        periodId: prevPeriod.id,
        meterId: hotMeter.id,
        previousValue: hotBase.toFixed(3),
        currentValue: (hotBase + Number(PREV_HOT_CONSUMPTION)).toFixed(3),
        consumption: PREV_HOT_CONSUMPTION,
        source: "ADMIN",
        submittedByUserId: ADMIN_A_ID,
      },
    ]);

    if (!missingCurrentReadingDwellingNumbers.has(d.number)) {
      const coldPrevValue = coldBase + Number(PREV_COLD_CONSUMPTION);
      const hotPrevValue = hotBase + Number(PREV_HOT_CONSUMPTION);
      await db.insert(meterReadings).values([
        {
          organizationId: orgA.id,
          periodId: curPeriod.id,
          meterId: coldMeter.id,
          previousValue: coldPrevValue.toFixed(3),
          currentValue: (coldPrevValue + Number(CUR_COLD_CONSUMPTION)).toFixed(
            3
          ),
          consumption: CUR_COLD_CONSUMPTION,
          source: d.number === "1" ? "RESIDENT" : "ADMIN",
          submittedByUserId: d.number === "1" ? RESIDENT_IDS[0] : ADMIN_A_ID,
        },
        {
          organizationId: orgA.id,
          periodId: curPeriod.id,
          meterId: hotMeter.id,
          previousValue: hotPrevValue.toFixed(3),
          currentValue: (hotPrevValue + Number(CUR_HOT_CONSUMPTION)).toFixed(3),
          consumption: CUR_HOT_CONSUMPTION,
          source: d.number === "1" ? "RESIDENT" : "ADMIN",
          submittedByUserId: d.number === "1" ? RESIDENT_IDS[0] : ADMIN_A_ID,
        },
      ]);
    }
  }

  // --- Helper: build invoice lines + totals for a dwelling in a period ---
  function buildLines(
    d: (typeof dwellingRows)[number],
    consumption: { cold: string; hot: string } | null
  ) {
    const lines: {
      billingRuleId: string;
      sortOrder: number;
      description: string;
      calculationType: "FIXED" | "AREA" | "METER_CONSUMPTION";
      sourceSnapshot: Record<string, unknown>;
      unit: string;
      quantity: string;
      unitPrice: string;
      vatRate: string;
      netAmount: number;
      vatAmount: number;
      grossAmount: number;
    }[] = [];

    const addLine = (
      sortOrder: number,
      rule: {
        id: string;
        unit: string;
        code: string;
        name: string;
        nameEn: string | null;
        nameRu: string | null;
      },
      description: string,
      calculationType: "FIXED" | "AREA" | "METER_CONSUMPTION",
      quantity: number,
      unitPrice: number
    ) => {
      const net = round2(quantity * unitPrice);
      const vat = round2(net * 0.21);
      lines.push({
        billingRuleId: rule.id,
        sortOrder,
        description,
        calculationType,
        sourceSnapshot: {
          code: rule.code,
          nameEn: rule.nameEn,
          nameRu: rule.nameRu,
          quantity,
          unitPrice,
        },
        unit: rule.unit,
        quantity: quantity.toFixed(4),
        unitPrice: unitPrice.toFixed(4),
        vatRate: "21",
        netAmount: net,
        vatAmount: vat,
        grossAmount: round2(net + vat),
      });
    };

    addLine(0, maintenanceRule, maintenanceRule.name, "FIXED", 1, 15.0);
    addLine(1, areaRule, areaRule.name, "AREA", Number(d.areaM2), 0.35);
    if (consumption) {
      addLine(
        2,
        coldRule,
        coldRule.name,
        "METER_CONSUMPTION",
        Number(consumption.cold),
        1.2
      );
      addLine(
        3,
        hotRule,
        hotRule.name,
        "METER_CONSUMPTION",
        Number(consumption.hot),
        5.8
      );
    }

    const subtotal = round2(lines.reduce((sum, l) => sum + l.netAmount, 0));
    const vatTotal = round2(lines.reduce((sum, l) => sum + l.vatAmount, 0));
    const total = round2(subtotal + vatTotal);
    return { lines, subtotal, vatTotal, total };
  }

  async function generateInvoice(opts: {
    period: typeof prevPeriod;
    dwelling: (typeof dwellingRows)[number];
    sequence: number;
    consumption: { cold: string; hot: string } | null;
    status: "DRAFT" | "PREPARED" | "SENT" | "PAID" | "OVERDUE";
  }) {
    const { period, dwelling, sequence, consumption, status } = opts;
    const { lines, subtotal, vatTotal, total } = buildLines(
      dwelling,
      consumption
    );
    const invoiceNumber = `${orgA.invoicePrefix}-${yyyymm(period.year, period.month)}-${String(
      sequence
    ).padStart(5, "0")}`;

    const [billingCase] = await db
      .insert(billingCases)
      .values({
        organizationId: orgA.id,
        periodId: period.id,
        dwellingId: dwelling.id,
        status,
        missingData: [],
        statusUpdatedAt: new Date(),
      })
      .returning();

    // Fixed, period-relative timestamps -- not Date.now()-relative -- so the
    // seed stays deterministic no matter when it is actually run (see the
    // PREVIOUS_PERIOD/CURRENT_PERIOD comment above).
    const preparedAt =
      status === "DRAFT"
        ? null
        : new Date(`${period.invoiceIssueDate}T09:00:00Z`);
    const sentAt = ["SENT", "PAID", "OVERDUE"].includes(status)
      ? new Date(`${period.invoiceIssueDate}T10:00:00Z`)
      : null;
    const paidAt =
      status === "PAID"
        ? new Date(`${period.invoiceIssueDate}T11:00:00Z`)
        : null;
    // OVERDUE requires a due date already in the past (spec Section 19); the
    // period's normal due date (the 14th) is not guaranteed to have passed,
    // so this dwelling gets an earlier fixed due date within the same period.
    const overdueDueDate = `${period.year}-${String(period.month).padStart(2, "0")}-03`;

    const [invoice] = await db
      .insert(invoices)
      .values({
        organizationId: orgA.id,
        billingCaseId: billingCase.id,
        dwellingId: dwelling.id,
        periodId: period.id,
        invoiceNumber,
        issueDate: period.invoiceIssueDate,
        dueDate: status === "OVERDUE" ? overdueDueDate : period.invoiceDueDate,
        currency: "EUR",
        subtotal: subtotal.toFixed(2),
        vatTotal: vatTotal.toFixed(2),
        total: total.toFixed(2),
        currentCharges: total.toFixed(2),
        amountDue: total.toFixed(2),
        issuerSnapshot: {
          name: orgA.name,
          registrationNumber: orgA.registrationNumber,
          vatNumber: orgA.vatNumber,
          addressLine1: orgA.addressLine1,
          city: orgA.city,
          postalCode: orgA.postalCode,
          countryCode: orgA.countryCode,
          email: orgA.email,
          phone: orgA.phone,
        },
        recipientSnapshot: {
          dwellingNumber: dwelling.number,
          displayName: dwelling.displayName,
          occupantName: dwelling.occupantName,
          billingName: dwelling.billingName,
          billingEmail: dwelling.billingEmail,
          billingAddress: dwelling.billingAddress,
          invoiceByEmail: dwelling.invoiceByEmail,
          invoiceByPaper: dwelling.invoiceByPaper,
        },
        paymentSnapshot: {
          bankName: orgA.bankName,
          iban: orgA.iban,
          bic: orgA.bic,
          currency: orgA.currency,
        },
        templateSnapshot,
        preparedAt,
        sentAt,
        paidAt,
      })
      .returning();

    await db.insert(invoiceLines).values(
      lines.map((l) => ({
        organizationId: orgA.id,
        invoiceId: invoice.id,
        billingRuleId: l.billingRuleId,
        sortOrder: l.sortOrder,
        description: l.description,
        calculationType: l.calculationType,
        sourceSnapshot: l.sourceSnapshot,
        unit: l.unit,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        vatRate: l.vatRate,
        netAmount: l.netAmount.toFixed(2),
        vatAmount: l.vatAmount.toFixed(2),
        grossAmount: l.grossAmount.toFixed(2),
      }))
    );

    if (preparedAt) {
      await db.insert(accountEntries).values({
        organizationId: orgA.id,
        dwellingId: dwelling.id,
        effectiveDate: invoice.issueDate,
        type: "INVOICE_CHARGE",
        debit: invoice.currentCharges,
        credit: "0.00",
        currency: invoice.currency,
        invoiceId: invoice.id,
        description: `Current charges ${invoice.invoiceNumber}`,
        metadata: { invoiceNumber: invoice.invoiceNumber },
        idempotencyKey: `invoice:${invoice.id}:current-charges`,
      });
    }

    if (sentAt) {
      await db.insert(invoiceDeliveries).values({
        organizationId: orgA.id,
        invoiceId: invoice.id,
        destinationEmail: dwelling.billingEmail ?? "resident@example.com",
        provider: "ses",
        providerMessageId: sha256(`${invoice.id}:message`).slice(0, 16),
        status: "success",
        sentAt,
      });
      await db.insert(invoiceAccessTokens).values({
        organizationId: orgA.id,
        invoiceId: invoice.id,
        tokenHash: sha256(`${invoice.id}:token`),
      });
    }

    return invoice;
  }

  // Previous period: all 12 dwellings PAID.
  const prevInvoices = [];
  for (const [i, d] of dwellingRows.entries()) {
    const consumption = meteredDwellings.includes(d)
      ? { cold: PREV_COLD_CONSUMPTION, hot: PREV_HOT_CONSUMPTION }
      : null;
    const invoice = await generateInvoice({
      period: prevPeriod,
      dwelling: d,
      sequence: i + 1,
      consumption,
      status: "PAID",
    });
    prevInvoices.push(invoice);
  }

  // Current period: mixed statuses across the 12 dwellings.
  const currentStatusByNumber: Record<
    string,
    "DRAFT" | "PREPARED" | "SENT" | "PAID" | "OVERDUE" | "MISSING_DATA"
  > = {
    "1": "PAID",
    "2": "PAID",
    "3": "SENT",
    "4": "SENT",
    "5": "PREPARED",
    "6": "PREPARED",
    "7": "DRAFT",
    "8": "DRAFT",
    "9": "MISSING_DATA",
    "10": "MISSING_DATA",
    "11": "OVERDUE",
    "12": "PAID",
  };

  let currentSequence = 1;
  const currentInvoices: {
    dwellingNumber: string;
    invoice: Awaited<ReturnType<typeof generateInvoice>>;
  }[] = [];
  for (const d of dwellingRows) {
    const status = currentStatusByNumber[d.number];
    if (status === "MISSING_DATA") {
      await db.insert(billingCases).values({
        organizationId: orgA.id,
        periodId: curPeriod.id,
        dwellingId: d.id,
        status: "MISSING_DATA",
        missingData: [
          `Missing current-period meter reading for dwelling ${d.number}`,
        ],
        statusUpdatedAt: new Date(),
      });
      continue;
    }
    const consumption = meteredDwellings.includes(d)
      ? { cold: CUR_COLD_CONSUMPTION, hot: CUR_HOT_CONSUMPTION }
      : null;
    const invoice = await generateInvoice({
      period: curPeriod,
      dwelling: d,
      sequence: currentSequence++,
      consumption,
      status,
    });
    currentInvoices.push({ dwellingNumber: d.number, invoice });
  }

  // --- Bank reconciliation: previous period (all 12 paid) + current period (dwellings 1, 2, 12) ---
  async function importAndConfirmPayments(
    filename: string,
    entries: { invoice: Awaited<ReturnType<typeof generateInvoice>> }[]
  ) {
    const rawContent = entries
      .map((e) => `${e.invoice.invoiceNumber},${e.invoice.total}`)
      .join("\n");
    const [bankImport] = await db
      .insert(bankImports)
      .values({
        organizationId: orgA.id,
        originalFilename: filename,
        fileSha256: sha256(rawContent),
        importedByUserId: ADMIN_A_ID,
        rowCount: entries.length,
      })
      .returning();

    for (const [i, e] of entries.entries()) {
      const [txn] = await db
        .insert(bankTransactions)
        .values({
          organizationId: orgA.id,
          bankImportId: bankImport.id,
          bookingDate: e.invoice.issueDate,
          amount: e.invoice.total,
          currency: "EUR",
          payerName: `Dwelling ${e.invoice.dwellingId}`,
          reference: `Payment for ${e.invoice.invoiceNumber}`,
          rawData: { invoiceNumber: e.invoice.invoiceNumber },
          rowNumber: i + 1,
        })
        .returning();

      const [match] = await db
        .insert(paymentMatches)
        .values({
          organizationId: orgA.id,
          bankTransactionId: txn.id,
          invoiceId: e.invoice.id,
          matchType: "AUTO_EXACT",
          status: "CONFIRMED",
          confidence: "1.0000",
          resultType: "EXACT",
          proposedAllocationAmount: e.invoice.amountDue,
          confirmedByUserId: ADMIN_A_ID,
          confirmedAt: new Date(),
        })
        .returning();
      await db.insert(accountEntries).values({
        organizationId: orgA.id,
        dwellingId: e.invoice.dwellingId,
        effectiveDate: txn.bookingDate,
        type: "PAYMENT",
        debit: "0.00",
        credit: txn.amount,
        currency: txn.currency,
        invoiceId: e.invoice.id,
        bankTransactionId: txn.id,
        description: `Bank payment ${txn.reference}`,
        metadata: { allocatedAmount: e.invoice.amountDue, resultType: "EXACT" },
        idempotencyKey: `bank-transaction:${txn.id}:payment`,
      });
      await db.insert(paymentAllocations).values({
        organizationId: orgA.id,
        dwellingId: e.invoice.dwellingId,
        bankTransactionId: txn.id,
        invoiceId: e.invoice.id,
        allocatedAmount: e.invoice.amountDue,
        method: "EXACT",
        actorUserId: ADMIN_A_ID,
        idempotencyKey: `payment-match:${match.id}:allocation`,
      });
    }
  }

  await importAndConfirmPayments(
    "previous-month-statement.csv",
    prevInvoices.map((invoice) => ({ invoice }))
  );
  await importAndConfirmPayments(
    "current-month-statement.csv",
    currentInvoices
      .filter((e) => ["1", "2", "12"].includes(e.dwellingNumber))
      .map((e) => ({ invoice: e.invoice }))
  );

  // --- Conversations ---
  const [convA] = await db
    .insert(conversations)
    .values({
      organizationId: orgA.id,
      dwellingId: dwellingRows[0].id,
      subject: "Question about this month's invoice",
      status: "OPEN",
      createdByUserId: RESIDENT_IDS[0],
    })
    .returning();
  await db.insert(messages).values([
    {
      organizationId: orgA.id,
      conversationId: convA.id,
      senderUserId: RESIDENT_IDS[0],
      body: "Hi, could you clarify the water consumption line on my latest invoice?",
    },
    {
      organizationId: orgA.id,
      conversationId: convA.id,
      senderUserId: ADMIN_A_ID,
      body: "Sure -- that reflects your meter reading for this billing period.",
    },
  ]);

  const [convB] = await db
    .insert(conversations)
    .values({
      organizationId: orgB.id,
      dwellingId: orgBDwelling.id,
      subject: "Welcome message",
      status: "NEW",
      createdByUserId: ADMIN_B_ID,
    })
    .returning();
  await db.insert(messages).values({
    organizationId: orgB.id,
    conversationId: convB.id,
    senderUserId: ADMIN_B_ID,
    body: "Welcome to the resident portal.",
  });

  // --- Audit trail (illustrative, not exhaustive) ---
  await db.insert(auditLogs).values([
    {
      organizationId: orgA.id,
      actorUserId: ADMIN_A_ID,
      action: "ORGANIZATION_CREATED",
      entityType: "organization",
      entityId: orgA.id,
      afterData: { name: orgA.name },
    },
    {
      organizationId: orgB.id,
      actorUserId: ADMIN_B_ID,
      action: "ORGANIZATION_CREATED",
      entityType: "organization",
      entityId: orgB.id,
      afterData: { name: orgB.name },
    },
    {
      organizationId: orgA.id,
      actorUserId: ADMIN_A_ID,
      action: "DWELLING_CREATED",
      entityType: "dwelling",
      entityId: dwellingRows[0].id,
      afterData: { number: dwellingRows[0].number },
    },
    {
      organizationId: orgA.id,
      actorUserId: ADMIN_A_ID,
      action: "INVOICE_GENERATED",
      entityType: "invoice",
      entityId: prevInvoices[0].id,
      afterData: { invoiceNumber: prevInvoices[0].invoiceNumber },
    },
    {
      organizationId: orgA.id,
      actorUserId: ADMIN_A_ID,
      action: "INVOICE_SENT",
      entityType: "invoice",
      entityId: prevInvoices[0].id,
    },
    {
      organizationId: orgA.id,
      actorUserId: ADMIN_A_ID,
      action: "PAYMENT_MATCH_CONFIRMED",
      entityType: "invoice",
      entityId: prevInvoices[0].id,
    },
  ]);

  console.log("Seed complete.");
  console.log(`Organizations: 2 (${orgA.name}, ${orgB.name})`);
  console.log(
    `Dwellings: ${dwellingRows.length + 1} (Org A: ${dwellingRows.length}, Org B: 1)`
  );
  console.log(`Meters: ${meterRows.length}`);
  console.log(`Previous-period invoices (all PAID): ${prevInvoices.length}`);
  console.log(`Current-period invoices: ${currentInvoices.length}`);
  console.log(
    "Current-period billing_case status distribution:",
    Object.entries(currentStatusByNumber).reduce<Record<string, number>>(
      (acc, [, status]) => {
        acc[status] = (acc[status] ?? 0) + 1;
        return acc;
      },
      {}
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
