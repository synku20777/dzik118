import type { billingCaseStatusEnum } from "../../db/schema/billing";

type CaseStatus = (typeof billingCaseStatusEnum.enumValues)[number];
export type CaseStatusFilter = CaseStatus | "UNSENT";

/**
 * The dashboard's send queue: every invoice with no send date, whatever its
 * status. A credit can pay an invoice before it is sent, and a sent invoice
 * can be set back to Prepared.
 */
export function caseMatchesStatus(
  status: CaseStatus,
  filter?: CaseStatusFilter,
  unsentInvoice = false
): boolean {
  if (!filter) return true;
  return filter === "UNSENT" ? unsentInvoice : status === filter;
}
