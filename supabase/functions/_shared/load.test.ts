/**
 * Integration test of the read-before-write path (`_shared/load.ts`) against a real
 * Postgres database — same setup as onboarding.test.ts (no framework).
 *
 * Covers: size (countBlocks), version (max revision), HMAC token (deterministic +
 * null without a secret), full load (loaded true/false depending on the threshold) and the
 * WARN guard (token absent/stale/fresh, inactive without a secret or above the threshold).
 *
 * Prerequisites: local Postgres migrated (mem_*). Run:
 *   DATABASE_URL=postgresql://tuls:tuls-dev@localhost:5434/memento \
 *     deno test --allow-env --allow-net --allow-read \
 *       supabase/functions/_shared/load.test.ts
 */
import { eq, sql } from "drizzle-orm";
import { blocks, db, documents, revisions, sections, settings, usageLogs, workspaces } from "./db.ts";
import { countBlocks, getWorkspaceVersion, loadGate, loadWorkspace, makeLoadToken } from "./load.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function assertEquals(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) throw new Error(`assertion failed: ${msg} (got ${actual}, expected ${expected})`);
}

async function seedKB(nBlocks: number): Promise<{ wsId: string; slug: string }> {
  const slug = `load-test-${crypto.randomUUID().slice(0, 8)}`;
  const [ws] = await db.insert(workspaces).values({ slug, name: slug, visibility: "private" }).returning();
  const [sec] = await db.insert(sections).values({ workspaceId: ws.id, title: "S", slug: "s" }).returning();
  const [doc] = await db.insert(documents).values({ sectionId: sec.id, title: "D", slug: "d" }).returning();
  for (let i = 0; i < nBlocks; i++) {
    await db.insert(blocks).values({ documentId: doc.id, type: "PROSE", content: `block ${i}`, position: i });
  }
  return { wsId: ws.id, slug };
}

async function purge(wsId: string, slug: string) {
  const docs = await db.select({ id: documents.id }).from(documents)
    .innerJoin(sections, eq(documents.sectionId, sections.id)).where(eq(sections.workspaceId, wsId));
  for (const d of docs) await db.delete(blocks).where(eq(blocks.documentId, d.id));
  await db.delete(documents).where(sql`section_id in (select id from mem_sections where workspace_id = ${wsId})`);
  await db.delete(sections).where(eq(sections.workspaceId, wsId));
  await db.delete(settings).where(eq(settings.workspaceId, wsId));
  await db.delete(revisions).where(eq(revisions.workspaceId, wsId));
  await db.delete(usageLogs).where(eq(usageLogs.workspaceSlug, slug));
  await db.delete(workspaces).where(eq(workspaces.id, wsId));
}

const SUB = "load-tester";

// The postgres-js client from db.ts is a singleton shared across test files;
// `deno test` runs them in the same process in alphabetical order, so it's
// onboarding.test.ts (last) that closes the pool. Here we don't close it (otherwise we'd
// break onboarding) and we disable the resource sanitizer accordingly.
Deno.test({
  name: "load — read-before-write",
  sanitizeResources: false,
  sanitizeOps: false,
}, async (t) => {
  {
    await t.step("countBlocks + version", async () => {
      const { wsId, slug } = await seedKB(3);
      try {
        assertEquals(await countBlocks(wsId), 3, "3 blocks counted");
        assertEquals(await getWorkspaceVersion(wsId), "genesis", "genesis version without a revision");
        await db.insert(revisions).values({ workspaceId: wsId, targetType: "block", op: "create", reason: "x", actor: SUB });
        assert((await getWorkspaceVersion(wsId)) !== "genesis", "version changes after a revision");
      } finally { await purge(wsId, slug); }
    });

    await t.step("makeLoadToken: null without a secret, deterministic with a secret", async () => {
      Deno.env.delete("MEMENTO_LOAD_SECRET");
      assertEquals(await makeLoadToken("ws", "v1"), null, "null when the secret is not configured");
      Deno.env.set("MEMENTO_LOAD_SECRET", "test-secret");
      const a = await makeLoadToken("ws", "v1");
      const b = await makeLoadToken("ws", "v1");
      const c = await makeLoadToken("ws", "v2");
      assert(a && a === b, "deterministic for the same inputs");
      assert(a !== c, "differs when the version changes");
      Deno.env.delete("MEMENTO_LOAD_SECRET");
    });

    await t.step("loadWorkspace: full below the threshold, refused above", async () => {
      Deno.env.set("MEMENTO_LOAD_SECRET", "test-secret");
      const { wsId, slug } = await seedKB(2);
      try {
        const full = await loadWorkspace(wsId);
        assert(full.loaded, "loaded below the threshold");
        if (full.loaded) {
          assertEquals(full.blockCount, 2, "2 blocks");
          assertEquals(full.documents.reduce((n, d) => n + d.blocks.length, 0), 2, "all blocks rendered");
          assert(!!full.loadToken, "loadToken emitted");
        }
        await db.insert(settings).values({ workspaceId: wsId, key: "load.threshold.blocks", value: "1" });
        const over = await loadWorkspace(wsId);
        assertEquals(over.loaded, false, "refused when blocks > threshold");
      } finally { Deno.env.delete("MEMENTO_LOAD_SECRET"); await purge(wsId, slug); }
    });

    await t.step("loadGate: warn if no token, ok if fresh token", async () => {
      const { wsId, slug } = await seedKB(2);
      try {
        Deno.env.delete("MEMENTO_LOAD_SECRET");
        assertEquals((await loadGate(SUB, wsId, "mem_add_block", undefined)).ok, true, "inactive without a secret");

        Deno.env.set("MEMENTO_LOAD_SECRET", "test-secret");
        const miss = await loadGate(SUB, wsId, "mem_add_block", undefined);
        assertEquals(miss.ok, false, "warn when token absent");
        assert(!!miss.warning, "warning message present");
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(usageLogs)
          .where(eq(usageLogs.workspaceSlug, slug));
        assertEquals(Number(n), 1, "miss logged (load-gate-miss)");

        const stale = await loadGate(SUB, wsId, "mem_add_block", "bogus-token");
        assertEquals(stale.ok, false, "warn when token stale/invalid");

        const fresh = await makeLoadToken(wsId, await getWorkspaceVersion(wsId));
        assertEquals((await loadGate(SUB, wsId, "mem_add_block", fresh!)).ok, true, "ok with a fresh token");

        await db.insert(settings).values({ workspaceId: wsId, key: "load.threshold.blocks", value: "1" });
        assertEquals((await loadGate(SUB, wsId, "mem_add_block", undefined)).ok, true, "inactive above the threshold");
      } finally { Deno.env.delete("MEMENTO_LOAD_SECRET"); await purge(wsId, slug); }
    });
  }
});
