// POST: the rows of a dwellings import that need attention, as a CSV the admin
// fixes in the spreadsheet. The file text and the mapping come from the page's
// hidden fields, so everything is parsed and validated again here.
import type { APIRoute } from "astro";
import {
  ForbiddenError,
  requireOrganizationAccess,
} from "../../../../../domain/authorization/guards";
import { ValidationError } from "../../../../../domain/errors";
import { parseTable } from "../../../../../domain/migration/files";
import {
  hasValidAmountMapping,
  parseBalanceDate,
  validateBalances,
} from "../../../../../domain/migration/balances";
import { CSV_BOM, issuesCsv } from "../../../../../domain/migration/flow";
import { MIGRATION_MAX_BYTES } from "../../../../../domain/migration/limits";
import { validateMapping } from "../../../../../domain/migration/mapping";
import { validateDwellings } from "../../../../../domain/migration/dwellings";
import { validateMeters } from "../../../../../domain/migration/meters";
import { withRequestDb } from "../../../../../lib/db-request";
import { isSameOriginRequest } from "../../../../../lib/http/same-origin";
import { translate, uiLocale } from "../../../../../lib/ui/i18n";

export const POST: APIRoute = async ({
  params,
  locals,
  request,
  url,
  cookies,
}) => {
  const organizationId = params.orgId;
  if (!organizationId) return new Response("Not found", { status: 404 });
  if (!isSameOriginRequest(request, url)) {
    return new Response("Cross-site submission forbidden", { status: 403 });
  }
  try {
    requireOrganizationAccess(locals.auth, organizationId);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return new Response("Forbidden", { status: 403 });
    }
    throw err;
  }

  const form = await request.formData();
  const text = String(form.get("text") ?? "");
  if (new TextEncoder().encode(text).length > MIGRATION_MAX_BYTES) {
    return new Response("Too large", { status: 413 });
  }
  const fields = form
    .getAll("field")
    .map((f) => (String(f) === "" ? null : String(f)));
  const mode = form.get("mode") === "update" ? "update" : "create";
  const balances = form.get("kind") === "balances";
  const metersKind = form.get("kind") === "meters";

  try {
    const table = parseTable(text);
    if (
      validateMapping(
        balances ? "BALANCES" : metersKind ? "METERS" : "DWELLINGS",
        table.headers.length,
        fields
      ).length > 0 ||
      (balances && !hasValidAmountMapping(fields))
    ) {
      return new Response("Invalid mapping", { status: 400 });
    }
    const { rows } = await withRequestDb(async (db) =>
      balances
        ? validateBalances(db, organizationId, table, fields, {
            balanceDate: parseBalanceDate(
              String(form.get("balanceDate") ?? "")
            ),
            sign:
              form.get("sign") === "POSITIVE_CREDIT"
                ? "POSITIVE_CREDIT"
                : "POSITIVE_OWES",
          })
        : metersKind
          ? validateMeters(db, organizationId, table, fields)
          : validateDwellings(db, organizationId, table, fields, mode)
    );
    const locale = uiLocale(cookies, url);
    const csv = issuesCsv(rows, (t) => translate(locale, t));
    return new Response(CSV_BOM + csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="import-issues.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return new Response("Invalid file", { status: 400 });
    }
    throw err;
  }
};
