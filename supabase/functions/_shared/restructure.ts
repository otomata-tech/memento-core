/**
 * Restructuring (Batch 4) — composite & atomic operations on the section backbone.
 * Cf. spec §5.3. Named verbs = auditable intent ("split 3.2", not 4 micro-moves).
 * All mutating verbs accept `dryRun: true` → return the before/after diff + impact,
 * without mutating anything.
 *
 * Invariants (§4): tree of depth ≤ 3, unique slugs (workspace,parent) for sections and
 * (section,slug) for documents, strict scoping per workspace.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, sections, documents, workspaces } from "./db.ts";
import { slugify, revise } from "./write.ts";
import { assertAccess } from "./access.ts";

const MAX_DEPTH = 3; // root = 0 ; up to 4 levels

type Sec = typeof sections.$inferSelect;
type Doc = typeof documents.$inferSelect;

async function sectionRow(id: string): Promise<Sec> {
  const [s] = await db.select().from(sections).where(eq(sections.id, id)).limit(1);
  if (!s) throw new Error(`Section not found: ${id}`);
  return s;
}

async function nextPos(table: "sections" | "documents", col: "parentId" | "sectionId", parentId: string | null): Promise<number> {
  const t = table === "sections" ? sections : documents;
  const c = table === "sections" ? sections.parentId : documents.sectionId;
  const where = parentId === null ? sql`${c} is null` : eq(c, parentId);
  const [r] = await db.select({ m: sql<number>`coalesce(max(position), -1)` }).from(t).where(where);
  return Number(r?.m ?? -1) + 1;
}

/** Unique slug for a document in a target section (suffix -2, -3… on collision). */
function dedupeSlug(base: string, taken: Set<string>): string {
  let slug = base;
  if (taken.has(slug)) { let n = 2; while (taken.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}`; }
  taken.add(slug);
  return slug;
}

// ── Sections: create / rename ──────────────────────────────────────────────────
export async function createSection(
  args: { workspace: string; parentId?: string; title: string; summary?: string; position?: number },
  actor: string,
) {
  const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, args.workspace)).limit(1);
  if (!ws) throw new Error(`Workspace not found: ${args.workspace}`);
  let depth = 0;
  if (args.parentId) {
    const parent = await sectionRow(args.parentId);
    if (parent.workspaceId !== ws.id) throw new Error("parent section outside workspace");
    depth = parent.depth + 1;
  }
  if (depth > MAX_DEPTH) throw new Error(`max depth exceeded (≤ ${MAX_DEPTH})`);

  const siblings = await db.select({ slug: sections.slug }).from(sections)
    .where(args.parentId ? eq(sections.parentId, args.parentId) : sql`${sections.parentId} is null`);
  const slug = dedupeSlug(slugify(args.title), new Set(siblings.map((s) => s.slug)));

  const [row] = await db.insert(sections).values({
    workspaceId: ws.id, parentId: args.parentId ?? null, title: args.title, slug,
    summary: args.summary ?? "", depth,
    position: args.position ?? await nextPos("sections", "parentId", args.parentId ?? null),
  }).returning();
  await revise(ws.id, "section", row.id, "create_section", `create section "${args.title}"`, actor, null, { title: args.title, slug, depth });
  return row;
}

export async function renameSection(args: { id: string; title?: string; summary?: string }, actor: string) {
  const s = await sectionRow(args.id);
  const patch: Partial<Sec> = {};
  if (args.title !== undefined) patch.title = args.title;
  if (args.summary !== undefined) patch.summary = args.summary;
  if (Object.keys(patch).length === 0) throw new Error("nothing to change (title and/or summary)");
  const [after] = await db.update(sections).set(patch).where(eq(sections.id, args.id)).returning();
  // stable slug (paths don't break).
  await revise(s.workspaceId, "section", args.id, "rename_section", "rename section", actor,
    { title: s.title, summary: s.summary }, { title: after.title, summary: after.summary });
  return after;
}

/** Deletes an empty section (no documents or subsections). */
export async function deleteSection(args: { id: string; reason?: string }, actor: string) {
  const s = await sectionRow(args.id);
  const [doc] = await db.select({ id: documents.id }).from(documents).where(eq(documents.sectionId, s.id)).limit(1);
  if (doc) throw new Error("non-empty section (contains documents) — move them first");
  const [child] = await db.select({ id: sections.id }).from(sections).where(eq(sections.parentId, s.id)).limit(1);
  if (child) throw new Error("non-empty section (contains subsections)");
  await db.delete(sections).where(eq(sections.id, s.id));
  await revise(s.workspaceId, "section", s.id, "delete_section", args.reason ?? "delete section", actor, { title: s.title, slug: s.slug, depth: s.depth }, null);
  return { deleted: s.id };
}

// ── Reordering (sections OR documents of the same parent) ───────────────────────
export async function reorder(args: { parentId?: string; orderedChildIds: string[] }, actor: string) {
  const ids = args.orderedChildIds;
  if (!ids?.length) throw new Error("orderedChildIds empty");

  const secs = await db.select().from(sections).where(inArray(sections.id, ids));
  if (secs.length === ids.length) {
    const parents = new Set(secs.map((s) => s.parentId ?? "root"));
    if (parents.size !== 1) throw new Error("all sections must share the same parent");
    if (args.parentId !== undefined && (secs[0].parentId ?? null) !== args.parentId) {
      throw new Error("the sections do not belong to the given parentId");
    }
    // Authorization bound to the REAL entity (not a supplied anchor): prevents reordering
    // sections of another workspace. All share the same parent ⇒ same workspace.
    await assertAccess(actor, { id: secs[0].id, kind: "section" }, { write: true });
    const byId = new Map(secs.map((s) => [s.id, s]));
    for (let i = 0; i < ids.length; i++) await db.update(sections).set({ position: i }).where(eq(sections.id, ids[i]));
    await revise(secs[0].workspaceId, "structure", secs[0].parentId, "reorder_sections", "reorder sections", actor, null, { order: ids });
    return { reordered: "sections", count: ids.length, order: ids.map((id) => byId.get(id)!.slug) };
  }

  const docs = await db.select().from(documents).where(inArray(documents.id, ids));
  if (docs.length === ids.length) {
    const secIds = new Set(docs.map((d) => d.sectionId));
    if (secIds.size !== 1) throw new Error("all documents must belong to the same section");
    await assertAccess(actor, { id: docs[0].id, kind: "document" }, { write: true });
    const section = await sectionRow(docs[0].sectionId);
    for (let i = 0; i < ids.length; i++) await db.update(documents).set({ position: i }).where(eq(documents.id, ids[i]));
    await revise(section.workspaceId, "structure", section.id, "reorder_documents", "reorder documents", actor, null, { order: ids });
    return { reordered: "documents", count: ids.length };
  }

  throw new Error("orderedChildIds must be all sections (same parent) or all documents (same section)");
}

// ── Document moves (core of split/merge) ───────────────────────────────────────
/** Relocates documents into a target section (slug dedup + repositioning). */
async function relocateDocs(docIds: string[], target: Sec, actor: string): Promise<Array<{ id: string; from: string; to: string; slug: string }>> {
  const existing = await db.select({ slug: documents.slug }).from(documents).where(eq(documents.sectionId, target.id));
  const taken = new Set(existing.map((d) => d.slug));
  let pos = await nextPos("documents", "sectionId", target.id);
  const moves: Array<{ id: string; from: string; to: string; slug: string }> = [];
  for (const id of docIds) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) throw new Error(`Document not found: ${id}`);
    if (doc.sectionId === target.id) continue;
    const fromSec = await sectionRow(doc.sectionId);
    if (fromSec.workspaceId !== target.workspaceId) throw new Error("cross-workspace move forbidden");
    const slug = dedupeSlug(doc.slug, taken);
    await db.update(documents).set({ sectionId: target.id, slug, position: pos++ }).where(eq(documents.id, id));
    await revise(target.workspaceId, "document", id, "move_document", "move document", actor,
      { sectionId: doc.sectionId, slug: doc.slug }, { sectionId: target.id, slug });
    moves.push({ id, from: fromSec.slug, to: target.slug, slug });
  }
  return moves;
}

/** dry_run: previews slug collisions without mutating. `targetSectionId=null` = brand-new section (no slug taken). */
async function previewMoves(docIds: string[], targetSectionId: string | null) {
  const existing = targetSectionId
    ? await db.select({ slug: documents.slug }).from(documents).where(eq(documents.sectionId, targetSectionId))
    : [];
  const taken = new Set(existing.map((d) => d.slug));
  if (!docIds.length) return [];
  const docs = await db.select().from(documents).where(inArray(documents.id, docIds));
  return docs.map((d) => {
    const finalSlug = dedupeSlug(d.slug, taken);
    return { id: d.id, title: d.title, fromSection: d.sectionId, slug: finalSlug, renamed: finalSlug !== d.slug };
  });
}

export async function moveDocuments(args: { documentIds: string[]; targetSectionId: string; dryRun?: boolean }, actor: string) {
  const target = await sectionRow(args.targetSectionId);
  if (args.dryRun) {
    return { dryRun: true, op: "move_documents", targetSection: target.slug, moves: await previewMoves(args.documentIds, target.id) };
  }
  const moves = await relocateDocs(args.documentIds, target, actor);
  return { op: "move_documents", targetSection: target.slug, moved: moves.length, moves };
}

// ── Split (the canonical case) ──────────────────────────────────────────────────
export async function splitSection(
  args: { id: string; newSectionTitle: string; documentIdsToMove: string[]; dryRun?: boolean },
  actor: string,
) {
  const source = await sectionRow(args.id);
  // The documents to move must belong to the split section (verb intent +
  // bounds the op to the workspace already authorized via args.id).
  if (args.documentIdsToMove.length) {
    const owned = await db.select({ id: documents.id }).from(documents)
      .where(and(eq(documents.sectionId, source.id), inArray(documents.id, args.documentIdsToMove)));
    if (owned.length !== args.documentIdsToMove.length) {
      throw new Error("documentIdsToMove must all belong to the split section");
    }
  }
  const siblings = await db.select({ slug: sections.slug }).from(sections)
    .where(source.parentId ? eq(sections.parentId, source.parentId) : sql`${sections.parentId} is null`);
  const newSlug = dedupeSlug(slugify(args.newSectionTitle), new Set(siblings.map((s) => s.slug)));

  if (args.dryRun) {
    return {
      dryRun: true, op: "split_section", source: source.slug,
      newSection: { title: args.newSectionTitle, slug: newSlug, depth: source.depth, parentId: source.parentId },
      moves: await previewMoves(args.documentIdsToMove, null),
    };
  }

  const [created] = await db.insert(sections).values({
    workspaceId: source.workspaceId, parentId: source.parentId, title: args.newSectionTitle, slug: newSlug,
    summary: "", depth: source.depth, position: await nextPos("sections", "parentId", source.parentId),
  }).returning();
  const moves = await relocateDocs(args.documentIdsToMove, created, actor);
  await revise(source.workspaceId, "structure", source.id, "split_section",
    `split of "${source.title}" → "${args.newSectionTitle}"`, actor,
    { source: source.slug }, { newSection: newSlug, moved: moves.length });
  return { op: "split_section", source: source.slug, newSection: created, moved: moves.length, moves };
}

// ── Merge ───────────────────────────────────────────────────────────────────────
export async function mergeSections(args: { sourceIds: string[]; targetId: string; dryRun?: boolean }, actor: string) {
  const target = await sectionRow(args.targetId);
  const sources: Sec[] = [];
  for (const id of args.sourceIds) {
    if (id === target.id) throw new Error("a source section cannot be the target");
    const s = await sectionRow(id);
    if (s.workspaceId !== target.workspaceId) throw new Error("cross-workspace merge forbidden");
    const [child] = await db.select({ id: sections.id }).from(sections).where(eq(sections.parentId, id)).limit(1);
    if (child) throw new Error(`section "${s.slug}" has subsections — merge refused (empty them first)`);
    sources.push(s);
  }

  const allDocs: Doc[] = [];
  for (const s of sources) {
    const docs = await db.select().from(documents).where(eq(documents.sectionId, s.id));
    allDocs.push(...docs);
  }

  if (args.dryRun) {
    return {
      dryRun: true, op: "merge_sections", target: target.slug,
      sourcesToDelete: sources.map((s) => s.slug),
      moves: await previewMoves(allDocs.map((d) => d.id), target.id),
    };
  }

  const moves = await relocateDocs(allDocs.map((d) => d.id), target, actor);
  for (const s of sources) await db.delete(sections).where(eq(sections.id, s.id));
  await revise(target.workspaceId, "structure", target.id, "merge_sections",
    `merge of ${sources.length} section(s) → "${target.title}"`, actor,
    { sources: sources.map((s) => s.slug) }, { target: target.slug, moved: moves.length });
  return { op: "merge_sections", target: target.slug, deleted: sources.map((s) => s.slug), moved: moves.length };
}
