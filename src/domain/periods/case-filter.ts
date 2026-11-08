import type { billingCaseStatusEnum } from "../../db/schema/billing";

type CaseStatus = (typeof billingCaseStatusEnum.enumValues)[number];
export type CaseStatusFilter = CaseStatus | "UNSENT";

/** The dashboard's send queue includes drafts and approved, unsent invoices. */
export function caseMatchesStatus(
  status: CaseStatus,
  filter?: CaseStatusFilter
): boolean {
  if (!filter) return true;
  return filter === "UNSENT"
    ? status === "DRAFT" || status === "PREPARED"
    : status === filter;
}
