// Shared Supabase admin client construction for Astro Actions (see _db.ts
// for why this reads astro:env/server here rather than inside the domain
// functions that use it).
import { SUPABASE_SECRET_KEY, SUPABASE_URL } from "astro:env/server";
import { createSupabaseAdminClient } from "../lib/supabase/admin";

export function getSupabaseAdmin() {
  return createSupabaseAdminClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
}
