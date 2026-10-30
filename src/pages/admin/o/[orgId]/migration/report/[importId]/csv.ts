// GET: the reconciliation report of an opening balance import as a CSV file.
import type { APIRoute } from "astro";
import {
  ForbiddenError,
  requireOrganizationAccess,
} from "../../../../../../../domain/authorization/guards";
import { NotFoundError } from "../../../../../../../domain/errors";
import { getBalanceReport } from "../../../../../../../domain/migration/balances";
import {
  CSV_BOM,
  balanceReportCsv,
} from "../../../../../../../domain/migration/flow";
import { withRequestDb } from "../../../../../../../lib/db-request";
import { translate, uiLocale } from "../../../../../../../lib/ui/i18n";

export const GET: APIRoute = async ({ params, locals, url, cookies }) => {
  const organizationId = params.orgId;
  const importId = params.importId;
  if (!organizationId || !importId || !/^[0-9a-f-]{36}$/i.test(importId)) {
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
  try {
    const report = await withRequestDb((db) =>
      getBalanceReport(db, organizationId, importId)
    );
    const locale = uiLocale(cookies, url);
    const csv = balanceReportCsv(report, (text) => translate(locale, text));
    return new Response(CSV_BOM + csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="opening-balances.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return new Response("Not found", { status: 404 });
    }
    throw err;
  }
};
