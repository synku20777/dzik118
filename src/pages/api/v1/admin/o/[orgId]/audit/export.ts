// Phase L (Automation/audit) - GET /api/v1/admin/o/:orgId/audit/export
// File-download shaped, hence an API endpoint rather than an Astro Action.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "../../../../../../../db/client";
import { requireOrganizationAccess } from "../../../../../../../domain/authorization/guards";
import { exportAuditLogsCsv } from "../../../../../../../domain/audit/audit-log";
import { getOrganization } from "../../../../../../../domain/organizations/organizations";
import { parseDateInput } from "../../../../../../../lib/date-input";
import { toApiErrorResponse } from "../../../../../../../lib/http/api-error";

export const GET: APIRoute = async ({ params, locals, url }) => {
  const organizationId = params.orgId;
  if (!organizationId) {
    return toApiErrorResponse(new Error("missing orgId"));
  }

  try {
    requireOrganizationAccess(locals.auth, organizationId);
  } catch (err) {
    return toApiErrorResponse(err);
  }

  const action = url.searchParams.get("action") || undefined;
  const entityType = url.searchParams.get("entityType") || undefined;
  const actor = url.searchParams.get("actor") || undefined;
  const rawFrom = url.searchParams.get("from") || null;
  const rawTo = url.searchParams.get("to") || null;
  const from = parseDateInput(rawFrom);
  const to = parseDateInput(rawTo);
  // Unlike the page, an export must not quietly widen a filter it cannot read.
  if (
    (actor &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        actor
      )) ||
    (rawFrom && !from) ||
    (rawTo && !to)
  ) {
    return new Response("Invalid filter", { status: 400 });
  }

  const db = await createDb(env.HYPERDRIVE.connectionString);
  let csv: string;
  try {
    const org = await getOrganization(db, organizationId);
    csv = await exportAuditLogsCsv(db, organizationId, {
      action,
      entityType,
      actorUserId: actor,
      fromDate: from,
      toDate: to,
      timezone: org.timezone,
    });
  } finally {
    await db.$client.end();
  }

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-${organizationId}.csv"`,
      "Cache-Control": "no-store",
    },
  });
};
