// Shared resident-facing invoice status badge (Phase I, spec Section 28).
// Keyed off billing_cases.status, not sentAt/paidAt alone -- those two
// columns can't distinguish OVERDUE from SENT, or PREPARED from DRAFT.
export type InvoiceCaseStatus =
  "MISSING_DATA" | "DRAFT" | "PREPARED" | "SENT" | "PAID" | "OVERDUE";

export interface InvoiceStatusBadge {
  label: string;
  className: string;
}

export function invoiceStatusBadge(
  caseStatus: InvoiceCaseStatus
): InvoiceStatusBadge {
  switch (caseStatus) {
    case "PAID":
      return { label: "Paid", className: "bg-green-50 text-green-700" };
    case "OVERDUE":
      return { label: "Overdue", className: "bg-amber-50 text-amber-700" };
    case "SENT":
      return { label: "Sent", className: "bg-blue-50 text-blue-700" };
    default:
      return { label: "Pending", className: "bg-neutral-100 text-neutral-600" };
  }
}
