// ADR 0009 - GET /api/v1/portal/me/export. A resident downloads their own
// data. The person is always the signed-in user, never a parameter.
import type { APIRoute } from "astro";
import { requireResidentRole } from "../../../../../domain/authorization/guards";
import { exportPersonData } from "../../../../../domain/privacy/person-export";
import { withRequestDb } from "../../../../../lib/db-request";
import { toApiErrorResponse } from "../../../../../lib/http/api-error";
import { limitOrThrow } from "../../../../../lib/http/rate-limit";

export const GET: APIRoute = async ({ locals }) => {
  try {
    requireResidentRole(locals.auth);
    const userId = locals.auth.userId;
    await limitOrThrow("export", userId);
    const data = await withRequestDb((db) =>
      exportPersonData(db, {
        userId,
        organizationId: null,
        actorUserId: userId,
      })
    );
    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="my-data.json"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
};
