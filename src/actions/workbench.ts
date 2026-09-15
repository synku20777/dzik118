// Contextual admin drawer UX - one combined read for everything a workbench
// drawer needs to render for one dwelling/period, so opening either drawer
// is a single client-side fetch instead of several. Called imperatively
// from client script (astro:actions supports this beyond form submission),
// so this intentionally has no `accept: "form"` -- it's a JSON action.
import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireOrganizationAccess } from "../domain/authorization/guards";
import { getDwelling } from "../domain/organizations/dwellings";
import { getOrganization } from "../domain/organizations/organizations";
import {
  listCasesForPeriod,
  listManualRuleInputsForPeriod,
  listMetersWithReadingForPeriod,
} from "../domain/periods/cases";
import { getPeriod } from "../domain/periods/periods";
import { safeHandler } from "./_errors";
import { withRequestDb as withDb } from "../lib/db-request";

export const workbench = {
  // Feeds both MeterReadingsDrawer and BillingDetailsDrawer: the caller
  // already knows which drawer it's opening, so it's simpler for this to
  // always return both meters and dwelling billing fields than to add a
  // second near-identical action for a query this cheap.
  getDrawerData: defineAction({
    input: z.object({
      organizationId: z.uuid(),
      periodId: z.uuid(),
      dwellingId: z.uuid(),
    }),
    handler: safeHandler(
      async ({ organizationId, periodId, dwellingId }, { locals }) => {
        requireOrganizationAccess(locals.auth, organizationId);
        return withDb(async (db) => {
          const dwelling = await getDwelling(db, organizationId, dwellingId);
          const organization = await getOrganization(db, organizationId);
          const period = await getPeriod(db, organizationId, periodId);
          const meters = await listMetersWithReadingForPeriod(
            db,
            organizationId,
            dwellingId,
            periodId
          );
          const manualRuleInputs = await listManualRuleInputsForPeriod(
            db,
            organizationId,
            dwellingId,
            periodId,
            period
          );
          const cases = await listCasesForPeriod(db, organizationId, periodId);
          const billingCase = cases.find((c) => c.dwellingId === dwellingId);
          return {
            dwelling: {
              id: dwelling.id,
              number: dwelling.number,
              occupantName: dwelling.occupantName,
              billingName: dwelling.billingName,
              billingEmail: dwelling.billingEmail,
              billingAddress: dwelling.billingAddress,
              notes: dwelling.notes,
            },
            organization: {
              addressLine1: organization.addressLine1,
            },
            billingCase: billingCase
              ? {
                  status: billingCase.status,
                  invoiceId: billingCase.invoiceId,
                  invoiceNumber: billingCase.invoiceNumber,
                }
              : null,
            meters: meters
              .filter((m) => !m.archivedAt)
              .map((m) => ({
                meterId: m.meterId,
                type: m.type,
                label: m.label,
                serialNumber: m.serialNumber,
                unit: m.unit,
                currentValue: m.currentValue,
                previousValue: m.previousValue,
                consumption: m.consumption,
              })),
            manualRuleInputs,
          };
        });
      }
    ),
  }),
};
