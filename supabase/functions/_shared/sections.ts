/**
 * Lecture d'une section : déplie une zone (sous-sections + documents avec
 * compteurs et statut), jamais les blocs. Cf. spec §5.1 `mem_section`.
 */
import { count, eq, inArray } from "drizzle-orm";
import { db, sections, documents, blocks } from "./db.ts";
import { resolveSectionByPath, type Section } from "./paths.ts";

async function sectionById(id: string): Promise<Section> {
  const [row] = await db.select().from(sections).where(eq(sections.id, id)).limit(1);
  if (!row) throw new Error(`Section introuvable: ${id}`);
  return row;
}

export async function getSection(args: { id?: string; path?: string }) {
  const section = args.id
    ? await sectionById(args.id)
    : (await resolveSectionByPath(requirePath(args.path))).section;

  const subsections = await db
    .select({
      id: sections.id,
      title: sections.title,
      slug: sections.slug,
      summary: sections.summary,
      position: sections.position,
    })
    .from(sections)
    .where(eq(sections.parentId, section.id))
    .orderBy(sections.position);

  const docs = await db
    .select({
      id: documents.id,
      title: documents.title,
      slug: documents.slug,
      summary: documents.summary,
      kind: documents.kind,
      status: documents.status,
      position: documents.position,
    })
    .from(documents)
    .where(eq(documents.sectionId, section.id))
    .orderBy(documents.position);

  const docIds = docs.map((d) => d.id);
  const blockCountBy = new Map<string, number>();
  if (docIds.length > 0) {
    const counts = await db
      .select({ documentId: blocks.documentId, n: count() })
      .from(blocks)
      .where(inArray(blocks.documentId, docIds))
      .groupBy(blocks.documentId);
    for (const c of counts) blockCountBy.set(c.documentId, Number(c.n));
  }

  return {
    section: {
      id: section.id,
      title: section.title,
      slug: section.slug,
      summary: section.summary,
      depth: section.depth,
    },
    subsections,
    documents: docs.map((d) => ({ ...d, blockCount: blockCountBy.get(d.id) ?? 0 })),
  };
}

function requirePath(path?: string): string {
  if (!path) throw new Error("`id` ou `path` requis");
  return path;
}
