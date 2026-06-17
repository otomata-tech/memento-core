/**
 * Lecture d'un document (blocs ordonnés + sources/liens/commentaires assemblés
 * par bloc) et d'un bloc isolé. Cf. spec §5.1 `mem_document` / `mem_block`.
 *
 * Les liens et commentaires sont en lecture seule ici (leurs verbes d'écriture
 * arrivent aux Lots 2-3) ; les tables existent déjà, on les expose dès la lecture.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { db, documents, blocks, sources, blockSources, links, comments, sections, workspaces } from "./db.ts";
import { resolveDocumentByPath } from "./paths.ts";
import { docUrl } from "./urls.ts";

type Block = typeof blocks.$inferSelect;

async function documentById(id: string) {
  const [row] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!row) throw new Error(`Document introuvable: ${id}`);
  return row;
}

/** Slug de la KB propriétaire d'une section (pour les liens viewer). */
async function workspaceSlugOfSection(sectionId: string): Promise<string> {
  const [row] = await db
    .select({ slug: workspaces.slug })
    .from(sections)
    .innerJoin(workspaces, eq(sections.workspaceId, workspaces.id))
    .where(eq(sections.id, sectionId))
    .limit(1);
  if (!row) throw new Error(`Section introuvable: ${sectionId}`);
  return row.slug;
}

async function loadBlockSources(blockIds: string[]) {
  if (blockIds.length === 0) return [];
  return db
    .select({
      blockId: blockSources.blockId,
      locator: blockSources.locator,
      sourceId: sources.id,
      kind: sources.kind,
      title: sources.title,
      ref: sources.ref,
      citation: sources.citation,
    })
    .from(blockSources)
    .innerJoin(sources, eq(blockSources.sourceId, sources.id))
    .where(inArray(blockSources.blockId, blockIds));
}

async function loadLinks(blockIds: string[]) {
  if (blockIds.length === 0) return [];
  return db
    .select({
      id: links.id,
      fromBlockId: links.fromBlockId,
      toBlockId: links.toBlockId,
      relation: links.relation,
      note: links.note,
    })
    .from(links)
    .where(or(inArray(links.fromBlockId, blockIds), inArray(links.toBlockId, blockIds)));
}

async function loadBlockComments(blockIds: string[]) {
  if (blockIds.length === 0) return [];
  return db
    .select({
      id: comments.id,
      targetId: comments.targetId,
      body: comments.body,
      author: comments.author,
      authorKind: comments.authorKind,
      resolvedAt: comments.resolvedAt,
    })
    .from(comments)
    .where(and(eq(comments.targetType, "BLOCK"), inArray(comments.targetId, blockIds)));
}

/** Assemble un bloc avec ses sources / liens (entrants+sortants) / commentaires. */
function assembleBlock(
  block: Block,
  src: Awaited<ReturnType<typeof loadBlockSources>>,
  lnk: Awaited<ReturnType<typeof loadLinks>>,
  cmt: Awaited<ReturnType<typeof loadBlockComments>>,
) {
  return {
    id: block.id,
    type: block.type,
    content: block.content,
    position: block.position,
    verifiedAt: block.verifiedAt,
    sources: src
      .filter((s) => s.blockId === block.id)
      .map((s) => ({
        sourceId: s.sourceId,
        kind: s.kind,
        title: s.title,
        ref: s.ref,
        citation: s.citation,
        locator: s.locator,
      })),
    linksFrom: lnk
      .filter((l) => l.fromBlockId === block.id)
      .map((l) => ({ id: l.id, toBlockId: l.toBlockId, relation: l.relation, note: l.note })),
    linksTo: lnk
      .filter((l) => l.toBlockId === block.id)
      .map((l) => ({ id: l.id, fromBlockId: l.fromBlockId, relation: l.relation, note: l.note })),
    comments: cmt.filter((c) => c.targetId === block.id),
  };
}

export async function getDocument(args: { id?: string; path?: string }) {
  let doc: typeof documents.$inferSelect;
  let wsSlug: string;
  if (args.id) {
    doc = await documentById(args.id);
    wsSlug = await workspaceSlugOfSection(doc.sectionId);
  } else {
    const resolved = await resolveDocumentByPath(requirePath(args.path));
    doc = resolved.document;
    wsSlug = resolved.workspace.slug;
  }

  const blockRows = await db
    .select()
    .from(blocks)
    .where(eq(blocks.documentId, doc.id))
    .orderBy(blocks.position);
  const blockIds = blockRows.map((b) => b.id);

  const [src, lnk, blockCmt, docCmt] = await Promise.all([
    loadBlockSources(blockIds),
    loadLinks(blockIds),
    loadBlockComments(blockIds),
    db
      .select({
        id: comments.id,
        body: comments.body,
        author: comments.author,
        authorKind: comments.authorKind,
        resolvedAt: comments.resolvedAt,
      })
      .from(comments)
      .where(and(eq(comments.targetType, "DOCUMENT"), eq(comments.targetId, doc.id))),
  ]);

  return {
    document: {
      id: doc.id,
      title: doc.title,
      slug: doc.slug,
      summary: doc.summary,
      kind: doc.kind,
      status: doc.status,
      sectionId: doc.sectionId,
      url: docUrl(wsSlug, doc.id),
    },
    blocks: blockRows.map((b) => assembleBlock(b, src, lnk, blockCmt)),
    comments: docCmt,
  };
}

export async function getBlock(id: string) {
  const [block] = await db.select().from(blocks).where(eq(blocks.id, id)).limit(1);
  if (!block) throw new Error(`Bloc introuvable: ${id}`);
  const [doc, src, lnk, cmt] = await Promise.all([
    documentById(block.documentId),
    loadBlockSources([id]),
    loadLinks([id]),
    loadBlockComments([id]),
  ]);
  const wsSlug = await workspaceSlugOfSection(doc.sectionId);
  return {
    documentId: block.documentId,
    url: docUrl(wsSlug, block.documentId, id),
    ...assembleBlock(block, src, lnk, cmt),
  };
}

function requirePath(path?: string): string {
  if (!path) throw new Error("`id` ou `path` requis");
  return path;
}
