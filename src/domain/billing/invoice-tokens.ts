// Phase G (Invoices/delivery) - invoice access tokens (spec Section 24).
// The raw token is never stored (spec: "token never logged" -- extended
// here to "never persisted" too); only HMAC-SHA256(INVOICE_TOKEN_SECRET,
// rawToken) is, so a leaked database alone doesn't let an attacker verify
// guesses against a known token format offline.
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import { invoiceAccessTokens } from "../../db/schema/invoices";
import { hmacSha256Hex } from "../../lib/hash";
import { recordAuditEvent } from "../../lib/logging/audit";
import { NotFoundError } from "../errors";

export { NotFoundError };

function randomToken(): string {
  // 256-bit token (spec Section 24), base64url so it's URL-safe with no
  // padding to strip.
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Generates a new raw token and stores only its hash. Does not revoke any
// prior token for this invoice -- an explicit resend (spec Section 23:
// "explicit resend creates a new delivery attempt") intentionally issues
// a fresh link without invalidating one already in a resident's inbox;
// revocation is a separate, deliberate admin action.
export async function createInvoiceAccessToken(
  db: DbOrTx,
  organizationId: string,
  invoiceId: string,
  tokenSecret: string,
  expiresAt: Date | null,
  actorUserId: string
): Promise<string> {
  const rawToken = randomToken();
  const tokenHash = await hmacSha256Hex(tokenSecret, rawToken);
  await db.insert(invoiceAccessTokens).values({
    organizationId,
    invoiceId,
    tokenHash,
    expiresAt,
  });
  await recordAuditEvent(db, {
    organizationId,
    actorUserId,
    action: "INVOICE_ACCESS_TOKEN_CREATED",
    entityType: "invoice",
    entityId: invoiceId,
    // Never the raw token or its hash -- spec Section 24: "token never
    // logged".
  });
  return rawToken;
}

// Resolves a raw token from the public /invoice/access/[token] route to
// its invoice id. Throws NotFoundError uniformly for "no such token",
// "revoked", and "expired" -- a public endpoint must not distinguish
// these to a caller who doesn't already know the answer.
export async function resolveInvoiceAccessToken(
  db: Db,
  rawToken: string,
  tokenSecret: string
): Promise<{ organizationId: string; invoiceId: string }> {
  const tokenHash = await hmacSha256Hex(tokenSecret, rawToken);
  const now = new Date();
  const [row] = await db
    .select({
      organizationId: invoiceAccessTokens.organizationId,
      invoiceId: invoiceAccessTokens.invoiceId,
    })
    .from(invoiceAccessTokens)
    .where(
      and(
        eq(invoiceAccessTokens.tokenHash, tokenHash),
        isNull(invoiceAccessTokens.revokedAt),
        or(
          isNull(invoiceAccessTokens.expiresAt),
          gt(invoiceAccessTokens.expiresAt, now)
        )
      )
    )
    .limit(1);
  if (!row) throw new NotFoundError("Invalid or expired invoice link");
  return row;
}

// Spec Section 24: "token may be revoked" -- an admin-triggered action
// (e.g. a compromised link) invalidates every still-active token for this
// invoice at once, without touching sentAt/case status.
export async function revokeInvoiceAccessTokens(
  db: Db,
  organizationId: string,
  invoiceId: string,
  actorUserId: string
): Promise<void> {
  await db
    .update(invoiceAccessTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invoiceAccessTokens.organizationId, organizationId),
        eq(invoiceAccessTokens.invoiceId, invoiceId),
        isNull(invoiceAccessTokens.revokedAt)
      )
    );
  await recordAuditEvent(db, {
    organizationId,
    actorUserId,
    action: "INVOICE_ACCESS_TOKEN_REVOKED",
    entityType: "invoice",
    entityId: invoiceId,
  });
}
