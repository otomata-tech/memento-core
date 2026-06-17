/**
 * Traversée du graphe de liens (issue #17, partie 1) : `mem_neighborhood`.
 *
 * BFS itérative (une requête par niveau, `inArray` → IN (...) compatible pooler ;
 * le binding tableau `any(::text[])` casse sur Supavisor, cf. CLAUDE.md). Profondeur
 * plafonnée et nombre de nœuds borné : le serveur ne rend jamais de mur de texte —
 * les nœuds portent un extrait, l'agent fore avec mem_block.
 *
 * Scoping : un MemLink relie toujours deux blocs du même workspace (invariant spec §4),
 * donc l'autorisation sur le bloc racine couvre tout le sous-graphe.
 */
import { eq, inArray, or, and, type SQL } from "drizzle-orm";
import { db, blocks, documents, sections, links, linkRelation } from "./db.ts";

const MAX_DEPTH = 3;
const MAX_NODES = 200;
const EXCERPT = 280;

const RELATIONS = linkRelation.enumValues as string[];

export type NeighborhoodArgs = {
  blockId: string;
  depth?: number;
  relations?: string[];
  direction?: "out" | "in" | "both";
};

export async function neighborhood(args: NeighborhoodArgs) {
  const depth = Math.min(Math.max(args.depth ?? 1, 1), MAX_DEPTH);
  const direction = args.direction ?? "both";
  const relations = args.relations?.filter((r) => RELATIONS.includes(r));
  if (args.relations && !relations?.length) {
    throw new Error(`relations invalides (attendu: ${RELATIONS.join(", ")})`);
  }

  const [root] = await db.select({ id: blocks.id }).from(blocks)
    .where(eq(blocks.id, args.blockId)).limit(1);
  if (!root) throw new Error(`Bloc introuvable: ${args.blockId}`);

  // BFS niveau par niveau sur mem_links.
  const seen = new Set<string>([args.blockId]);
  const nodeDepth = new Map<string, number>([[args.blockId, 0]]);
  const edges = new Map<string, { id: string; fromBlockId: string; toBlockId: string; relation: string; note: string | null }>();
  let frontier = [args.blockId];
  let truncated = false;

  for (let level = 1; level <= depth && frontier.length; level++) {
    const reach: SQL[] = [];
    if (direction !== "in") reach.push(inArray(links.fromBlockId, frontier));
    if (direction !== "out") reach.push(inArray(links.toBlockId, frontier));
    const where = relations?.length
      ? and(or(...reach), inArray(links.relation, relations as (typeof linkRelation.enumValues[number])[]))
      : or(...reach);

    const rows = await db.select({
      id: links.id, fromBlockId: links.fromBlockId, toBlockId: links.toBlockId,
      relation: links.relation, note: links.note,
    }).from(links).where(where);

    const next: string[] = [];
    for (const l of rows) {
      edges.set(l.id, l);
      for (const end of [l.fromBlockId, l.toBlockId]) {
        if (seen.has(end)) continue;
        if (seen.size >= MAX_NODES) { truncated = true; continue; }
        seen.add(end);
        nodeDepth.set(end, level);
        next.push(end);
      }
    }
    frontier = next;
  }

  // Contexte des nœuds : bloc (extrait) + document + section.
  const nodeRows = await db.select({
    id: blocks.id, type: blocks.type, content: blocks.content,
    verifiedAt: blocks.verifiedAt,
    documentId: documents.id, documentTitle: documents.title, documentStatus: documents.status,
    sectionId: sections.id, sectionTitle: sections.title,
  })
    .from(blocks)
    .innerJoin(documents, eq(blocks.documentId, documents.id))
    .innerJoin(sections, eq(documents.sectionId, sections.id))
    .where(inArray(blocks.id, [...seen]));

  return {
    root: args.blockId,
    depth,
    direction,
    ...(relations?.length ? { relations } : {}),
    nodes: nodeRows.map((n) => ({
      id: n.id,
      depth: nodeDepth.get(n.id) ?? null,
      type: n.type,
      excerpt: n.content.length > EXCERPT ? `${n.content.slice(0, EXCERPT)}…` : n.content,
      contentLength: n.content.length,
      verifiedAt: n.verifiedAt,
      document: { id: n.documentId, title: n.documentTitle, status: n.documentStatus },
      section: { id: n.sectionId, title: n.sectionTitle },
    })).sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0)),
    edges: [...edges.values()],
    truncated,
  };
}
