/**
 * Énumération/agrégation DÉTERMINISTE (#41, audit D2/§6.1) : le complément
 * exhaustif de mem_search (top-k). Recall 100 % par construction — SQL pur,
 * zéro embedding. Lignes compactes + totalCount/hasMore + curseur keyset
 * (updated_at, id), stable même si la KB bouge entre deux pages.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "./db.ts";
import { resolveWorkspaceBySlug, loadSectionPathMap } from "./paths.ts";

export type ListKind = "blocks" | "documents";

export type ListFilters = {
  blockType?: string;
  docStatus?: string;
  verified?: boolean;
  hasSource?: boolean;
  sectionPath?: string;
  docKind?: string;
  updatedSince?: string;
  updatedUntil?: string;
};

const BLOCK_ONLY: (keyof ListFilters)[] = ["blockType", "verified", "hasSource"];

const encodeCursor = (u: string, id: string) => btoa(JSON.stringify({ u, id }));
function decodeCursor(cursor: string): { u: string; id: string } {
  try {
    const { u, id } = JSON.parse(atob(cursor));
    if (typeof u !== "string" || typeof id !== "string") throw new Error();
    return { u, id };
  } catch {
    throw new Error("`cursor` invalide — reprends celui renvoyé par la page précédente");
  }
}

/** Première ligne, bornée — la ligne compacte ne coûte jamais un bloc entier. */
function excerptOf(contentHead: string): string {
  const line = contentHead.split("\n")[0];
  return line.length > 100 ? `${line.slice(0, 100)}…` : line;
}

/**
 * Conditions WHERE communes list/count. Jamais d'acceptation muette : un filtre
 * non applicable au `kind` est une erreur. Retourne null si `sectionPath` ne
 * matche aucune section (résultat vide légitime, pas une erreur).
 */
