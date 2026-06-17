/**
 * Smoke test #44 (idempotence clientKey + signal anti-doublon kNN) sur le même
 * dataset contrôlé que search_42_43.ts — voir les instructions de run là-bas.
 * Sans clé OpenAI : le signal kNN à l'écriture dégrade en [] (best-effort) ;
 * le chemin positif est testé en posant les embeddings à la main.
 */
import { sql } from "drizzle-orm";
import { db } from "../_shared/db.ts";
import { addBlock, addDocument } from "../_shared/write.ts";
import { stageChanges } from "../_shared/ingestion.ts";
import { nearDuplicates } from "../_shared/semantic.ts";

const WS = "00000000-0000-0000-0000-0000000000aa";
const D1 = "00000000-0000-0000-0000-0000000000d1";
const B1 = "00000000-0000-0000-0000-0000000000b1"; // section strategie
const E1 = "00000000-0000-0000-0000-0000000000e1";

let failures = 0;
const check = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✅" : "❌"} ${msg}`);
  if (!cond) failures++;
};
const count = async (q: ReturnType<typeof sql>) =>
  Number((await db.execute<{ n: number }>(q))[0].n);

// ── addBlock : clientKey → retry = no-op ──
const b1 = await addBlock({ documentId: D1, type: "PROSE", content: "Nouveau fait mémorable.", clientKey: "fact-001" }, "smoke-test") as Record<string, unknown>;
check(!b1.deduplicated, "addBlock clientKey : 1er appel crée");
const b2 = await addBlock({ documentId: D1, type: "PROSE", content: "Nouveau fait mémorable.", clientKey: "fact-001" }, "smoke-test") as Record<string, unknown>;
check(b2.deduplicated === true && b2.id === b1.id, `retry même clientKey : no-op, même bloc (obtenu dedup=${b2.deduplicated}, même id=${b2.id === b1.id})`);
const nBlocks = await count(sql`select count(*)::int as n from mem_blocks where document_id = ${D1}`);
check(nBlocks === 3, `1 seul bloc créé malgré 2 appels (d1 : 2 seed + 1 = ${nBlocks})`);
const nRevs = await count(sql`select count(*)::int as n from mem_revisions where target_id = ${b1.id}`);
check(nRevs === 1, `1 seule révision journalisée (obtenu ${nRevs})`);

// sans clientKey : comportement inchangé (2 appels = 2 blocs)
await addBlock({ documentId: D1, type: "PROSE", content: "Sans clé A." }, "smoke-test");
await addBlock({ documentId: D1, type: "PROSE", content: "Sans clé A." }, "smoke-test");
const nNoKey = await count(sql`select count(*)::int as n from mem_blocks where document_id = ${D1} and content = 'Sans clé A.'`);
check(nNoKey === 2, `sans clientKey : pas de dédup implicite (obtenu ${nNoKey})`);

// ── addDocument : clientKey → retry = no-op ──
const d1 = await addDocument({ sectionId: B1, title: "Doc idempotent", blocks: [{ type: "PROSE", content: "contenu" }], clientKey: "doc-001" }, "smoke-test") as Record<string, unknown>;
check(!d1.deduplicated, "addDocument clientKey : 1er appel crée");
const d2 = await addDocument({ sectionId: B1, title: "Doc idempotent", blocks: [{ type: "PROSE", content: "contenu" }], clientKey: "doc-001" }, "smoke-test") as Record<string, unknown>;
const doc1 = d1.document as Record<string, unknown>, doc2 = d2.document as Record<string, unknown>;
check(d2.deduplicated === true && doc2.id === doc1.id && (d2.blocks as unknown[]).length === 1, `retry addDocument : même doc + ses blocs (dedup=${d2.deduplicated})`);
const nDocs = await count(sql`select count(*)::int as n from mem_documents where section_id = ${B1} and client_key = 'doc-001'`);
check(nDocs === 1, `1 seul document créé (obtenu ${nDocs})`);

// ── stageChanges : clientKey → retry = no-op ; signal kNN absent sans API (best-effort) ──
const i1 = await stageChanges({ workspace: "smoke", title: "Ingestion idempotente", clientKey: "ing-001", changes: [{ op: "add_block", payload: { documentId: D1, type: "PROSE", content: "proposé" } }] }, "smoke-test") as Record<string, unknown>;
check(!i1.deduplicated, "stageChanges clientKey : 1er appel crée");
check(!("similarExisting" in i1), "signal kNN absent sans API d'embedding (best-effort, pas d'erreur)");
// Re-stage même clientKey sur une ingestion OUVERTE (PROPOSED) → supersession (ping-pong) :
// le change-set est remplacé, l'ingestion reste la même et unique (pas un no-op dédup).
const i2 = await stageChanges({ workspace: "smoke", title: "Ingestion idempotente", clientKey: "ing-001", changes: [{ op: "add_block", payload: { documentId: D1, type: "PROSE", content: "proposé v2" } }] }, "smoke-test") as Record<string, unknown>;
check(i2.superseded === true && i2.id === i1.id, `re-stage même clientKey sur ingestion ouverte : supersession même ingestion (superseded=${i2.superseded})`);
const nIng = await count(sql`select count(*)::int as n from mem_ingestions where client_key = 'ing-001'`);
check(nIng === 1, `1 seule ingestion (mise à jour, pas dupliquée) (obtenu ${nIng})`);

// même clientKey dans un AUTRE périmètre : pas de collision (unicité scopée)
const bOther = await addBlock({ documentId: "00000000-0000-0000-0000-0000000000d2", type: "PROSE", content: "autre doc", clientKey: "fact-001" }, "smoke-test") as Record<string, unknown>;
check(!bOther.deduplicated, "même clientKey dans un autre document : crée (unicité par document)");

// ── Signal kNN positif : embeddings posés à la main ──
// tvec(x) existe dans le seed ; le nouveau bloc reçoit un vecteur ~identique à e1.
await db.execute(sql`update mem_blocks set embedding = tvec(0.991), embedding_model = 'test' where id = ${b1.id}`);
const sims = await nearDuplicates(WS, { blockId: b1.id as string });
check(sims.length > 0 && sims.every((s) => s.similarity >= 0.85), `nearDuplicates : ${sims.length} quasi-doublon(s) ≥ 0.85 (plus proche : ${sims[0]?.similarity})`);
check(sims.some((s) => s.blockId === E1), "e1 (quasi identique) est signalé");

// un vecteur orthogonal n'est PAS signalé (seuil)
await db.execute(sql`
  insert into mem_blocks (id, document_id, type, content, position, embedding, embedding_model)
  values ('00000000-0000-0000-0000-0000000000e9', ${D1}, 'PROSE', 'sujet totalement différent', 99,
          ('[0.0,0.99,' || array_to_string(array(select '0.01' from generate_series(1,1534)), ',') || ']')::vector, 'test')`);
const sims2 = await nearDuplicates(WS, { blockId: b1.id as string }, 10);
check(!sims2.some((s) => s.blockId === "00000000-0000-0000-0000-0000000000e9"), "bloc orthogonal exclu par le seuil 0.85");

console.log(failures ? `\n💥 ${failures} échec(s)` : "\n🎉 smoke test #44 PASS");
Deno.exit(failures ? 1 : 0);
