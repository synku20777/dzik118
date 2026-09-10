// Phase D (Organizations/dwellings) - GET /api/v1/admin/o/:orgId/dwellings/export
// (spec Section 11). File-download shaped, hence an API endpoint rather
// than an Astro Action (spec Section 3.1).
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "../../../../../../../db/client";
import { requireOrganizationAccess } from "../../../../../../../domain/authorization/guards";
import { exportDwellingsCsv } from "../../../../../../../domain/organizations/csv-import";
import { toApiErrorResponse } from "../../../../../../../lib/http/api-error";

export const GET: APIRoute = async ({ params, locals }) => {
  const organizationId = params.orgId;
  if (!organizationId) {
    return toApiErrorResponse(new Error("missing orgId"));
  }

  try {
    requireOrganizationAccess(locals.auth, organizationId);
  } catch (err) {
    return toApiErrorResponse(err);
  }

  const db = await createDb(env.HYPERDRIVE.connectionString);
  let csv: string;
  try {
    csv = await exportDwellingsCsv(db, organizationId);
  } finally {
    await db.$client.end();
  }

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dwellings-${organizationId}.csv"`,
    },
  });
};
