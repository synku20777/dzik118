// Phase C/M (Auth/security) - Logout action/redirect (spec Section 9.1).
// State-changing logout is restricted to POST with same-origin verification
// to eliminate Logout CSRF via external <img> or <iframe> tags.
import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../lib/supabase/server";

export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return new Response("Cross-site logout forbidden", { status: 403 });
  }

  const { supabase, applyPendingHeaders } = createSupabaseServerClient(
    request,
    cookies
  );
  await supabase.auth.signOut();
  return applyPendingHeaders(redirect("/login", 303));
};

export const GET: APIRoute = ({ redirect }) => {
  // GET does not terminate session automatically to protect against CSRF
  return redirect("/login", 302);
};
