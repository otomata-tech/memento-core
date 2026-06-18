/**
 * Full-text search per BLOCK (FR tsvector + unaccent, cf. spec §7).
 * The server never returns the full content: each hit is a snippet (ts_headline) +
 * the slugified path for direct drill.
 *
 * The `search_vector` column and the `french_unaccent` config are set by migration
 * 0001 (outside the Drizzle DSL) → raw SQL query here.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db, workspaces, orgs } from "./db.ts";
import { resolveWorkspaceBySlug, loadSectionPathMap } from "./paths.ts";
import { docUrl } from "./urls.ts";

export type SearchArgs = {
  workspace: string;
  q: string;
  blockType?: string;
  sectionPath?: string;
  docKind?: string;
  maxHits?: number;
};

export async function searchBlocks(args: SearchArgs) {
  const ws = await resolveWorkspaceBySlug(args.workspace);
  const limit = Math.min(Math.max(args.maxHits ?? 20, 1), 100);

  const conds = [
    sql`s.workspace_id = ${ws.id}`,
    sql`b.search_vector @@ query`,
  ];
  if (args.blockType) conds.push(sql`b.type = ${args.blockType}::mem_block_type`);
  if (args.docKind) conds.push(sql`d.kind = ${args.docKind}`);

  // Filter by section subtree via path prefix (resolved on the JS side).
  const pathMap = await loadSectionPathMap(ws.id, ws.slug);
  let sectionIdFilter: string[] | null = null;
  if (args.sectionPath) {
    const prefix = args.sectionPath.replace(/\/+$/, "");
    sectionIdFilter = [...pathMap.entries()]
      .filter(([, p]) => p === prefix || p.startsWith(`${prefix}/`))
      .map(([id]) => id);
    if (sectionIdFilter.length === 0) return { hits: [], total: 0, hasMore: false };
    const idList = sql.join(
      sectionIdFilter.map((id) => sql`${id}`),
      sql`, `,
    );
    conds.push(sql`s.id IN (${idList})`);
  }

  const whereClause = sql.join(conds, sql` AND `);

  const rows = await db.execute<{
    block_id: string;
    type: string;
    doc_id: string;
    doc_slug: string;
    doc_title: string;
    doc_status: string;
    section_id: string;
    verified_at: string | null;
    updated_at: string;
    source_count: number;
    superseded: boolean;
    contradicted: boolean;
    total_count: number;
    rank: number;
    snippet: string;
  }>(sql`
    SELECT b.id AS block_id, b.type, d.id AS doc_id, d.slug AS doc_slug,
           d.title AS doc_title, d.status AS doc_status, s.id AS section_id,
           b.verified_at, b.updated_at,
           (SELECT count(*)::int FROM mem_block_sources bs WHERE bs.block_id = b.id) AS source_count,
           EXISTS(SELECT 1 FROM mem_links l WHERE l.to_block_id = b.id AND l.relation = 'SUPERSEDES') AS superseded,
           EXISTS(SELECT 1 FROM mem_links l WHERE l.to_block_id = b.id AND l.relation = 'CONTRADICTS') AS contradicted,
           count(*) OVER () AS total_count,
           ts_rank(b.search_vector, query) AS rank,
           ts_headline('french_unaccent', b.content, query,
             'StartSel=«, StopSel=», MaxFragments=2, MaxWords=24, MinWords=6') AS snippet
    FROM mem_blocks b
    JOIN mem_documents d ON d.id = b.document_id
    JOIN mem_sections s ON s.id = d.section_id,
         websearch_to_tsquery('french_unaccent', ${args.q}) query
    WHERE ${whereClause}
    ORDER BY rank DESC, b.created_at ASC
    LIMIT ${limit}
  `);

  const hits = rows.map((r) => {
    const sectionPath = pathMap.get(r.section_id) ?? ws.slug;
    return {
      blockId: r.block_id,
      type: r.type,
      sectionPath,
      docId: r.doc_id,
      docPath: `${sectionPath}/${r.doc_slug}`,
      docTitle: r.doc_title,
      docStatus: r.doc_status,
      url: docUrl(ws.slug, r.doc_id, r.block_id),
      verifiedAt: r.verified_at,
      updatedAt: r.updated_at,
      sourceCount: Number(r.source_count),
      superseded: r.superseded,
      contradicted: r.contradicted,
      snippet: r.snippet,
      rank: Number(r.rank),
    };
  });
  // total = number of MATCHING blocks (count over), not the number returned.
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { hits, total, hasMore: total > hits.length };
}

/**
 * GLOBAL search: all KBs accessible to the caller (`workspaceIds`).
 * Each hit is labeled {workspace, org} — serves the "where did I note that?";
 * the drill stays single-KB (doctrine-first).
 */
