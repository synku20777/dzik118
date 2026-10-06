import type { APIRoute } from "astro";
import {
  ForbiddenError,
  requireOrganizationAccess,
} from "../../../../../../domain/authorization/guards";
import { DWELLINGS_CSV_TEMPLATE } from "../../../../../../domain/organizations/csv-import";
import { OPENING_READINGS_HEADERS } from "../../../../../../domain/periods/opening-readings";

export const GET: APIRoute = async ({ params, locals }) => {
  const organizationId = params.orgId;
  if (!organizationId) {
    return new Response("Not found", { status: 404 });
  }

  try {
    requireOrganizationAccess(locals.auth, organizationId);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return new Response("Forbidden", { status: 403 });
    }
    throw err;
  }

  const name = params.name;
  let body: string;
  if (name === "dwellings.csv") {
    body = DWELLINGS_CSV_TEMPLATE;
  } else if (name === "starting-readings.csv") {
    body = OPENING_READINGS_HEADERS.join(",") + "\n";
  } else {
    return new Response("Not found", { status: 404 });
  }

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
};
