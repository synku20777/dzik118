// Phase G (Invoices/delivery) - idempotent private "invoices" bucket setup
// (spec Section 3.4: private bucket, no public object URLs). Run once per
// Supabase project (local or production) before any invoice is sent:
//   SUPABASE_URL=... SUPABASE_SECRET_KEY=... vite-node scripts/setup-storage.ts
// Safe to re-run -- does nothing if the bucket already exists.
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
}

const admin = createSupabaseAdminClient(supabaseUrl, supabaseSecretKey);

const { data: buckets, error: listError } = await admin.storage.listBuckets();
if (listError) throw listError;

const existing = buckets.find((b) => b.name === "invoices");
if (existing) {
  // Spec Section 22: "private bucket, no guessable public URL" -- a bucket
  // that already exists but was made public (e.g. manual misconfiguration)
  // must fail loudly, not be silently accepted as "already set up".
  if (existing.public) {
    throw new Error(
      "invoices bucket exists but is PUBLIC -- fix its visibility in Supabase Storage before sending any invoice"
    );
  }
  console.log("invoices bucket already exists and is private, nothing to do.");
} else {
  const { error } = await admin.storage.createBucket("invoices", {
    public: false,
    fileSizeLimit: "10MiB",
    allowedMimeTypes: ["application/pdf"],
  });
  if (error) throw error;
  console.log("Created private invoices bucket.");
}