export async function searchBlocksGlobal(args: {
  workspaceIds: string[];
  q: string;
  blockType?: string;
  docKind?: string;
  maxHits?: number;
}) {
  if (!args.workspaceIds.length) return { hits: [], total: 0, hasMore: false };
  const limit = Math.min(Math.max(args.maxHits ?? 20, 1), 100);

  const wsRows = await db
    .select({ id: workspaces.id, slug: workspaces.slug, org: orgs.slug })
    .from(workspaces)
    .innerJoin(orgs, eq(workspaces.orgId, orgs.id))
    .where(inArray(workspaces.id, args.workspaceIds));
  const wsById = new Map(wsRows.map((w) => [w.id, w]));

  const idList = sql.join(args.workspaceIds.map((id) => sql`${id}`), sql`, `);
  const conds = [sql`s.workspace_id IN (${idList})`, sql`b.search_vector @@ query`];
  if (args.blockType) conds.push(sql`b.type = ${args.blockType}::mem_block_type`);
  if (args.docKind) conds.push(sql`d.kind = ${args.docKind}`);
  const whereClause = sql.join(conds, sql` AND `);

  const rows = await db.execute<{
    block_id: string; type: string; workspace_id: string; doc_id: string;
    doc_slug: string; doc_title: string; doc_status: string; section_id: string;
    verified_at: string | null; updated_at: string; source_count: number;
    superseded: boolean; contradicted: boolean; total_count: number;
    rank: number; snippet: string;
  }>(sql`
    SELECT b.id AS block_id, b.type, s.workspace_id, d.id AS doc_id, d.slug AS doc_slug,
           d.title AS doc_title, d.status AS doc_status, s.id AS section_id,
           b.verified_at, b.updated_at,
           (SELECT count(*)::int FROM mem_block_sources bs WHERE bs.block_id = b.id) AS source_count,
           EXISTS(SELECT 1 FROM mem_links l WHERE l.to_block_id = b.id AND l.relation = 'SUPERSEDES') AS superseded,
           EXISTS(SELECT 1 FROM mem_links l WHERE l.to_block_id = b.id AND l.relation = 'CONTRADICTS') AS contradicted,
           count(*) OVER () AS total_count,
           ts_rank(b.search_vector, query) AS rank,
           ts_headline('french_unaccent', b.content, query,
             'StartSel=«, StopSel=», MaxFragments=2, MaxWords=24, MinWords=6') AS snippet
    FROM mem_blocks b
    JOIN mem_documents d ON d.id = b.document_id
    JOIN mem_sections s ON s.id = d.section_id,
         websearch_to_tsquery('french_unaccent', ${args.q}) query
    WHERE ${whereClause}
    ORDER BY rank DESC, b.created_at ASC
    LIMIT ${limit}
  `);

  // Slugified paths: one map per touched KB only.
  const touched = [...new Set([...rows].map((r) => r.workspace_id))];
  const maps = new Map<string, Map<string, string>>();
  for (const wid of touched) {
    const w = wsById.get(wid);
    if (w) maps.set(wid, await loadSectionPathMap(wid, w.slug));
  }

  const hits = [...rows].map((r) => {
    const w = wsById.get(r.workspace_id);
    const sectionPath = maps.get(r.workspace_id)?.get(r.section_id) ?? w?.slug ?? "";
    return {
      workspace: w?.slug ?? null,
      org: w?.org ?? null,
      blockId: r.block_id,
      type: r.type,
      sectionPath,
      docId: r.doc_id,
      docPath: `${sectionPath}/${r.doc_slug}`,
      docTitle: r.doc_title,
      docStatus: r.doc_status,
      url: w ? docUrl(w.slug, r.doc_id, r.block_id) : null,
      verifiedAt: r.verified_at,
      updatedAt: r.updated_at,
      sourceCount: Number(r.source_count),
      superseded: r.superseded,
      contradicted: r.contradicted,
      snippet: r.snippet,
      rank: Number(r.rank),
    };
  });
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { hits, total, hasMore: total > hits.length };
}

/**
 * HYBRID search: lexical (tsvector) + semantic (kNN) fused via RRF (Reciprocal Rank
 * Fusion, k=60) — no score calibration between regimes. If the embedding API is
 * unavailable, degrades to lexical only and SAYS so (`modes` in the response) — no
 * silent fallback.
 */
import { similarBlocks } from "./semantic.ts";
import { resolveSectionIds } from "./paths.ts";
import { publicWorkspaceRefs } from "./access.ts";

const RRF_K = 60;

type HybridHit = {
  blockId: string;
  workspace: string | null;
  org: string | null;
  type: string;
  matchedBy: string[];
  score: number;
  snippet?: string;
  excerpt?: string;
  docId?: string;
  docTitle: string;
  docPath?: string;
  url?: string | null;
  sectionPath?: string;
  docStatus?: string;
  verifiedAt?: string | null;
  updatedAt?: string;
  sourceCount?: number;
  superseded?: boolean;
  contradicted?: boolean;
  similarity?: number;
  rank?: number;
};

/**
 * PUBLIC search: global search over ALL public KBs (not archived), without auth.
 * Lexical only — deterministic and without embedding cost on an anonymous surface.
 * Each hit is labeled {workspace, org} for the drill.
 */
export async function searchPublic(args: { q: string; blockType?: string; docKind?: string; maxHits?: number }) {
  const refs = await publicWorkspaceRefs();
  if (!refs.length) return { hits: [], total: 0, hasMore: false };
  return searchBlocksGlobal({
    workspaceIds: refs.map((r) => r.id),
    q: args.q,
    blockType: args.blockType,
    docKind: args.docKind,
    maxHits: args.maxHits,
  });
}

