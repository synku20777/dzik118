// GET /api/health: liveness plus database reachability for uptime monitors.
// It returns no version, no configuration and no error detail.
import type { APIRoute } from "astro";
import { withRequestDb } from "../../lib/db-request";

export const GET: APIRoute = async () => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  try {
    await withRequestDb((db) => db.$client.query("select 1"));
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("health check failed", error);
    return new Response(JSON.stringify({ status: "error" }), {
      status: 503,
      headers,
    });
  }
};
