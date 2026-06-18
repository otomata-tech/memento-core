/**
 * Per-block semantics (issue #10): embedding computed SERVER-SIDE on write
 * ("intelligence on write, deterministic read") + kNN `mem_similar`.
 *
 * An embedding is a mechanical encoding, not a judgment — the "dumb server"
 * principle forbids server-side judgment, not encoding. If the embedding API is
 * unavailable, the block is written with a NULL embedding (no hidden fallback); the
 * backfill (`npm run embed:backfill`) catches up, and the kNN ignores NULLs.
 */
import { sql } from "drizzle-orm";
import { db } from "./db.ts";

export const EMBEDDING_MODEL = "text-embedding-3-small"; // 1536 dims — cf. migration 0006

export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const key = Deno.env.get("MEMENTO_OPENAI_API_KEY");
  if (!key || !texts.length) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts.map((t) => t.slice(0, 8000)) }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data.map((d: { embedding: number[] }) => d.embedding);
  } catch {
    return null; // best-effort: the backfill will catch up
  }
}

const toVec = (e: number[]) => `[${e.join(",")}]`;

/** Vectorizes and stores (best-effort) — called by write.ts after content creation/edit. */
export async function embedBlocks(rows: { id: string; content: string }[]): Promise<void> {
  const vecs = await embedTexts(rows.map((r) => r.content));
  if (!vecs) return;
  for (let i = 0; i < rows.length; i++) {
    await db.execute(sql`
      update mem_blocks set embedding = ${toVec(vecs[i])}::vector, embedding_model = ${EMBEDDING_MODEL}
      where id = ${rows[i].id}`);
  }
}

/**
 * Anti-duplicate signal on write (#44): the k near-identical blocks already
 * present in the KB. The server provides the signal, the agent judges (CONFIRM
 * rather than ENRICH?) — pure D1. Best-effort: never blocking, [] if the
 * embedding is unavailable or the block is not vectorized.
 */
export const NEAR_DUP_THRESHOLD = 0.85;

export async function nearDuplicates(
  workspaceId: string,
  anchor: { blockId?: string; text?: string },
  k = 3,
) {
  try {
    const { hits } = await similarBlocks({ workspaceIds: [workspaceId], ...anchor, k });
    return hits
      .filter((h) => h.similarity >= NEAR_DUP_THRESHOLD)
      .map((h) => ({
        blockId: h.blockId,
        similarity: h.similarity,
        type: h.type,
        excerpt: h.excerpt,
        document: h.document,
      }));
  } catch {
    return []; // signal, not a guarantee — the write never fails because of it
  }
}

export type SimilarArgs = {
  workspaceIds: string[]; // one = single-KB; several = global search
  blockId?: string;
  text?: string;
  k?: number;
  blockType?: string;
  docKind?: string;
  sectionIds?: string[] | null; // sub-tree already resolved (resolveSectionIds); [] = no match
};

/** k nearest blocks (cosine) in the given workspace(s). By anchor block or free text. */
export async function similarBlocks(args: SimilarArgs) {
  const k = Math.min(Math.max(args.k ?? 8, 1), 50);

  let anchor: string; // vector literal
  if (args.blockId) {
    const rows = await db.execute<{ embedding: string | null; content: string }>(
      sql`select embedding::text as embedding, content from mem_blocks where id = ${args.blockId} limit 1`,
    );
    const row = rows[0];
    if (!row) throw new Error(`Block not found: ${args.blockId}`);
    if (row.embedding) anchor = row.embedding;
    else {
      const vecs = await embedTexts([row.content]);
      if (!vecs) throw new Error("block not vectorized and embedding API unavailable — try again later");
      anchor = toVec(vecs[0]);
      await db.execute(sql`
        update mem_blocks set embedding = ${anchor}::vector, embedding_model = ${EMBEDDING_MODEL}
        where id = ${args.blockId}`);
    }
  } else if (args.text?.trim()) {
    const vecs = await embedTexts([args.text]);
    if (!vecs) throw new Error("embedding API unavailable — try again later");
    anchor = toVec(vecs[0]);
  } else {
    throw new Error("`blockId` or `text` required");
  }

  if (!args.workspaceIds.length || args.sectionIds?.length === 0) {
    return { model: EMBEDDING_MODEL, hits: [] };
  }
  const wsList = sql.join(args.workspaceIds.map((id) => sql`${id}`), sql`, `);
  const sectionFilter = args.sectionIds?.length
    ? sql`and s.id in (${sql.join(args.sectionIds.map((id) => sql`${id}`), sql`, `)})`
    : sql``;
  const rows = await db.execute<{
    id: string; type: string; content: string; verified_at: string | null;
    updated_at: string; doc_status: string; source_count: number;
    superseded: boolean; contradicted: boolean;
    workspace_id: string;
    doc_id: string; doc_title: string; section_id: string; section_title: string;
    similarity: number;
  }>(sql`
    select b.id, b.type, b.content, b.verified_at, b.updated_at, s.workspace_id,
           d.id as doc_id, d.title as doc_title, d.status as doc_status,
           s.id as section_id, s.title as section_title,
           (select count(*)::int from mem_block_sources bs where bs.block_id = b.id) as source_count,
           exists(select 1 from mem_links l where l.to_block_id = b.id and l.relation = 'SUPERSEDES') as superseded,
           exists(select 1 from mem_links l where l.to_block_id = b.id and l.relation = 'CONTRADICTS') as contradicted,
           1 - (b.embedding <=> ${anchor}::vector) as similarity
    from mem_blocks b
    join mem_documents d on d.id = b.document_id
    join mem_sections s on s.id = d.section_id
    where s.workspace_id in (${wsList})
      and b.embedding is not null
      ${args.blockType ? sql`and b.type = ${args.blockType}::mem_block_type` : sql``}
      ${args.docKind ? sql`and d.kind = ${args.docKind}` : sql``}
      ${sectionFilter}
      ${args.blockId ? sql`and b.id <> ${args.blockId}` : sql``}
    order by b.embedding <=> ${anchor}::vector
    limit ${k}`);

  return {
    model: EMBEDDING_MODEL,
    hits: [...rows].map((r) => ({
      blockId: r.id,
      workspaceId: r.workspace_id,
      similarity: Math.round(Number(r.similarity) * 1000) / 1000,
      type: r.type,
      excerpt: r.content.length > 280 ? `${r.content.slice(0, 280)}…` : r.content,
      docStatus: r.doc_status,
      verifiedAt: r.verified_at,
      updatedAt: r.updated_at,
      sourceCount: Number(r.source_count),
      superseded: r.superseded,
      contradicted: r.contradicted,
      document: { id: r.doc_id, title: r.doc_title },
      section: { id: r.section_id, title: r.section_title },
    })),
  };
}
