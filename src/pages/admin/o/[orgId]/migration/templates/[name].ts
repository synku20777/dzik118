import type { APIRoute } from "astro";
import {
  ForbiddenError,
  requireOrganizationAccess,
} from "../../../../../../domain/authorization/guards";
import {
  CSV_BOM,
  balancesTemplateCsv,
  dwellingsTemplateCsv,
  metersTemplateCsv,
} from "../../../../../../domain/migration/flow";

export const GET: APIRoute = async ({ params, locals }) => {
  const organizationId = params.orgId;
  if (!organizationId) return new Response("Not found", { status: 404 });
  try {
    requireOrganizationAccess(locals.auth, organizationId);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return new Response("Forbidden", { status: 403 });
    }
    throw err;
  }

  const csv =
    params.name === "dwellings.csv"
      ? dwellingsTemplateCsv()
      : params.name === "balances.csv"
        ? balancesTemplateCsv()
        : params.name === "meters.csv"
          ? metersTemplateCsv()
          : null;
  if (csv === null) return new Response("Not found", { status: 404 });
  return new Response(CSV_BOM + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${params.name}"`,
      "Cache-Control": "no-store",
    },
  });
};
