// Per-request context for the audit trail. The middleware opens it around
// every request, and recordAuditEvent reads it, so no domain function has to
// pass a request ID or an IP down the call chain.
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
  // HMAC of the client IP. null when there is no IP or no secret: a plain IP
  // is never stored.
  ipHash: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T
): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function newRequestId(): string {
  return `req_${crypto.randomUUID()}`;
}

// Stable for one IP and secret, so two audit rows from the same address match.
// Not reversible without the secret.
export async function hashIp(
  ip: string | null,
  secret: string | undefined
): Promise<string | null> {
  if (!ip || !secret) return null;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(ip));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
