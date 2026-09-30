// ADR 0009 - GET /api/v1/admin/o/:orgId/residents/:userId/export. An admin
// downloads the data the app holds about one person of their organization.
// Reading stays allowed in an archived organization.
import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { requireOrganizationAccess } from "../../../../../../../../domain/authorization/guards";
import { NotFoundError } from "../../../../../../../../domain/errors";
import { exportPersonData } from "../../../../../../../../domain/privacy/person-export";
import { withRequestDb } from "../../../../../../../../lib/db-request";
import { toApiErrorResponse } from "../../../../../../../../lib/http/api-error";
import { limitOrThrow } from "../../../../../../../../lib/http/rate-limit";

export const GET: APIRoute = async ({ params, locals }) => {
  const organizationId = params.orgId;
  const userId = z.uuid().safeParse(params.userId);
  if (!organizationId || !userId.success) {
    return toApiErrorResponse(new NotFoundError("Person not found"));
  }

  try {
    requireOrganizationAccess(locals.auth, organizationId);
    await limitOrThrow("export", locals.auth!.userId);
    const data = await withRequestDb((db) =>
      exportPersonData(db, {
        userId: userId.data,
        organizationId,
        actorUserId: locals.auth!.userId,
      })
    );
    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="personal-data-${userId.data}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
};
