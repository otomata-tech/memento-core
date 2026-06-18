/**
 * Integration test of onboarding (`ensureDefaultWorkspace`) against a real
 * Postgres database — the repo's first test, no framework: just `deno test`.
 *
 * Covers the invariant "a logged-in account is never without a KB":
 *   1. blank account → personal org + default private KB (+ curator grant), 1 accessible KB;
 *   2. idempotence: second call does not create a 2nd KB;
 *   3. account that ALREADY has a KB (member of an org with an `org` base) → no personal KB created;
 *   4. anonymous (sub="") → no-op.
 *
 * Prerequisites: local Postgres migrated (mem_* + migration 0015) with an `auth.users` schema
 * (cf. server/src/seed-auth-local.ts). Run:
 *   DATABASE_URL=postgresql://tuls:tuls-dev@localhost:5434/memento \
 *     deno test --allow-env --allow-net --allow-read \
 *       supabase/functions/_shared/onboarding.test.ts
 */
import { and, eq, sql } from "drizzle-orm";
import { client, db, memberships, orgs, workspaceGrants, workspaces } from "./db.ts";
import { ensureDefaultWorkspace } from "./admin.ts";
import { accessibleWorkspaceIds } from "./access.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function assertEquals(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) throw new Error(`assertion failed: ${msg} (got ${actual}, expected ${expected})`);
}

/** Creates a test user in `auth.users` (minimal schema recreated if absent) and returns its sub. */
async function seedUser(email: string): Promise<string> {
  const sub = crypto.randomUUID();
  await db.execute(sql`create schema if not exists auth`);
  await db.execute(sql`create table if not exists auth.users (id uuid primary key, email text)`);
  // `emailsFor` reads `last_sign_in_at` (pending detection) — absent from the minimal local seed.
  await db.execute(sql`alter table auth.users add column if not exists last_sign_in_at timestamptz`);
  await db.execute(sql`insert into auth.users (id, email, last_sign_in_at) values (${sub}::uuid, ${email}, now())`);
  return sub;
}

/** Purges everything a sub may have created/owned, in FK order. */
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
    await t.step("blank account → default private KB", async () => {
      const sub = await seedUser("vierge@local.invalid");
      try {
        await ensureDefaultWorkspace(sub);

        const [perso] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.personalFor, sub));
        assert(perso, "personal org provisioned");

        const ws = await db.select({ id: workspaces.id, visibility: workspaces.visibility, orgId: workspaces.orgId })
          .from(workspaces).where(eq(workspaces.orgId, perso.id));
        assertEquals(ws.length, 1, "exactly 1 KB in the personal org");
        assertEquals(ws[0].visibility, "private", "default KB is private");

        const grants = await db.select({ role: workspaceGrants.role }).from(workspaceGrants)
          .where(and(eq(workspaceGrants.workspaceId, ws[0].id), eq(workspaceGrants.userId, sub)));
        assertEquals(grants.length, 1, "grant set on the creator (private does not inherit the org role)");
        assertEquals(grants[0].role, "curator", "curator grant (read/write)");

        const accessible = await accessibleWorkspaceIds(sub);
        assertEquals(accessible.length, 1, "1 accessible KB after onboarding");
        assertEquals(accessible[0], ws[0].id, "the accessible KB is indeed the one created");
      } finally {
        await purge(sub);
      }
    });

    await t.step("idempotence — second call does not create a 2nd KB", async () => {
      const sub = await seedUser("idem@local.invalid");
      try {
        await ensureDefaultWorkspace(sub);
        await ensureDefaultWorkspace(sub);
        const accessible = await accessibleWorkspaceIds(sub);
        assertEquals(accessible.length, 1, "still exactly 1 KB after 2 calls");
      } finally {
        await purge(sub);
      }
    });

    await t.step("account that already has a KB → no personal KB created", async () => {
      const sub = await seedUser("deja@local.invalid");
      const otherOrgId = crypto.randomUUID();
      const otherWsId = crypto.randomUUID();
      try {
        await db.insert(orgs).values({ id: otherOrgId, slug: `t-org-${otherOrgId.slice(0, 8)}`, name: "Third-party org" });
        await db.insert(workspaces).values({
          id: otherWsId, slug: `t-ws-${otherWsId.slice(0, 8)}`, name: "Shared base",
          summary: "", orgId: otherOrgId, visibility: "org",
        });
        await db.insert(memberships).values({ orgId: otherOrgId, userId: sub, role: "member" });

        await ensureDefaultWorkspace(sub);

        const [perso] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.personalFor, sub));
        assert(perso, "personal org provisioned anyway");
        const persoWs = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.orgId, perso.id));
        assertEquals(persoWs.length, 0, "no personal KB created (they already have access to a base)");

        const accessible = await accessibleWorkspaceIds(sub);
        assertEquals(accessible.length, 1, "still their only pre-existing KB");
        assertEquals(accessible[0], otherWsId, "= the third-party org's base");
      } finally {
        await purge(sub);
        await db.delete(memberships).where(eq(memberships.orgId, otherOrgId));
        await db.delete(workspaces).where(eq(workspaces.id, otherWsId));
        await db.delete(orgs).where(eq(orgs.id, otherOrgId));
      }
    });

    await t.step("anonymous (empty sub) → no-op", async () => {
      await ensureDefaultWorkspace(""); // must not create anything or throw
      const orphan = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.personalFor, ""));
      assertEquals(orphan.length, 0, "no personal org for an empty sub");
    });
  } finally {
    await client.end();
  }
});
