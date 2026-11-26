// The issuer, recipient and payment details an invoice froze when it was
// generated (invoices.*_snapshot, jsonb). The columns are untyped, so a reader
// goes through this file instead of casting. Every field is optional and
// unknown keys are kept, so a snapshot written by any earlier version of
// generateInvoice is valid. A snapshot of another shape is damaged: the
// preview or PDF stops with a clear message. Nothing here writes to the row.
import { z } from "astro/zod";
import { ConflictError } from "../errors";

const text = z.string().nullish();

const issuerSchema = z.looseObject({
  name: text,
  registrationNumber: text,
  vatNumber: text,
  addressLine1: text,
  addressLine2: text,
  city: text,
  postalCode: text,
  countryCode: text,
  email: text,
  phone: text,
});
const recipientSchema = z.looseObject({
  dwellingNumber: text,
  displayName: text,
  occupantName: text,
  billingName: text,
  billingEmail: text,
  billingAddress: text,
  invoiceByEmail: z.boolean().nullish(),
  invoiceByPaper: z.boolean().nullish(),
});
const paymentSchema = z.looseObject({
  bankName: text,
  iban: text,
  bic: text,
  currency: text,
});

export interface InvoiceSnapshots {
  issuer: z.infer<typeof issuerSchema>;
  recipient: z.infer<typeof recipientSchema>;
  payment: z.infer<typeof paymentSchema>;
}

interface SnapshotColumns {
  issuerSnapshot: unknown;
  recipientSnapshot: unknown;
  paymentSnapshot: unknown;
}

// null when a snapshot is damaged.
export function readInvoiceSnapshots(
  invoice: SnapshotColumns
): InvoiceSnapshots | null {
  const issuer = issuerSchema.safeParse(invoice.issuerSnapshot);
  const recipient = recipientSchema.safeParse(invoice.recipientSnapshot);
  const payment = paymentSchema.safeParse(invoice.paymentSnapshot);
  return issuer.success && recipient.success && payment.success
    ? { issuer: issuer.data, recipient: recipient.data, payment: payment.data }
    : null;
}

export function parseInvoiceSnapshots(
  invoice: SnapshotColumns
): InvoiceSnapshots {
  const snapshots = readInvoiceSnapshots(invoice);
  if (!snapshots) {
    throw new ConflictError(
      "This invoice cannot be shown because its stored details are damaged."
    );
  }
  return snapshots;
}

// How an invoice is delivered, from its frozen recipient. A snapshot taken
// before per-dwelling delivery preferences existed has neither key: that is
// email only, the one option back then, not "no delivery method".
export function invoiceDelivery(recipientSnapshot: unknown) {
  const parsed = recipientSchema.safeParse(recipientSnapshot);
  const recipient = parsed.success ? parsed.data : {};
  return {
    billingEmail: recipient.billingEmail ?? null,
    invoiceByEmail: recipient.invoiceByEmail ?? true,
    invoiceByPaper: recipient.invoiceByPaper ?? false,
  };
}

function billingDetailIssues({ issuer, recipient, payment }: InvoiceSnapshots) {
  const recipientNameMissing =
    !recipient.billingName?.trim() && !recipient.occupantName?.trim();
  const recipientAddressMissing = !recipient.billingAddress?.trim();
  return {
    issuerIncomplete: !issuer.name || !issuer.addressLine1,
    recipientNameMissing,
    recipientAddressMissing,
    recipientIncomplete: recipientNameMissing || recipientAddressMissing,
    paymentIncomplete: !payment.iban || !payment.bankName,
  };
}

// Current settings tell the admin what to fix or refresh. Preparation still
// validates the invoice's saved snapshot.
export function draftBillingDetails(
  snapshots: InvoiceSnapshots | null,
  current?: {
    organization: InvoiceSnapshots["issuer"] & InvoiceSnapshots["payment"];
    dwelling: InvoiceSnapshots["recipient"];
  }
) {
  const saved = billingDetailIssues(
    snapshots ?? { issuer: {}, recipient: {}, payment: {} }
  );
  const snapshotIncomplete =
    saved.recipientIncomplete ||
    saved.issuerIncomplete ||
    saved.paymentIncomplete;
  const live =
    current &&
    billingDetailIssues({
      issuer: current.organization,
      payment: current.organization,
      recipient: current.dwelling,
    });
  const details = (snapshotIncomplete && live) || saved;
  const savedRecipient = snapshots && invoiceDelivery(snapshots.recipient);
  const updated =
    snapshots &&
    current &&
    savedRecipient &&
    ((
      [
        "name",
        "registrationNumber",
        "vatNumber",
        "addressLine1",
        "addressLine2",
        "city",
        "postalCode",
      ] as const
    ).some(
      (field) =>
        (snapshots.issuer[field] ?? "") !== (current.organization[field] ?? "")
    ) ||
      (["bankName", "iban", "bic"] as const).some(
        (field) =>
          (snapshots.payment[field] ?? "") !==
          (current.organization[field] ?? "")
      ) ||
      (snapshots.recipient.billingName || snapshots.recipient.occupantName) !==
        (current.dwelling.billingName || current.dwelling.occupantName) ||
      snapshots.recipient.billingAddress !== current.dwelling.billingAddress ||
      savedRecipient.invoiceByEmail !==
        (current.dwelling.invoiceByEmail ?? true) ||
      savedRecipient.invoiceByPaper !==
        (current.dwelling.invoiceByPaper ?? false) ||
      (savedRecipient.invoiceByEmail &&
        savedRecipient.billingEmail !==
          (current.dwelling.billingEmail ?? null)));
  return {
    snapshotIncomplete,
    recipientIncomplete: details.recipientIncomplete,
    recipientNameMissing: details.recipientNameMissing,
    recipientAddressMissing: details.recipientAddressMissing,
    organizationIncomplete:
      details.issuerIncomplete || details.paymentIncomplete,
    needsRegeneration: Boolean(
      live &&
      !live.recipientIncomplete &&
      !live.issuerIncomplete &&
      !live.paymentIncomplete &&
      (snapshotIncomplete || updated)
    ),
  };
}

// Why this invoice cannot be prepared for sending, or null when it can. The
// dashboard counts the same answer, so "Needs attention" and prepareInvoice
// cannot disagree.
export function missingBillingDetails(
  snapshots: InvoiceSnapshots
): string | null {
  const { issuerIncomplete, recipientIncomplete, paymentIncomplete } =
    billingDetailIssues(snapshots);
  if (issuerIncomplete) {
    return "Issuer details are incomplete; update organization settings before preparing";
  }
  if (recipientIncomplete) {
    return "This dwelling is missing a billing/occupant name or a billing address";
  }
  if (paymentIncomplete) {
    return "Organization payment details are incomplete (both bank name and IBAN are required)";
  }
  return null;
}
