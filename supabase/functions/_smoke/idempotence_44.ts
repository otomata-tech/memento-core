/**
 * Smoke test #44 (clientKey idempotence + kNN anti-duplicate signal) on the same
 * controlled dataset as search_42_43.ts — see the run instructions there.
 * Without an OpenAI key: the kNN signal at write time degrades to [] (best-effort);
 * the positive path is tested by setting the embeddings by hand.
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

// ── addBlock: clientKey → retry = no-op ──
const b1 = await addBlock({ documentId: D1, type: "PROSE", content: "New memorable fact.", clientKey: "fact-001" }, "smoke-test") as Record<string, unknown>;
check(!b1.deduplicated, "addBlock clientKey: 1st call creates");
const b2 = await addBlock({ documentId: D1, type: "PROSE", content: "New memorable fact.", clientKey: "fact-001" }, "smoke-test") as Record<string, unknown>;
check(b2.deduplicated === true && b2.id === b1.id, `retry same clientKey: no-op, same block (got dedup=${b2.deduplicated}, same id=${b2.id === b1.id})`);
const nBlocks = await count(sql`select count(*)::int as n from mem_blocks where document_id = ${D1}`);
check(nBlocks === 3, `only 1 block created despite 2 calls (d1: 2 seed + 1 = ${nBlocks})`);
const nRevs = await count(sql`select count(*)::int as n from mem_revisions where target_id = ${b1.id}`);
check(nRevs === 1, `only 1 revision logged (got ${nRevs})`);

// without clientKey: behavior unchanged (2 calls = 2 blocks)
await addBlock({ documentId: D1, type: "PROSE", content: "No key A." }, "smoke-test");
await addBlock({ documentId: D1, type: "PROSE", content: "No key A." }, "smoke-test");
const nNoKey = await count(sql`select count(*)::int as n from mem_blocks where document_id = ${D1} and content = 'No key A.'`);
check(nNoKey === 2, `without clientKey: no implicit dedup (got ${nNoKey})`);

// ── addDocument: clientKey → retry = no-op ──
const d1 = await addDocument({ sectionId: B1, title: "Idempotent Doc", blocks: [{ type: "PROSE", content: "content" }], clientKey: "doc-001" }, "smoke-test") as Record<string, unknown>;
check(!d1.deduplicated, "addDocument clientKey: 1st call creates");
const d2 = await addDocument({ sectionId: B1, title: "Idempotent Doc", blocks: [{ type: "PROSE", content: "content" }], clientKey: "doc-001" }, "smoke-test") as Record<string, unknown>;
const doc1 = d1.document as Record<string, unknown>, doc2 = d2.document as Record<string, unknown>;
check(d2.deduplicated === true && doc2.id === doc1.id && (d2.blocks as unknown[]).length === 1, `retry addDocument: same doc + its blocks (dedup=${d2.deduplicated})`);
const nDocs = await count(sql`select count(*)::int as n from mem_documents where section_id = ${B1} and client_key = 'doc-001'`);
check(nDocs === 1, `only 1 document created (got ${nDocs})`);

// ── stageChanges: clientKey → retry = no-op; kNN signal absent without API (best-effort) ──
const i1 = await stageChanges({ workspace: "smoke", title: "Idempotent ingestion", clientKey: "ing-001", changes: [{ op: "add_block", payload: { documentId: D1, type: "PROSE", content: "proposed" } }] }, "smoke-test") as Record<string, unknown>;
check(!i1.deduplicated, "stageChanges clientKey: 1st call creates");
check(!("similarExisting" in i1), "kNN signal absent without an embedding API (best-effort, no error)");
// Re-stage same clientKey on an OPEN (PROPOSED) ingestion → supersession (ping-pong):
// the change-set is replaced, the ingestion stays the same and unique (not a dedup no-op).
const i2 = await stageChanges({ workspace: "smoke", title: "Idempotent ingestion", clientKey: "ing-001", changes: [{ op: "add_block", payload: { documentId: D1, type: "PROSE", content: "proposed v2" } }] }, "smoke-test") as Record<string, unknown>;
check(i2.superseded === true && i2.id === i1.id, `re-stage same clientKey on open ingestion: supersession same ingestion (superseded=${i2.superseded})`);
const nIng = await count(sql`select count(*)::int as n from mem_ingestions where client_key = 'ing-001'`);
check(nIng === 1, `only 1 ingestion (updated, not duplicated) (got ${nIng})`);

// same clientKey in ANOTHER scope: no collision (scoped uniqueness)
const bOther = await addBlock({ documentId: "00000000-0000-0000-0000-0000000000d2", type: "PROSE", content: "other doc", clientKey: "fact-001" }, "smoke-test") as Record<string, unknown>;
check(!bOther.deduplicated, "same clientKey in another document: creates (uniqueness per document)");

// ── Positive kNN signal: embeddings set by hand ──
// tvec(x) exists in the seed; the new block gets a vector ~identical to e1.
await db.execute(sql`update mem_blocks set embedding = tvec(0.991), embedding_model = 'test' where id = ${b1.id}`);
const sims = await nearDuplicates(WS, { blockId: b1.id as string });
check(sims.length > 0 && sims.every((s) => s.similarity >= 0.85), `nearDuplicates: ${sims.length} near-duplicate(s) ≥ 0.85 (closest: ${sims[0]?.similarity})`);
check(sims.some((s) => s.blockId === E1), "e1 (near identical) is flagged");

// an orthogonal vector is NOT flagged (threshold)
await db.execute(sql`
  insert into mem_blocks (id, document_id, type, content, position, embedding, embedding_model)
  values ('00000000-0000-0000-0000-0000000000e9', ${D1}, 'PROSE', 'totally different topic', 99,
          ('[0.0,0.99,' || array_to_string(array(select '0.01' from generate_series(1,1534)), ',') || ']')::vector, 'test')`);
const sims2 = await nearDuplicates(WS, { blockId: b1.id as string }, 10);
check(!sims2.some((s) => s.blockId === "00000000-0000-0000-0000-0000000000e9"), "orthogonal block excluded by the 0.85 threshold");

console.log(failures ? `\n💥 ${failures} failure(s)` : "\n🎉 smoke test #44 PASS");
Deno.exit(failures ? 1 : 0);
