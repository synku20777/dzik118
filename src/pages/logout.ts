// Phase C (Auth/security) - Logout action/redirect (spec Section 9.1).
import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../lib/supabase/server";

export const GET: APIRoute = async ({ request, cookies, redirect }) => {
  const { supabase, applyPendingHeaders } = createSupabaseServerClient(
    request,
    cookies
  );
  await supabase.auth.signOut();
  return applyPendingHeaders(redirect("/login"));
};
