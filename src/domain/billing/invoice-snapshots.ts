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

// Why this invoice cannot be prepared for sending, or null when it can. The
// dashboard counts the same answer, so "Needs attention" and prepareInvoice
// cannot disagree.
export function missingBillingDetails({
  issuer,
  recipient,
  payment,
}: InvoiceSnapshots): string | null {
  if (!issuer.name || !issuer.addressLine1) {
    return "Issuer details are incomplete; update organization settings before preparing";
  }
  if (
    (!recipient.billingName && !recipient.occupantName) ||
    !recipient.billingAddress
  ) {
    return "This dwelling is missing a billing/occupant name or a billing address";
  }
  if (!payment.iban || !payment.bankName) {
    return "Organization payment details are incomplete (both bank name and IBAN are required)";
  }
  return null;
}
