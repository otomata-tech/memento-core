/**
 * Test d'intégration de l'onboarding (`ensureDefaultWorkspace`) contre une base
 * Postgres réelle — premier test du repo, sans framework : juste `deno test`.
 *
 * Couvre l'invariant « un compte loggé n'est jamais sans KB » :
 *   1. compte vierge → org perso + KB privée par défaut (+ grant curator), 1 KB accessible ;
 *   2. idempotence : second appel ne crée pas de 2e KB ;
 *   3. compte ayant DÉJÀ une KB (membre d'une org avec base `org`) → aucune KB perso créée ;
 *   4. anonyme (sub="") → no-op.
 *
 * Prérequis : Postgres local migré (mem_* + migration 0015) avec un schéma `auth.users`
 * (cf. server/src/seed-auth-local.ts). Lancement :
 *   DATABASE_URL=postgresql://tuls:tuls-dev@localhost:5434/memento \
 *     deno test --allow-env --allow-net --allow-read \
 *       supabase/functions/_shared/onboarding.test.ts
 */
import { and, eq, sql } from "drizzle-orm";
import { client, db, memberships, orgs, workspaceGrants, workspaces } from "./db.ts";
import { ensureDefaultWorkspace } from "./admin.ts";
import { accessibleWorkspaceIds } from "./access.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion échouée : ${msg}`);
}
function assertEquals(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) throw new Error(`assertion échouée : ${msg} (obtenu ${actual}, attendu ${expected})`);
}

/** Crée un user de test dans `auth.users` (schéma minimal recréé si absent) et renvoie son sub. */
async function seedUser(email: string): Promise<string> {
  const sub = crypto.randomUUID();
  await db.execute(sql`create schema if not exists auth`);
  await db.execute(sql`create table if not exists auth.users (id uuid primary key, email text)`);
  // `emailsFor` lit `last_sign_in_at` (détection pending) — absent du seed local minimal.
  await db.execute(sql`alter table auth.users add column if not exists last_sign_in_at timestamptz`);
  await db.execute(sql`insert into auth.users (id, email, last_sign_in_at) values (${sub}::uuid, ${email}, now())`);
  return sub;
}

/** Purge tout ce qu'un sub a pu créer/posséder, dans l'ordre des FK. */
async function purge(sub: string) {
  const myOrgs = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.personalFor, sub));
  await db.delete(workspaceGrants).where(eq(workspaceGrants.userId, sub));
  for (const o of myOrgs) await db.delete(workspaces).where(eq(workspaces.orgId, o.id));
  await db.delete(memberships).where(eq(memberships.userId, sub));
  await db.delete(orgs).where(eq(orgs.personalFor, sub));
  await db.execute(sql`delete from auth.users where id = ${sub}::uuid`);
}

Deno.test("onboarding — ensureDefaultWorkspace", async (t) => {
  try {
    await t.step("compte vierge → KB privée par défaut", async () => {
      const sub = await seedUser("vierge@local.invalid");
      try {
        await ensureDefaultWorkspace(sub);

        const [perso] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.personalFor, sub));
        assert(perso, "org perso provisionnée");

        const ws = await db.select({ id: workspaces.id, visibility: workspaces.visibility, orgId: workspaces.orgId })
          .from(workspaces).where(eq(workspaces.orgId, perso.id));
        assertEquals(ws.length, 1, "exactement 1 KB dans l'org perso");
        assertEquals(ws[0].visibility, "private", "KB par défaut en private");

        const grants = await db.select({ role: workspaceGrants.role }).from(workspaceGrants)
          .where(and(eq(workspaceGrants.workspaceId, ws[0].id), eq(workspaceGrants.userId, sub)));
        assertEquals(grants.length, 1, "grant posé au créateur (private n'hérite pas du rôle d'org)");
        assertEquals(grants[0].role, "curator", "grant curator (lecture/écriture)");

        const accessible = await accessibleWorkspaceIds(sub);
        assertEquals(accessible.length, 1, "1 KB accessible après onboarding");
        assertEquals(accessible[0], ws[0].id, "la KB accessible est bien celle créée");
      } finally {
        await purge(sub);
      }
    });

    await t.step("idempotence — second appel ne crée pas de 2e KB", async () => {
      const sub = await seedUser("idem@local.invalid");
      try {
        await ensureDefaultWorkspace(sub);
        await ensureDefaultWorkspace(sub);
        const accessible = await accessibleWorkspaceIds(sub);
        assertEquals(accessible.length, 1, "toujours exactement 1 KB après 2 appels");
      } finally {
        await purge(sub);
      }
    });

    await t.step("compte ayant déjà une KB → pas de KB perso créée", async () => {
      const sub = await seedUser("deja@local.invalid");
      const otherOrgId = crypto.randomUUID();
      const otherWsId = crypto.randomUUID();
      try {
        await db.insert(orgs).values({ id: otherOrgId, slug: `t-org-${otherOrgId.slice(0, 8)}`, name: "Org tierce" });
        await db.insert(workspaces).values({
          id: otherWsId, slug: `t-ws-${otherWsId.slice(0, 8)}`, name: "Base partagée",
          summary: "", orgId: otherOrgId, visibility: "org",
        });
        await db.insert(memberships).values({ orgId: otherOrgId, userId: sub, role: "member" });

        await ensureDefaultWorkspace(sub);

        const [perso] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.personalFor, sub));
        assert(perso, "org perso quand même provisionnée");
        const persoWs = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.orgId, perso.id));
        assertEquals(persoWs.length, 0, "aucune KB perso créée (il a déjà accès à une base)");

        const accessible = await accessibleWorkspaceIds(sub);
        assertEquals(accessible.length, 1, "toujours sa seule KB pré-existante");
        assertEquals(accessible[0], otherWsId, "= la base de l'org tierce");
      } finally {
        await purge(sub);
        await db.delete(memberships).where(eq(memberships.orgId, otherOrgId));
        await db.delete(workspaces).where(eq(workspaces.id, otherWsId));
        await db.delete(orgs).where(eq(orgs.id, otherOrgId));
      }
    });

    await t.step("anonyme (sub vide) → no-op", async () => {
      await ensureDefaultWorkspace(""); // ne doit rien créer ni lever
      const orphan = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.personalFor, ""));
      assertEquals(orphan.length, 0, "aucune org perso pour un sub vide");
    });
  } finally {
    await client.end();
  }
});