export async function hybridSearch(args: {
  workspaces: { id: string; slug: string; org: string }[]; // 1 = mono-KB, n = globale
  q: string;
  mode?: "hybrid" | "lexical" | "semantic";
  blockType?: string;
  sectionPath?: string;
  docKind?: string;
  includeDeprecated?: boolean;
  maxHits?: number;
}) {
  const mode = args.mode ?? "hybrid";
  const limit = Math.min(Math.max(args.maxHits ?? 20, 1), 100);
  const mono = args.workspaces.length === 1 ? args.workspaces[0] : null;
  const bySlug = new Map(args.workspaces.map((w) => [w.id, w]));

  // Never a silent acceptance: a non-applicable filter is an error.
  if (!mono && args.sectionPath) {
    throw new Error('`sectionPath` not supported in global search ("*") — target a specific KB');
  }
  // Subtree resolved ONCE, applied to both regimes (single-KB).
  const sectionIds = mono && args.sectionPath
    ? await resolveSectionIds(mono.id, mono.slug, args.sectionPath)
    : null;

  const wantLex = mode !== "semantic";
  const wantSem = mode !== "lexical";

  const [lex, sem] = await Promise.all([
    wantLex
      ? (mono
          ? searchBlocks({ workspace: mono.slug, q: args.q, blockType: args.blockType, sectionPath: args.sectionPath, docKind: args.docKind, maxHits: limit })
          : searchBlocksGlobal({ workspaceIds: args.workspaces.map((w) => w.id), q: args.q, blockType: args.blockType, docKind: args.docKind, maxHits: limit }))
      : Promise.resolve(null),
    wantSem
      ? similarBlocks({
          workspaceIds: args.workspaces.map((w) => w.id),
          text: args.q,
          k: limit,
          blockType: args.blockType,
          docKind: args.docKind,
          sectionIds,
        }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const modes: string[] = [];
  if (lex) modes.push("lexical");
  if (sem) modes.push("semantic");

  // RRF fusion: score = sum of 1/(K + rank) per regime where the block appears.
  const fused = new Map<string, HybridHit>();
  (lex?.hits ?? []).forEach((h: any, i: number) => {
    fused.set(h.blockId, {
      blockId: h.blockId,
      workspace: h.workspace ?? mono?.slug ?? null,
      org: h.org ?? mono?.org ?? null,
      type: h.type,
      matchedBy: ["lexical"],
      score: 1 / (RRF_K + i + 1),
      snippet: h.snippet,
      docId: h.docId,
      docTitle: h.docTitle,
      docPath: h.docPath,
      url: h.url,
      sectionPath: h.sectionPath,
      docStatus: h.docStatus,
      verifiedAt: h.verifiedAt,
      updatedAt: h.updatedAt,
      sourceCount: h.sourceCount,
      superseded: h.superseded,
      contradicted: h.contradicted,
      rank: h.rank,
    });
  });
  (sem?.hits ?? []).forEach((h: any, i: number) => {
    const prev = fused.get(h.blockId);
    const w = bySlug.get(h.workspaceId);
    if (prev) {
      prev.matchedBy.push("semantic");
      prev.score += 1 / (RRF_K + i + 1);
      prev.similarity = h.similarity;
      prev.excerpt ??= h.excerpt;
    } else {
      fused.set(h.blockId, {
        blockId: h.blockId,
        workspace: w?.slug ?? null,
        org: w?.org ?? null,
        type: h.type,
        matchedBy: ["semantic"],
        score: 1 / (RRF_K + i + 1),
        excerpt: h.excerpt,
        docId: h.document?.id,
        docTitle: h.document?.title ?? "",
        url: w && h.document?.id ? docUrl(w.slug, h.document.id, h.blockId) : null,
        docStatus: h.docStatus,
        verifiedAt: h.verifiedAt,
        updatedAt: h.updatedAt,
        sourceCount: h.sourceCount,
        superseded: h.superseded,
        contradicted: h.contradicted,
        similarity: h.similarity,
      });
    }
  });

  // DEPRECATED: downranked by default (never hard-excluded) — the hit stays visible,
  // with its docStatus, but behind the active blocks. `includeDeprecated` restores
  // the pure ranking.
  const declass = !args.includeDeprecated;
  const hits = [...fused.values()]
    .sort((a, b) => {
      if (declass) {
        const da = a.docStatus === "DEPRECATED" ? 1 : 0;
        const dbb = b.docStatus === "DEPRECATED" ? 1 : 0;
        if (da !== dbb) return da - dbb;
      }
      return b.score - a.score;
    })
    .slice(0, limit)
    .map((h) => ({ ...h, score: Math.round(h.score * 10000) / 10000 }));

  // `lexicalTotal` = true number of matching blocks (count over); kNN has no notion
  // of total (top-k by construction) → null in semantic mode.
  return {
    mode,
    modes,
    hits,
    lexicalTotal: lex ? lex.total : null,
    hasMore: lex ? lex.hasMore : null,
  };
}
