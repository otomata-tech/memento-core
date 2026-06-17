/**
 * Vue plateforme — l'inventaire des COMPTES (auth.users), au-delà du scoping par org.
 * Le signup Google est ouvert : des comptes peuvent exister sans appartenir à aucune
 * org (invisibles dans /org/:slug/membres). Cette vue les rend visibles.
 *
 * Gating : opérateurs plateforme déclarés dans MEMENTO_PLATFORM_ADMINS
 * (emails séparés par des virgules) — un rôle hors du modèle org, volontairement.
 */
import { sql } from "drizzle-orm";
import { db } from "./db.ts";
import { AccessError } from "./access.ts";

async function assertPlatformAdmin(sub: string): Promise<void> {
  const raw = Deno.env.get("MEMENTO_PLATFORM_ADMINS") ?? "";
  const admins = raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!admins.length) throw new AccessError("MEMENTO_PLATFORM_ADMINS non configuré");
  const rows = await db.execute<{ email: string }>(
    sql`select email from auth.users where id::text = ${sub} limit 1`,
  );
  const email = rows[0]?.email?.toLowerCase();
  if (!email || !admins.includes(email)) {
    throw new AccessError("réservé aux opérateurs plateforme");
  }
}

/** Tous les comptes + leurs appartenances (ou aucune). Tri : plus récent d'abord. */
export async function listAccounts(sub: string) {
  await assertPlatformAdmin(sub);
  const rows = await db.execute<{
    id: string; email: string; provider: string | null;
    created_at: string; last_sign_in_at: string | null; orgs: string | null;
  }>(sql`
    select u.id::text as id, u.email,
           u.raw_app_meta_data->>'provider' as provider,
           u.created_at, u.last_sign_in_at,
           string_agg(distinct o.slug || ':' || m.role, ', ') as orgs
    from auth.users u
    left join mem_memberships m on m.user_id = u.id::text
    left join mem_orgs o on o.id = m.org_id
    group by u.id, u.email, u.raw_app_meta_data, u.created_at, u.last_sign_in_at
    order by u.created_at desc`);
  return {
    count: rows.length,
    accounts: [...rows].map((r) => ({
      id: r.id,
      email: r.email,
      provider: r.provider,
      createdAt: r.created_at,
      lastSignInAt: r.last_sign_in_at,
      // null = compte sans aucune org : il ne voit aucune KB, mais il existe.
      orgs: r.orgs,
    })),
  };
}
