/**
 * Test du harness MCP v3 (#55) — les verbes contre une base v3 réelle.
 * Couvre : propose_changes (NE MUTE RIEN) → apply (écrit la page) → search/load/list la
 * retrouvent ; **double apply = 0 doublon** (CAS) ; assert_entity crée l'entité decision.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *     deno test --allow-env --allow-net --config supabase/functions/deno.json \
 *       supabase/functions/mcp/v3.test.ts
 * Sans DATABASE_URL → skip (import dynamique de v3.ts dans le corps, après le garde).
 */
import postgres from "postgres";

const DB = Deno.env.get("DATABASE_URL");
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(`assertion failed: ${m}`); }
function assertEquals(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`assertion failed: ${m} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`); }

Deno.test({
  name: "MCP v3 harness — propose→apply→read, double-apply idempotent, assert_entity",
  ignore: !DB,
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  // Import APRÈS le garde : sans DATABASE_URL, v3.ts (→ db.ts) ne charge pas → test skip propre.
  const { v3ProposeChanges, v3Apply, v3Search, v3Load, v3List, v3Get } = await import("./v3.ts");
  const sql = postgres(DB!, { prepare: false });
  const tag = `mcpv3-${crypto.randomUUID().slice(0, 8)}`;
  const sub = `${tag}-user`;
  try {
    const [org] = await sql`insert into mem_orgs (slug, name) values (${tag}, ${tag}) returning id`;
    const [base] = await sql`insert into mem_bases (org_id, name) values (${org.id}, ${tag}) returning id`;
    await sql`insert into mem_memberships (org_id, user_id, role) values (${org.id}, ${sub}, 'member')`;
    const baseId = base.id as string;

    // ── propose_changes : crée une ingestion, NE MUTE RIEN ──────────────────────
    const prop = await v3ProposeChanges(sub, {
      title: "Doctrine pgvector",
      base: baseId,
      clientKey: "ck-1",
      changes: [
        { op: "create_page", payload: { parentId: null, title: "Migration pgvector", description: "ce qu'on a retenu", body: "on a retenu pgvector et mistral pour la recherche" } },
      ],
    });
    assert(prop.ingestionId, "ingestionId renvoyé");
    const [{ npages }] = await sql`select count(*)::int npages from mem_pages where base_id=${baseId}`;
    assertEquals(Number(npages), 0, "propose_changes ne crée AUCUNE page");

    // ── apply : écrit la page ───────────────────────────────────────────────────
    const ap = await v3Apply(sub, { ingestionId: prop.ingestionId });
    assertEquals(ap.status, "APPLIED", "apply → APPLIED");
    const pagesAfter = await sql`select id, title from mem_pages where base_id=${baseId}`;
    assertEquals(pagesAfter.length, 1, "une page écrite");
    const pageId = pagesAfter[0].id as string;

    // ── double apply : idempotent, 0 doublon ────────────────────────────────────
    const ap2 = await v3Apply(sub, { ingestionId: prop.ingestionId });
    assert(ap2.status === "APPLIED", "double apply → no-op (APPLIED)");
    const [{ n2 }] = await sql`select count(*)::int n2 from mem_pages where base_id=${baseId}`;
    assertEquals(Number(n2), 1, "TOUJOURS une seule page (0 doublon)");

    // ── read : search (FTS lexical via body_fts) la retrouve ────────────────────
    const hits = await v3Search(sub, { q: "pgvector mistral", limit: 10 });
    assert(hits.some((h) => h.pageId === pageId), "search retrouve la page (FTS)");
    assert(hits.find((h) => h.pageId === pageId)!.matchedBy.includes("lexical"), "match lexical");

    // ── load : l'épine voit la page dans l'arbre + counts ───────────────────────
    const loaded = await v3Load(sub, { base: baseId });
    assert(loaded.tree.some((n) => n.id === pageId), "load: page dans l'arbre");
    assertEquals(loaded.counts.pages, 1, "load: counts.pages = 1");
    assert(typeof loaded.etag === "string" && loaded.etag.length > 0, "load: etag présent");

    // ── list pages ──────────────────────────────────────────────────────────────
    const listed = await v3List(sub, { kind: "pages", base: baseId });
    assert(listed.items.some((it) => (it as { id: string }).id === pageId), "list pages: page présente");

    // ── get page (+ sources include) ────────────────────────────────────────────
    const got = await v3Get(sub, { id: pageId, kind: "page" }) as { kind: string; title: string };
    assertEquals(got.kind, "page", "get: kind page");
    assertEquals(got.title, "Migration pgvector", "get: titre");

    // ── assert_entity (entité logique decision) via propose+apply ───────────────
    const prop2 = await v3ProposeChanges(sub, {
      title: "Décision",
      base: baseId,
      clientKey: "ck-2",
      changes: [
        { op: "assert_entity", payload: { type: "decision", label: "adopter pgvector", pageId, status: "actee" } } as never,
      ],
    });
    const ap3 = await v3Apply(sub, { ingestionId: prop2.ingestionId });
    assertEquals(ap3.status, "APPLIED", "apply assert_entity → APPLIED");
    const ents = await sql`select id, type, canonical_label from mem_entities where org_id=${org.id} and type='decision'`;
    assert(ents.length >= 1, "entité decision créée");
    assert(ents.some((e) => (e.canonical_label as string).includes("pgvector")), "label de la décision");
  } finally {
    await sql`delete from mem_bases where name=${tag}`;
    await sql`delete from mem_orgs where slug=${tag}`;
    await sql.end();
  }
});
