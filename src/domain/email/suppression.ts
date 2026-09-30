// Suppressed email addresses (ADR 0008). An address lands here when SES
// reports a permanent bounce or a complaint. Invoices are not sent to it
// until an admin removes it or changes the billing email.
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import { suppressedEmails } from "../../db/schema/email";
import { invoiceDeliveries } from "../../db/schema/invoices";
import { recordAuditEvent } from "../../lib/logging/audit";
import { ConflictError, NotFoundError } from "../errors";

export { ConflictError, NotFoundError };

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

// SES reports an address, not an organization. Suppress it for every
// organization that has emailed an invoice to it, so each one stops sending.
// An address that no organization has used is ignored.
export async function suppressEmail(
  db: Db,
  input: { email: string; reason: "BOUNCE" | "COMPLAINT"; detail: string }
): Promise<number> {
  const email = normalize(input.email);
  return db.transaction(async (tx) => {
    const organizations = await tx
      .selectDistinct({ organizationId: invoiceDeliveries.organizationId })
      .from(invoiceDeliveries)
      .where(
        sql`lower(btrim(${invoiceDeliveries.destinationEmail})) = ${email}`
      );

    let added = 0;
    for (const { organizationId } of organizations) {
      const [row] = await tx
        .insert(suppressedEmails)
        .values({
          organizationId,
          email,
          reason: input.reason,
          detail: input.detail,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) continue;
      added++;
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: null,
        action: "EMAIL_SUPPRESSED",
        entityType: "suppressed_email",
        entityId: row.id,
        afterData: { email, reason: input.reason, detail: input.detail },
      });
    }
    return added;
  });
}

export async function isEmailSuppressed(
  db: DbOrTx,
  organizationId: string,
  email: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: suppressedEmails.id })
    .from(suppressedEmails)
    .where(
      and(
        eq(suppressedEmails.organizationId, organizationId),
        eq(suppressedEmails.email, normalize(email))
      )
    )
    .limit(1);
  return !!row;
}

export async function assertEmailNotSuppressed(
  db: DbOrTx,
  organizationId: string,
  email: string
): Promise<void> {
  if (await isEmailSuppressed(db, organizationId, email)) {
    throw new ConflictError(
      "This email address bounced or reported a complaint. Change the billing email or remove it from the suppressed list"
    );
  }
}

export async function listSuppressedEmails(db: Db, organizationId: string) {
  return db
    .select()
    .from(suppressedEmails)
    .where(eq(suppressedEmails.organizationId, organizationId))
    .orderBy(asc(suppressedEmails.email));
}

export async function removeSuppression(
  db: Db,
  organizationId: string,
  suppressionId: string,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(suppressedEmails)
      .where(
        and(
          eq(suppressedEmails.id, suppressionId),
          eq(suppressedEmails.organizationId, organizationId)
        )
      )
      .returning();
    if (!removed) throw new NotFoundError("Suppressed address not found");
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "EMAIL_SUPPRESSION_REMOVED",
      entityType: "suppressed_email",
      entityId: suppressionId,
      beforeData: removed,
    });
    return removed;
  });
}
