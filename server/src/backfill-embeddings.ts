/**
 * Backfill of block embeddings (issue #10): vectorizes every block with a NULL
 * embedding or a different model. Batches of 100 per API call (comfortable OpenAI limit).
 * Usage: DATABASE_URL=<direct> OPENAI_API_KEY=<key> npm --prefix server run embed:backfill
 */
import { sql } from "drizzle-orm";
import { db } from "./db.ts";

const MODEL = "text-embedding-3-small"; // keep aligned with _shared/semantic.ts
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error("OPENAI_API_KEY required"); process.exit(1); }

async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, input: texts.map((t) => t.slice(0, 8000)) }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  return (await res.json()).data.map((d: { embedding: number[] }) => d.embedding);
}

let total = 0;
for (;;) {
  const rows = await db.execute<{ id: string; content: string }>(sql`
    select id, content from mem_blocks
    where embedding is null or embedding_model is distinct from ${MODEL}
    limit 100`);
  if (!rows.length) break;
  const vecs = await embed([...rows].map((r) => r.content));
  for (let i = 0; i < rows.length; i++) {
    await db.execute(sql`
      update mem_blocks set embedding = ${`[${vecs[i].join(",")}]`}::vector, embedding_model = ${MODEL}
      where id = ${rows[i].id}`);
  }
  total += rows.length;
  console.log(`…${total} blocks vectorized`);
}
console.log(`done: ${total} blocks`);
process.exit(0);
