/**
 * Dev local uniquement : le Postgres local (Docker) n'a pas le schéma `auth` de
 * Supabase. En prod, la fonction Edge pointe sur le Postgres Supabase où `auth.users`
 * coexiste avec `public.mem_*` ; les requêtes de l'admin (résolution email↔sub) en
 * dépendent. On recrée ici une table `auth.users(id, email)` minimale, semée avec les
 * users déjà présents dans mem_memberships, pour que /admin marche en local.
 *
 * Usage : DATABASE_URL=<local> npx tsx server/src/seed-auth-local.ts
 */
import { sql } from "drizzle-orm";
import { db, memberships } from "./db.ts";

// Map optionnel sub (uuid Supabase) → email, pour un affichage lisible en local.
// Renseigne tes propres users ; sinon un email `<sub>@local.invalid` est généré.
const KNOWN: Record<string, string> = {};

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
console.log(`auth.users semée : ${seeded} user(s) — ${subs.join(", ")}`);
process.exit(0);
