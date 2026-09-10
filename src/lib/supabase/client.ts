// Phase C (Auth/security) - Browser Supabase client (spec Section 34): only
// for auth/session interactions (admin password sign-in). No direct table
// access from the browser for any financial-domain table.
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient(
  supabaseUrl: string,
  supabasePublishableKey: string
) {
  return createBrowserClient(supabaseUrl, supabasePublishableKey, {
    // Cookies must never be sent over plain HTTP once deployed (spec
    // Section 33). Derived from the actual page origin, so local http://
    // dev still works.
    cookieOptions: { secure: window.location.protocol === "https:" },
  });
}
