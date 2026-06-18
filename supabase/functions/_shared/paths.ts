/**
 * Resolving slugified paths → entities. A Memento `path` is
 * `workspace/section[/subsection...]` (for a section) or
 * `workspace/section[/...]/document` (for a document). The first segment is
 * always the workspace slug.
 *
 * No fallback: a path that doesn't resolve throws an explicit error.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, workspaces, sections, documents } from "./db.ts";

export type Workspace = typeof workspaces.$inferSelect;
export type Section = typeof sections.$inferSelect;
export type Document = typeof documents.$inferSelect;

export function splitPath(path: string): string[] {
  const segments = path.split("/").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) throw new Error(`Empty path`);
  return segments;
}

export async function resolveWorkspaceBySlug(slug: string): Promise<Workspace> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
  if (!ws) throw new Error(`Workspace not found: "${slug}"`);
  return ws;
}

export async function resolveWorkspaceById(id: string): Promise<Workspace> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
  if (!ws) throw new Error(`Workspace not found: ${id}`);
  return ws;
}

/** Descends the section tree following the chain of slugs under the right parent. */
export async function resolveSectionByPath(
  path: string,
): Promise<{ workspace: Workspace; section: Section }> {
  const segments = splitPath(path);
  if (segments.length < 2) {
    throw new Error(`Invalid section path: "${path}" (expected workspace/section/...)`);
  }
  const workspace = await resolveWorkspaceBySlug(segments[0]);
  let parentId: string | null = null;
  let section: Section | null = null;
  for (const slug of segments.slice(1)) {
    const [row] = await db
      .select()
      .from(sections)
      .where(
        and(
          eq(sections.workspaceId, workspace.id),
          parentId === null ? isNull(sections.parentId) : eq(sections.parentId, parentId),
          eq(sections.slug, slug),
        ),
      )
      .limit(1);
    if (!row) throw new Error(`Section not found: "${slug}" in path "${path}"`);
    section = row;
    parentId = row.id;
  }
  return { workspace, section: section! };
}

export async function resolveDocumentByPath(
  path: string,
): Promise<{ workspace: Workspace; section: Section; document: Document }> {
  const segments = splitPath(path);
  if (segments.length < 3) {
    throw new Error(`Invalid document path: "${path}" (expected workspace/section/.../document)`);
  }
  const docSlug = segments[segments.length - 1];
  const { workspace, section } = await resolveSectionByPath(segments.slice(0, -1).join("/"));
  const [document] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.sectionId, section.id), eq(documents.slug, docSlug)))
    .limit(1);
  if (!document) throw new Error(`Document not found: "${docSlug}" in path "${path}"`);
  return { workspace, section, document };
}

/**
 * Builds the {sectionId → full slugified path} table for a workspace,
 * prefixed by the workspace slug. Used to reconstruct sectionPath/docPath
 * in search hits without a recursive query.
 */
export async function loadSectionPathMap(
  workspaceId: string,
  workspaceSlug: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: sections.id, slug: sections.slug, parentId: sections.parentId })
    .from(sections)
    .where(eq(sections.workspaceId, workspaceId));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cache = new Map<string, string>();
  const pathOf = (id: string): string => {
    const cached = cache.get(id);
    if (cached) return cached;
    const row = byId.get(id);
    if (!row) return workspaceSlug;
    const prefix = row.parentId ? pathOf(row.parentId) : workspaceSlug;
    const full = `${prefix}/${row.slug}`;
    cache.set(id, full);
    return full;
  };
  for (const r of rows) pathOf(r.id);
  return cache;
}

/**
 * Ids of the sections of a subtree (slugified path prefix). Serves the search's
 * `sectionPath` filter — lexical AND semantic, same sections for both
 * regimes. Prefix with no match → empty list (zero hits, not an error).
 */
export async function resolveSectionIds(
  workspaceId: string,
  workspaceSlug: string,
  sectionPath: string,
): Promise<string[]> {
  const prefix = sectionPath.replace(/\/+$/, "");
  const pathMap = await loadSectionPathMap(workspaceId, workspaceSlug);
  return [...pathMap.entries()]
    .filter(([, p]) => p === prefix || p.startsWith(`${prefix}/`))
    .map(([id]) => id);
}
