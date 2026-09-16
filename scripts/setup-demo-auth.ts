import { createSupabaseAdminClient } from "../src/lib/supabase/admin";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
}

const users: { id: string; email: string; password?: string }[] = [
  {
    id: "10000000-0000-4000-8000-0000000000a1",
    email: "admin.a@example.com",
    password: "ChangeMe123!",
  },
  {
    id: "10000000-0000-4000-8000-0000000000b1",
    email: "admin.b@example.com",
    password: "ChangeMe123!",
  },
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `20000000-0000-4000-8000-00000000000${i + 1}`,
    email: `resident${i + 1}@example.com`,
  })),
  {
    id: "20000000-0000-4000-8000-0000000000b1",
    email: "resident.b1@example.com",
  },
];

const admin = createSupabaseAdminClient(supabaseUrl, supabaseSecretKey);
const existing = [];
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({
    page,
    perPage: 200,
  });
  if (error) throw error;
  existing.push(...data.users);
  if (data.users.length < 200) break;
}

for (const user of users) {
  const byId = existing.find((candidate) => candidate.id === user.id);
  const byEmail = existing.find(
    (candidate) => candidate.email?.toLowerCase() === user.email.toLowerCase()
  );
  if (byEmail && byEmail.id !== user.id) {
    throw new Error(`${user.email} already exists with a different Auth id`);
  }

  const attributes = {
    email: user.email,
    email_confirm: true,
    ...(user.password ? { password: user.password } : {}),
  };
  const result = byId
    ? await admin.auth.admin.updateUserById(user.id, attributes)
    : await admin.auth.admin.createUser({ id: user.id, ...attributes });
  if (result.error) throw result.error;
}

console.log(`Supabase Auth demo users ready: ${users.length}`);
