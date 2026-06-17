/**
 * Workspaces + doctrine. La doctrine est le point d'entrée doctrine-first :
 * carte compacte (préambule éditable + arbre de sections + conventions), jamais
 * le contenu des blocs. Cf. spec §5.1.
 */
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  orgs,
  workspaces,
  sections,
  documents,
  blocks,
  settings,
  blockType,
  linkRelation,
  docStatus,
  sourceKind,
} from "./db.ts";
import { resolveWorkspaceBySlug } from "./paths.ts";

export async function listWorkspaces(opts?: { ids?: string[] }) {
  if (opts?.ids && opts.ids.length === 0) return [];
  const cols = {
    slug: workspaces.slug,
    name: workspaces.name,
    summary: workspaces.summary,
    createdAt: workspaces.createdAt,
  };
  // Les workspaces archivés sont masqués de la liste.
  const notArchived = sql`${workspaces.archivedAt} is null`;
  const rows = opts?.ids
    ? await db.select(cols).from(workspaces).where(and(inArray(workspaces.id, opts.ids), notArchived))
    : await db.select(cols).from(workspaces).where(notArchived);
  return [...rows].sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Annuaire des KB publiques (galerie) : non archivées, périmètre `public`. Sans
 * auth — c'est la surface de découverte publique. Étiquetée par org (vitrine).
 */
export async function listPublicWorkspaces() {
  const rows = await db
    .select({
      slug: workspaces.slug,
      name: workspaces.name,
      summary: workspaces.summary,
      createdAt: workspaces.createdAt,
      org: orgs.slug,
      orgName: orgs.name,
    })
    .from(workspaces)
    .leftJoin(orgs, eq(workspaces.orgId, orgs.id))
    .where(and(eq(workspaces.visibility, "public"), isNull(workspaces.archivedAt)));
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

export type SectionNode = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  docCount: number;
  blockCount: number;
  children: SectionNode[];
};

/** Arbre des sections d'un workspace avec compteurs directs (docs + blocs), sans contenu. */
export async function buildSectionTree(workspaceId: string): Promise<SectionNode[]> {
  const rows = await db
    .select({
      id: sections.id,
      title: sections.title,
      slug: sections.slug,
      summary: sections.summary,
      parentId: sections.parentId,
      position: sections.position,
    })
    .from(sections)
    .where(eq(sections.workspaceId, workspaceId))
    .orderBy(sections.position);

  const docCounts = await db
    .select({ sectionId: documents.sectionId, n: count() })
    .from(documents)
    .innerJoin(sections, eq(documents.sectionId, sections.id))
    .where(eq(sections.workspaceId, workspaceId))
    .groupBy(documents.sectionId);

  const blockCounts = await db
    .select({ sectionId: documents.sectionId, n: count(blocks.id) })
    .from(blocks)
    .innerJoin(documents, eq(blocks.documentId, documents.id))
    .innerJoin(sections, eq(documents.sectionId, sections.id))
    .where(eq(sections.workspaceId, workspaceId))
    .groupBy(documents.sectionId);

  const docCountBy = new Map(docCounts.map((r) => [r.sectionId, Number(r.n)]));
  const blockCountBy = new Map(blockCounts.map((r) => [r.sectionId, Number(r.n)]));

  const nodeById = new Map<string, SectionNode>();
  for (const r of rows) {
    nodeById.set(r.id, {
      id: r.id,
      title: r.title,
      slug: r.slug,
      summary: r.summary,
      docCount: docCountBy.get(r.id) ?? 0,
      blockCount: blockCountBy.get(r.id) ?? 0,
      children: [],
    });
  }
  const roots: SectionNode[] = [];
  for (const r of rows) {
    const node = nodeById.get(r.id)!;
    const parent = r.parentId ? nodeById.get(r.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function getSetting(workspaceId: string, key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, key)))
    .limit(1);
  return row?.value ?? null;
}

export async function getDoctrine(workspaceSlug: string) {
  const ws = await resolveWorkspaceBySlug(workspaceSlug);
  const [preamble, tree] = await Promise.all([
    getSetting(ws.id, "doctrine.preamble"),
    buildSectionTree(ws.id),
  ]);
  return {
    workspace: { slug: ws.slug, name: ws.name, summary: ws.summary },
    preamble: preamble ?? "",
    tree,
    conventions: {
      blockTypes: blockType.enumValues,
      linkRelations: linkRelation.enumValues,
      docStatuses: docStatus.enumValues,
      sourceKinds: sourceKind.enumValues,
    },
  };
}
