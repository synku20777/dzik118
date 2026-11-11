// Phase K (Messaging/data) - GET /api/v1/admin/o/:orgId/readings/export
// (spec Section 11). File-download shaped, hence an API endpoint rather
// than an Astro Action (spec Section 3.1), same reasoning as the dwellings
// export.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "../../../../../../../db/client";
import { requireOrganizationAccess } from "../../../../../../../domain/authorization/guards";
import { exportReadingsCsv } from "../../../../../../../domain/periods/readings-export";
import { toApiErrorResponse } from "../../../../../../../lib/http/api-error";
import { ValidationError } from "../../../../../../../domain/errors";

export const GET: APIRoute = async ({ params, locals }) => {
  const organizationId = params.orgId;
  if (!organizationId) {
    return toApiErrorResponse(
      new ValidationError("An organization id is required")
    );
  }

  try {
    requireOrganizationAccess(locals.auth, organizationId);
  } catch (err) {
    return toApiErrorResponse(err);
  }

  let csv: string;
  try {
    const db = await createDb(env.HYPERDRIVE.connectionString);
    try {
      csv = await exportReadingsCsv(db, organizationId);
    } finally {
      await db.$client.end();
    }
  } catch (err) {
    return toApiErrorResponse(err);
  }

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="readings-${organizationId}.csv"`,
      "Cache-Control": "no-store",
    },
  });
};
