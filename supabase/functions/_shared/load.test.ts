/**
 * Test d'intégration de la lecture-avant-écriture (`_shared/load.ts`) contre une base
 * Postgres réelle — même cadre que onboarding.test.ts (pas de framework).
 *
 * Couvre : taille (countBlocks), version (max révision), jeton HMAC (déterministe +
 * null sans secret), chargement intégral (loaded true/false selon le seuil) et le
 * garde-fou WARN (jeton absent/périmé/frais, inactif sans secret ou au-dessus du seuil).
 *
 * Prérequis : Postgres local migré (mem_*). Lancement :
 *   DATABASE_URL=postgresql://tuls:tuls-dev@localhost:5434/memento \
 *     deno test --allow-env --allow-net --allow-read \
 *       supabase/functions/_shared/load.test.ts
 */
import { eq, sql } from "drizzle-orm";
import { blocks, db, documents, revisions, sections, settings, usageLogs, workspaces } from "./db.ts";
import { countBlocks, getWorkspaceVersion, loadGate, loadWorkspace, makeLoadToken } from "./load.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion échouée : ${msg}`);
}
function assertEquals(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) throw new Error(`assertion échouée : ${msg} (obtenu ${actual}, attendu ${expected})`);
}

async function seedKB(nBlocks: number): Promise<{ wsId: string; slug: string }> {
  const slug = `load-test-${crypto.randomUUID().slice(0, 8)}`;
  const [ws] = await db.insert(workspaces).values({ slug, name: slug, visibility: "private" }).returning();
  const [sec] = await db.insert(sections).values({ workspaceId: ws.id, title: "S", slug: "s" }).returning();
  const [doc] = await db.insert(documents).values({ sectionId: sec.id, title: "D", slug: "d" }).returning();
  for (let i = 0; i < nBlocks; i++) {
    await db.insert(blocks).values({ documentId: doc.id, type: "PROSE", content: `bloc ${i}`, position: i });
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

// Le client postgres-js de db.ts est un singleton partagé entre fichiers de test ;
// `deno test` les exécute dans le même process par ordre alphabétique, donc c'est
// onboarding.test.ts (dernier) qui ferme le pool. Ici on ne le ferme pas (sinon on
// casserait onboarding) et on désactive le sanitizer de ressources en conséquence.
Deno.test({
  name: "load — lecture-avant-écriture",
  sanitizeResources: false,
  sanitizeOps: false,
}, async (t) => {
  {
    await t.step("countBlocks + version", async () => {
      const { wsId, slug } = await seedKB(3);
      try {
        assertEquals(await countBlocks(wsId), 3, "3 blocs comptés");
        assertEquals(await getWorkspaceVersion(wsId), "genesis", "version genesis sans révision");
        await db.insert(revisions).values({ workspaceId: wsId, targetType: "block", op: "create", reason: "x", actor: SUB });
        assert((await getWorkspaceVersion(wsId)) !== "genesis", "version change après une révision");
      } finally { await purge(wsId, slug); }
    });

    await t.step("makeLoadToken : null sans secret, déterministe avec secret", async () => {
      Deno.env.delete("MEMENTO_LOAD_SECRET");
      assertEquals(await makeLoadToken("ws", "v1"), null, "null quand le secret n'est pas configuré");
      Deno.env.set("MEMENTO_LOAD_SECRET", "test-secret");
      const a = await makeLoadToken("ws", "v1");
      const b = await makeLoadToken("ws", "v1");
      const c = await makeLoadToken("ws", "v2");
      assert(a && a === b, "déterministe pour mêmes entrées");
      assert(a !== c, "diffère quand la version change");
      Deno.env.delete("MEMENTO_LOAD_SECRET");
    });

    await t.step("loadWorkspace : intégral sous le seuil, refusé au-dessus", async () => {
      Deno.env.set("MEMENTO_LOAD_SECRET", "test-secret");
      const { wsId, slug } = await seedKB(2);
      try {
        const full = await loadWorkspace(wsId);
        assert(full.loaded, "chargé sous le seuil");
        if (full.loaded) {
          assertEquals(full.blockCount, 2, "2 blocs");
          assertEquals(full.documents.reduce((n, d) => n + d.blocks.length, 0), 2, "tous les blocs rendus");
          assert(!!full.loadToken, "loadToken émis");
        }
        await db.insert(settings).values({ workspaceId: wsId, key: "load.threshold.blocks", value: "1" });
        const over = await loadWorkspace(wsId);
        assertEquals(over.loaded, false, "refusé quand blocs > seuil");
      } finally { Deno.env.delete("MEMENTO_LOAD_SECRET"); await purge(wsId, slug); }
    });

    await t.step("loadGate : warn si pas de jeton, ok si jeton frais", async () => {
      const { wsId, slug } = await seedKB(2);
      try {
        Deno.env.delete("MEMENTO_LOAD_SECRET");
        assertEquals((await loadGate(SUB, wsId, "mem_add_block", undefined)).ok, true, "inactif sans secret");

        Deno.env.set("MEMENTO_LOAD_SECRET", "test-secret");
        const miss = await loadGate(SUB, wsId, "mem_add_block", undefined);
        assertEquals(miss.ok, false, "warn quand jeton absent");
        assert(!!miss.warning, "message d'avertissement présent");
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(usageLogs)
          .where(eq(usageLogs.workspaceSlug, slug));
        assertEquals(Number(n), 1, "miss journalisé (load-gate-miss)");

        const stale = await loadGate(SUB, wsId, "mem_add_block", "jeton-bidon");
        assertEquals(stale.ok, false, "warn quand jeton périmé/invalide");

        const fresh = await makeLoadToken(wsId, await getWorkspaceVersion(wsId));
        assertEquals((await loadGate(SUB, wsId, "mem_add_block", fresh!)).ok, true, "ok avec jeton frais");

        await db.insert(settings).values({ workspaceId: wsId, key: "load.threshold.blocks", value: "1" });
        assertEquals((await loadGate(SUB, wsId, "mem_add_block", undefined)).ok, true, "inactif au-dessus du seuil");
      } finally { Deno.env.delete("MEMENTO_LOAD_SECRET"); await purge(wsId, slug); }
    });
  }
});
