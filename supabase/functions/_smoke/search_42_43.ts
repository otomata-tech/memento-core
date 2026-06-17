/**
 * Smoke test #42/#43 sur dataset contrôlé (conteneur pgvector jetable).
 * Couvre : métadonnées de jugement, vrai total/hasMore, filtres appliqués aux
 * deux régimes, erreurs explicites, déclassement DEPRECATED.
 * Le kNN est exercé en mode bloc-ancre (e1 pré-vectorisé) → zéro appel OpenAI.
 *
 * Run :
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

// ── Lexical : métadonnées + total honnête ──
const lex = await searchBlocks({ workspace: "smoke", q: "veille" });
check(lex.total === 4 && lex.hits.length === 4, `lexical "veille" : 4 hits, total=4 (obtenu ${lex.hits.length}/${lex.total})`);
const byId = new Map(lex.hits.map((h) => [h.blockId, h]));
check(byId.get(E1)?.sourceCount === 1 && byId.get(E1)?.verifiedAt !== null, "e1 : sourceCount=1, verifiedAt non null");
check(byId.get(id("e3"))?.superseded === true, "e3 : superseded=true (lien SUPERSEDES entrant)");
check(byId.get(id("e2"))?.contradicted === true, "e2 : contradicted=true (lien CONTRADICTS entrant)");
check(byId.get(id("e4"))?.docStatus === "DEPRECATED", "e4 : docStatus=DEPRECATED visible dans le hit");

const lim = await searchBlocks({ workspace: "smoke", q: "veille", maxHits: 2 });
check(lim.total === 4 && lim.hits.length === 2 && lim.hasMore === true, `maxHits=2 : total reste 4, hasMore=true (obtenu total=${lim.total}, hasMore=${lim.hasMore})`);

const typed = await searchBlocks({ workspace: "smoke", q: "veille", blockType: "REGLE" });
check(typed.total === 2 && typed.hits.every((h) => h.type === "REGLE"), `blockType=REGLE : 2 hits REGLE (obtenu ${typed.total})`);

const scoped = await searchBlocks({ workspace: "smoke", q: "veille", sectionPath: "smoke/strategie" });
check(scoped.total === 2 && scoped.hits.every((h) => h.sectionPath === "smoke/strategie"), `sectionPath : 2 hits dans le sous-arbre (obtenu ${scoped.total})`);

const kinded = await searchBlocks({ workspace: "smoke", q: "veille", docKind: "cr" });
check(kinded.total === 1 && kinded.hits[0]?.blockId === id("e3"), `docKind=cr : 1 hit e3 (obtenu ${kinded.total})`);

// ── kNN bloc-ancre : filtres + métadonnées (SQL identique au régime sémantique) ──
const knn = await similarBlocks({ workspaceIds: [WS.id], blockId: E1, k: 10 });
check(knn.hits.length === 3 && knn.hits[0].blockId === id("e2"), `kNN ancre e1 : 3 voisins, plus proche=e2 (obtenu ${knn.hits.length}, ${knn.hits[0]?.blockId.slice(-2)})`);
check(knn.hits.every((h) => "docStatus" in h && "sourceCount" in h && "superseded" in h), "hits kNN portent les métadonnées de jugement");

const knnType = await similarBlocks({ workspaceIds: [WS.id], blockId: E1, blockType: "REGLE" });
check(knnType.hits.length === 1 && knnType.hits[0].blockId === id("e3"), `kNN blockType=REGLE : seul e3 (obtenu ${knnType.hits.length})`);

const secIds = await resolveSectionIds(WS.id, WS.slug, "smoke/strategie");
const knnSec = await similarBlocks({ workspaceIds: [WS.id], blockId: E1, sectionIds: secIds });
check(knnSec.hits.length === 1 && knnSec.hits[0].blockId === id("e2"), `kNN sectionIds(strategie) : seul e2 (obtenu ${knnSec.hits.length})`);

const knnKind = await similarBlocks({ workspaceIds: [WS.id], blockId: E1, docKind: "note" });
check(knnKind.hits.length === 2 && knnKind.hits.every((h) => [id("e2"), id("e4")].includes(h.blockId)), `kNN docKind=note : e2+e4 (obtenu ${knnKind.hits.length})`);

const knnEmpty = await similarBlocks({ workspaceIds: [WS.id], blockId: E1, sectionIds: [] });
check(knnEmpty.hits.length === 0, "kNN sectionIds=[] : 0 hit, pas d'erreur");

// ── Hybride : déclassement DEPRECATED + shape honnête + erreurs explicites ──
const hyb = await hybridSearch({ workspaces: [WS], q: "veille" });
const lastHit = hyb.hits[hyb.hits.length - 1];
check(lastHit?.docStatus === "DEPRECATED", `déclassement : e4 (DEPRECATED) en dernier (obtenu ${lastHit?.blockId.slice(-2)}, ${lastHit?.docStatus})`);
check(hyb.lexicalTotal === 4 && hyb.hasMore === false, `hybride : lexicalTotal=4, hasMore=false (obtenu ${hyb.lexicalTotal}, ${hyb.hasMore})`);
check(!("total" in hyb), "plus de `total` menteur dans la réponse hybride");

const hybInc = await hybridSearch({ workspaces: [WS], q: "veille", includeDeprecated: true });
const pureOrder = [...hybInc.hits].sort((a, b) => b.score - a.score).map((h) => h.blockId).join();
check(hybInc.hits.map((h) => h.blockId).join() === pureOrder, "includeDeprecated : classement au score pur");

try {
  await hybridSearch({ workspaces: [WS, { id: crypto.randomUUID(), slug: "x", org: "x" }], q: "veille", sectionPath: "smoke/strategie" });
  check(false, "sectionPath en global : aurait dû lever");
} catch (e) {
  check(true, `sectionPath en global → erreur explicite : « ${(e as Error).message} »`);
}

const hybGlobalKind = await hybridSearch({ workspaces: [WS, { id: "00000000-0000-0000-0000-00000000ffff", slug: "x", org: "x" }], q: "veille", docKind: "cr" });
check(hybGlobalKind.hits.length === 1 && hybGlobalKind.hits[0].blockId === id("e3"), `docKind appliqué en global : seul e3 (obtenu ${hybGlobalKind.hits.length})`);

console.log(failures ? `\n💥 ${failures} échec(s)` : "\n🎉 smoke test #42/#43 PASS");
Deno.exit(failures ? 1 : 0);
