// Phase D (Organizations/dwellings) - Supabase admin client. Used only to
// provision identities for admin-driven access assignment (spec Section
// 15.1: "resident must already have a dwelling_access row from an
// admin-driven assignment", DWL-003 "creates/links resident app identity
// appropriately"). Never used for anything authorization-related -- that
// stays app-owned per spec Section 8.
import { createClient } from "@supabase/supabase-js";

// Takes credentials explicitly (like createDb(connectionString)) rather
// than reading astro:env/server internally: that virtual module only
// resolves inside Astro's own Vite pipeline, so a function that read it
// directly couldn't be exercised by a plain script/test runner. Callers
// (the Actions layer) read the env vars and pass them in.
export function createSupabaseAdminClient(
  supabaseUrl: string,
  supabaseSecretKey: string
) {
  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ponytail: falls back to a bounded paginated scan of all Supabase users
// when creation fails, since the admin API has no getUserByEmail. Fine at
// the ~1,000 user scale this spec targets (Section 41); if that stops
// being true, call GoTrue's REST filter param directly instead.
//
// Falls back on ANY createUser error, not just GoTrue's documented
// "email_exists"/"user_already_exists" codes: two requests provisioning
// the same brand-new email concurrently can race past GoTrue's own
// pre-check and hit the DB unique constraint directly, which GoTrue
// surfaces as a generic "Database error creating new user" -- a different
// code, but the same "it exists now" situation the lookup below handles.
export async function findOrCreateSupabaseUser(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  email: string
) {
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (!created.error) {
    return created.data.user;
  }

  const normalizedEmail = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw created.error;
    const found = data.users.find(
      (u) => u.email?.toLowerCase() === normalizedEmail
    );
    if (found) return found;
    if (data.users.length < 200) break;
  }
  throw created.error;
}
