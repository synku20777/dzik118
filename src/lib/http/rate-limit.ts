import { env } from "cloudflare:workers";
import { RateLimitedError } from "../../domain/errors";

export async function limitOrThrow(prefix: string, key: string): Promise<void> {
  if (!env.AUTH_RATE_LIMITER) return;
  const result = await env.AUTH_RATE_LIMITER.limit({ key: `${prefix}:${key}` });
  if (!result.success) {
    throw new RateLimitedError();
  }
}
