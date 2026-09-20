// Phase G (Invoices/delivery) - email abstraction (spec Section 3.6).
// Supabase Auth handles its own emails (magic link, spec Section 15.1)
// via its configured SMTP directly -- app code never calls this for
// those. This is only for invoice delivery (and any future
// app-originated email).
import { escapeHtml } from "../html-escape";

export interface SendInvoiceEmailInput {
  to: string;
  organizationName: string;
  periodLabel: string;
  invoiceNumber: string;
  total: string;
  currency: string;
  dueDate: string;
  viewInvoiceUrl: string;
  portalUrl: string;
}

export type EmailFailureClassification = "DEFINITIVE" | "AMBIGUOUS";

export interface EmailDeliveryResult {
  success: boolean;
  provider: "ses" | "smtp";
  providerMessageId?: string;
  // Safe to persist/log: never the resident's inbox content or provider
  // credentials, just a short machine-readable failure classification
  // (spec Section 23: "sensitive provider errors not exposed to resident").
  errorCode?: string;
  // Only meaningful when success is false. Absent when success is true.
  failureClassification?: EmailFailureClassification;
}

export interface EmailService {
  sendInvoice(input: SendInvoiceEmailInput): Promise<EmailDeliveryResult>;
}

// Shared by every EmailService implementation so the two send paths
// (production SES, local-dev SMTP) never drift into showing different
// content for the same input (spec Section 23's required fields: org,
// period, invoice number, total, due date, "View invoice", "Open
export function sanitizeHeader(value: string): string {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

export function invoiceEmailSubject(input: SendInvoiceEmailInput): string {
  return sanitizeHeader(
    `${input.organizationName}: invoice ${input.invoiceNumber} for ${input.periodLabel}`
  );
}

export function invoiceEmailHtml(input: SendInvoiceEmailInput): string {
  return `<!doctype html>
<html><body style="font-family: Helvetica, Arial, sans-serif; font-size: 14px; color: #171717;">
  <p>${escapeHtml(input.organizationName)} has issued invoice <strong>${escapeHtml(input.invoiceNumber)}</strong> for ${escapeHtml(input.periodLabel)}.</p>
  <p>Total: <strong>${escapeHtml(input.total)} ${escapeHtml(input.currency)}</strong><br />Due: ${escapeHtml(input.dueDate)}</p>
  <p><a href="${escapeHtml(input.viewInvoiceUrl)}">View invoice</a></p>
  <p><a href="${escapeHtml(input.portalUrl)}">Open resident portal</a></p>
</body></html>`;
}

export function invoiceEmailText(input: SendInvoiceEmailInput): string {
  return [
    `${input.organizationName} has issued invoice ${input.invoiceNumber} for ${input.periodLabel}.`,
    `Total: ${input.total} ${input.currency}`,
    `Due: ${input.dueDate}`,
    `View invoice: ${input.viewInvoiceUrl}`,
    `Open resident portal: ${input.portalUrl}`,
  ].join("\n");
}