function buildConds(
  kind: ListKind,
  wsId: string,
  f: ListFilters,
  pathMap: Map<string, string>,
): SQL[] | null {
  for (const k of BLOCK_ONLY) {
    if (kind === "documents" && f[k] !== undefined) {
      throw new Error(`\`${k}\` non applicable à kind=documents`);
    }
  }
  const t = kind === "blocks" ? sql`b` : sql`d`; // porteur de updated_at
  const conds = [sql`s.workspace_id = ${wsId}`];
  if (f.blockType) conds.push(sql`b.type = ${f.blockType}::mem_block_type`);
  if (f.docStatus) conds.push(sql`d.status = ${f.docStatus}::mem_doc_status`);
  if (f.verified === true) conds.push(sql`b.verified_at IS NOT NULL`);
  if (f.verified === false) conds.push(sql`b.verified_at IS NULL`);
  if (f.hasSource === true) {
    conds.push(sql`EXISTS(SELECT 1 FROM mem_block_sources bs WHERE bs.block_id = b.id)`);
  }
  if (f.hasSource === false) {
    conds.push(sql`NOT EXISTS(SELECT 1 FROM mem_block_sources bs WHERE bs.block_id = b.id)`);
  }
  if (f.docKind) conds.push(sql`d.kind = ${f.docKind}`);
  if (f.updatedSince) conds.push(sql`${t}.updated_at >= ${f.updatedSince}::timestamptz`);
  if (f.updatedUntil) conds.push(sql`${t}.updated_at <= ${f.updatedUntil}::timestamptz`);
  if (f.sectionPath) {
    const prefix = f.sectionPath.replace(/\/+$/, "");
    const ids = [...pathMap.entries()]
      .filter(([, p]) => p === prefix || p.startsWith(`${prefix}/`))
      .map(([id]) => id);
    if (!ids.length) return null;
    conds.push(sql`s.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
  }
  return conds;
}

const FROM: Record<ListKind, SQL> = {
  blocks: sql`FROM mem_blocks b JOIN mem_documents d ON d.id = b.document_id JOIN mem_sections s ON s.id = d.section_id`,
  documents: sql`FROM mem_documents d JOIN mem_sections s ON s.id = d.section_id`,
};

export async function listItems(
  args: { workspace: string; kind?: ListKind; cursor?: string; limit?: number } & ListFilters,
) {
  const kind = args.kind ?? "blocks";
  const ws = await resolveWorkspaceBySlug(args.workspace);
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const pathMap = await loadSectionPathMap(ws.id, ws.slug);

  const conds = buildConds(kind, ws.id, args, pathMap);
  if (!conds) return { kind, items: [], totalCount: 0, hasMore: false, cursor: null };
  const where = sql.join(conds, sql` AND `);

  // totalCount = correspondants du filtre, SANS curseur (stable d'une page à l'autre).
  const [{ n: totalCount }] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n ${FROM[kind]} WHERE ${where}`,
  );

  const t = kind === "blocks" ? sql`b` : sql`d`;
  const pageConds = [...conds];
  if (args.cursor) {
    const c = decodeCursor(args.cursor);
    pageConds.push(sql`(${t}.updated_at, ${t}.id) < (${c.u}::timestamptz, ${c.id}::uuid)`);
  }
  const pageWhere = sql.join(pageConds, sql` AND `);
  const order = sql`ORDER BY ${t}.updated_at DESC, ${t}.id DESC LIMIT ${limit + 1}`;

  let items: Record<string, unknown>[];
  let lastKey: { u: string; id: string } | null = null;

  if (kind === "blocks") {
    const rows = await db.execute<{
      id: string; type: string; content_head: string;
      doc_slug: string; doc_title: string; doc_status: string;
      section_id: string; verified_at: string | null; updated_at: string;
      source_count: number; superseded: boolean; contradicted: boolean;
    }>(sql`
      SELECT b.id, b.type, left(b.content, 200) AS content_head,
             d.slug AS doc_slug, d.title AS doc_title, d.status AS doc_status,
             s.id AS section_id, b.verified_at, b.updated_at,
             (SELECT count(*)::int FROM mem_block_sources bs WHERE bs.block_id = b.id) AS source_count,
             EXISTS(SELECT 1 FROM mem_links l WHERE l.to_block_id = b.id AND l.relation = 'SUPERSEDES') AS superseded,
             EXISTS(SELECT 1 FROM mem_links l WHERE l.to_block_id = b.id AND l.relation = 'CONTRADICTS') AS contradicted
      ${FROM.blocks} WHERE ${pageWhere} ${order}`);
    const page = [...rows].slice(0, limit);
    const last = page[page.length - 1];
    if (last) lastKey = { u: last.updated_at, id: last.id };
    items = page.map((r) => {
      const sectionPath = pathMap.get(r.section_id) ?? ws.slug;
      return {
        id: r.id,
        type: r.type,
        excerpt: excerptOf(r.content_head),
        docPath: `${sectionPath}/${r.doc_slug}`,
        docTitle: r.doc_title,
        docStatus: r.doc_status,
        verifiedAt: r.verified_at,
        updatedAt: r.updated_at,
        sourceCount: Number(r.source_count),
        superseded: r.superseded,
        contradicted: r.contradicted,
      };
    });
    return paged(kind, items, totalCount, rows.length > limit, lastKey);
  }

  const rows = await db.execute<{
    id: string; slug: string; title: string; status: string; kind: string | null;
    section_id: string; block_count: number; created_at: string; updated_at: string;
  }>(sql`
    SELECT d.id, d.slug, d.title, d.status, d.kind, s.id AS section_id,
           (SELECT count(*)::int FROM mem_blocks b2 WHERE b2.document_id = d.id) AS block_count,
           d.created_at, d.updated_at
    ${FROM.documents} WHERE ${pageWhere} ${order}`);
  const page = [...rows].slice(0, limit);
  const last = page[page.length - 1];
  if (last) lastKey = { u: last.updated_at, id: last.id };
  items = page.map((r) => {
    const sectionPath = pathMap.get(r.section_id) ?? ws.slug;
    return {
      id: r.id,
      title: r.title,
      docPath: `${sectionPath}/${r.slug}`,
      kind: r.kind,
      status: r.status,
      blockCount: Number(r.block_count),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
  return paged(kind, items, totalCount, rows.length > limit, lastKey);
}

function paged(
  kind: ListKind,
  items: Record<string, unknown>[],
  totalCount: number,
  hasMore: boolean,
  lastKey: { u: string; id: string } | null,
) {
  return {
    kind,
    items,
    totalCount: Number(totalCount),
    hasMore,
    cursor: hasMore && lastKey ? encodeCursor(lastKey.u, lastKey.id) : null,
  };
}

export type GroupBy = "type" | "docStatus" | "section" | "docKind";

const GROUP_COL: Record<GroupBy, SQL> = {
  type: sql`b.type::text`,
  docStatus: sql`d.status::text`,
  section: sql`s.id::text`,
  docKind: sql`d.kind`,
};

export async function countItems(
  args: { workspace: string; kind?: ListKind; groupBy?: GroupBy } & ListFilters,
) {
  const kind = args.kind ?? "blocks";
  if (args.groupBy === "type" && kind === "documents") {
    throw new Error("`groupBy: type` non applicable à kind=documents (type est une propriété de bloc)");
  }
  const ws = await resolveWorkspaceBySlug(args.workspace);
  const pathMap = await loadSectionPathMap(ws.id, ws.slug);

  const conds = buildConds(kind, ws.id, args, pathMap);
  if (!conds) return { kind, total: 0, ...(args.groupBy ? { groupBy: args.groupBy, groups: [] } : {}) };
  const where = sql.join(conds, sql` AND `);

  const [{ n: total }] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n ${FROM[kind]} WHERE ${where}`,
  );
  if (!args.groupBy) return { kind, total: Number(total) };

  const rows = await db.execute<{ key: string | null; n: number }>(sql`
    SELECT ${GROUP_COL[args.groupBy]} AS key, count(*)::int AS n
    ${FROM[kind]} WHERE ${where} GROUP BY 1 ORDER BY n DESC`);
  const groups = [...rows].map((r) => ({
    key: args.groupBy === "section" && r.key ? (pathMap.get(r.key) ?? r.key) : r.key,
    count: Number(r.n),
  }));
  return { kind, total: Number(total), groupBy: args.groupBy, groups };
}
