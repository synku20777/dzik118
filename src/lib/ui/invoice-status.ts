import type { IconName } from "./icons";

// Shared presentation only: billing_case remains the workflow authority.
export type InvoiceCaseStatus =
  "MISSING_DATA" | "READY" | "DRAFT" | "PREPARED" | "SENT" | "PAID" | "OVERDUE";

// Strict status -> icon mapping (Tabler Icons, Outline). Never invent a new
// icon per state -- the icon reinforces the text label, it never replaces
// it, so states that share a meaning share an icon.
const statuses: Record<string, [string, string, IconName]> = {
  MISSING_DATA: ["Missing data", "danger", "alert-triangle"],
  READY: ["Ready to invoice", "warning", "check"],
  DRAFT: ["Draft", "neutral", "file-description"],
  PREPARED: ["Prepared", "info", "check"],
  SENT: ["Sent", "info", "send"],
  PAID: ["Paid", "success", "circle-check"],
  OVERDUE: ["Overdue", "warning", "clock-exclamation"],
  // "OPEN" is shared by two unrelated domains (billing period + message
  // thread) -- "lock-open" reads sensibly for both ("not yet locked" /
  // "not yet resolved") without inventing a per-domain variant.
  OPEN: ["Open", "info", "lock-open"],
  LOCKED: ["Locked", "neutral", "lock"],
  ACTIVE: ["Active", "success", "check"],
  ARCHIVED: ["Archived", "neutral", "archive"],
  NEW: ["Awaiting reply", "warning", "clock-exclamation"],
  RESOLVED: ["Resolved", "success", "circle-check"],
  PROPOSED: ["Proposed", "info", "clock"],
  CONFIRMED: ["Confirmed", "success", "check"],
  REJECTED: ["Rejected", "neutral", "x"],
  UNMATCHED: ["Unmatched", "warning", "alert-triangle"],
  FAILED: ["Failed", "danger", "alert-triangle"],
};

export function invoiceStatusBadge(status: string) {
  const [label, tone, icon] = statuses[status] ?? [
    status,
    "neutral",
    "info-circle",
  ];
  return { label, tone, icon, className: "status-badge" };
}
