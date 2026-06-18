/**
 * Smoke test #42/#43 on a controlled dataset (disposable pgvector container).
 * Covers: judgment metadata, honest total/hasMore, filters applied to both
 * regimes, explicit errors, DEPRECATED demotion.
 * The kNN is exercised in anchor-block mode (e1 pre-vectorized) → zero OpenAI calls.
 *
 * Run:
 *   docker run -d --name memento-pgvector-test -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=memento -p 5499:5432 pgvector/pgvector:pg16
 *   DATABASE_URL=postgresql://postgres:test@localhost:5499/memento \
 *     npm --prefix server run db:migrate
 *   docker exec -i memento-pgvector-test psql -U postgres -d memento \
 *     -v ON_ERROR_STOP=1 < supabase/functions/_smoke/seed.sql
 *   cd supabase/functions && DATABASE_URL=postgresql://postgres:test@localhost:5499/memento \
 *     deno run -A _smoke/search_42_43.ts
 *   docker rm -f memento-pgvector-test
 */
import { searchBlocks, hybridSearch } from "../_shared/search.ts";
import { similarBlocks } from "../_shared/semantic.ts";
import { resolveSectionIds } from "../_shared/paths.ts";

const WS = { id: "00000000-0000-0000-0000-0000000000aa", slug: "smoke", org: "test-org" };
const E1 = "00000000-0000-0000-0000-0000000000e1";
const id = (s: string) => `00000000-0000-0000-0000-0000000000${s}`;

let failures = 0;
const check = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✅" : "❌"} ${msg}`);
  if (!cond) failures++;
};

// ── Lexical: metadata + honest total ──
const lex = await searchBlocks({ workspace: "smoke", q: "veille" });
check(lex.total === 4 && lex.hits.length === 4, `lexical "veille": 4 hits, total=4 (got ${lex.hits.length}/${lex.total})`);
const byId = new Map(lex.hits.map((h) => [h.blockId, h]));
check(byId.get(E1)?.sourceCount === 1 && byId.get(E1)?.verifiedAt !== null, "e1: sourceCount=1, verifiedAt non-null");
check(byId.get(id("e3"))?.superseded === true, "e3: superseded=true (incoming SUPERSEDES link)");
check(byId.get(id("e2"))?.contradicted === true, "e2: contradicted=true (incoming CONTRADICTS link)");
check(byId.get(id("e4"))?.docStatus === "DEPRECATED", "e4: docStatus=DEPRECATED visible in the hit");

const lim = await searchBlocks({ workspace: "smoke", q: "veille", maxHits: 2 });
check(lim.total === 4 && lim.hits.length === 2 && lim.hasMore === true, `maxHits=2: total stays 4, hasMore=true (got total=${lim.total}, hasMore=${lim.hasMore})`);

const typed = await searchBlocks({ workspace: "smoke", q: "veille", blockType: "REGLE" });
check(typed.total === 2 && typed.hits.every((h) => h.type === "REGLE"), `blockType=REGLE: 2 REGLE hits (got ${typed.total})`);

const scoped = await searchBlocks({ workspace: "smoke", q: "veille", sectionPath: "smoke/strategie" });
check(scoped.total === 2 && scoped.hits.every((h) => h.sectionPath === "smoke/strategie"), `sectionPath: 2 hits in the subtree (got ${scoped.total})`);

const kinded = await searchBlocks({ workspace: "smoke", q: "veille", docKind: "cr" });
check(kinded.total === 1 && kinded.hits[0]?.blockId === id("e3"), `docKind=cr: 1 hit e3 (got ${kinded.total})`);

// ── kNN anchor-block: filters + metadata (SQL identical to the semantic regime) ──
const knn = await similarBlocks({ workspaceIds: [WS.id], blockId: E1, k: 10 });
check(knn.hits.length === 3 && knn.hits[0].blockId === id("e2"), `kNN anchor e1: 3 neighbors, closest=e2 (got ${knn.hits.length}, ${knn.hits[0]?.blockId.slice(-2)})`);
check(knn.hits.every((h) => "docStatus" in h && "sourceCount" in h && "superseded" in h), "kNN hits carry judgment metadata");

const knnType = await similarBlocks({ workspaceIds: [WS.id], blockId: E1, blockType: "REGLE" });
check(knnType.hits.length === 1 && knnType.hits[0].blockId === id("e3"), `kNN blockType=REGLE: only e3 (got ${knnType.hits.length})`);

const secIds = await resolveSectionIds(WS.id, WS.slug, "smoke/strategie");
const knnSec = await similarBlocks({ workspaceIds: [WS.id], blockId: E1, sectionIds: secIds });
check(knnSec.hits.length === 1 && knnSec.hits[0].blockId === id("e2"), `kNN sectionIds(strategie): only e2 (got ${knnSec.hits.length})`);

const knnKind = await similarBlocks({ workspaceIds: [WS.id], blockId: E1, docKind: "note" });
check(knnKind.hits.length === 2 && knnKind.hits.every((h) => [id("e2"), id("e4")].includes(h.blockId)), `kNN docKind=note: e2+e4 (got ${knnKind.hits.length})`);

const knnEmpty = await similarBlocks({ workspaceIds: [WS.id], blockId: E1, sectionIds: [] });
check(knnEmpty.hits.length === 0, "kNN sectionIds=[]: 0 hits, no error");

// ── Hybrid: DEPRECATED demotion + honest shape + explicit errors ──
const hyb = await hybridSearch({ workspaces: [WS], q: "veille" });
const lastHit = hyb.hits[hyb.hits.length - 1];
check(lastHit?.docStatus === "DEPRECATED", `demotion: e4 (DEPRECATED) last (got ${lastHit?.blockId.slice(-2)}, ${lastHit?.docStatus})`);
check(hyb.lexicalTotal === 4 && hyb.hasMore === false, `hybrid: lexicalTotal=4, hasMore=false (got ${hyb.lexicalTotal}, ${hyb.hasMore})`);
check(!("total" in hyb), "no more misleading `total` in the hybrid response");

const hybInc = await hybridSearch({ workspaces: [WS], q: "veille", includeDeprecated: true });
const pureOrder = [...hybInc.hits].sort((a, b) => b.score - a.score).map((h) => h.blockId).join();
check(hybInc.hits.map((h) => h.blockId).join() === pureOrder, "includeDeprecated: ranking by pure score");

try {
  await hybridSearch({ workspaces: [WS, { id: crypto.randomUUID(), slug: "x", org: "x" }], q: "veille", sectionPath: "smoke/strategie" });
  check(false, "sectionPath in global mode: should have thrown");
} catch (e) {
  check(true, `sectionPath in global mode → explicit error: "${(e as Error).message}"`);
}

const hybGlobalKind = await hybridSearch({ workspaces: [WS, { id: "00000000-0000-0000-0000-00000000ffff", slug: "x", org: "x" }], q: "veille", docKind: "cr" });
check(hybGlobalKind.hits.length === 1 && hybGlobalKind.hits[0].blockId === id("e3"), `docKind applied in global mode: only e3 (got ${hybGlobalKind.hits.length})`);

console.log(failures ? `\n💥 ${failures} failure(s)` : "\n🎉 smoke test #42/#43 PASS");
Deno.exit(failures ? 1 : 0);
