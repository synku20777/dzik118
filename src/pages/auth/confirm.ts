// TODO: Phase C (Auth/security) - Supabase OTP/magic-link confirmation endpoint
import type { APIRoute } from "astro";

export const GET: APIRoute = async () => {
  return new Response("Auth confirm placeholder - Phase C", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
};
