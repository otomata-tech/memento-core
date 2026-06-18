/**
 * Local dev only: the local Postgres (Docker) does not have Supabase's `auth`
 * schema. In prod, the Edge function targets the Supabase Postgres where `auth.users`
 * coexists with `public.mem_*`; the admin's queries (email↔sub resolution) depend on
 * it. Here we recreate a minimal `auth.users(id, email)` table, seeded with the users
 * already present in mem_memberships, so that /admin works locally.
 *
 * Usage: DATABASE_URL=<local> npx tsx server/src/seed-auth-local.ts
 */
import { sql } from "drizzle-orm";
import { db, memberships } from "./db.ts";

const KNOWN: Record<string, string> = {
};

await db.execute(sql`create schema if not exists auth`);
await db.execute(sql`create table if not exists auth.users (id uuid primary key, email text)`);

const rows = await db.select({ userId: memberships.userId }).from(memberships);
const subs = [...new Set(rows.map((r) => r.userId))];
let seeded = 0;
for (const sub of subs) {
  const email = KNOWN[sub] ?? `${sub}@local.invalid`;
  await db.execute(
    sql`insert into auth.users (id, email) values (${sub}::uuid, ${email})
        on conflict (id) do update set email = excluded.email`,
  );
  seeded++;
}
console.log(`auth.users seeded: ${seeded} user(s) — ${subs.join(", ")}`);
process.exit(0);
