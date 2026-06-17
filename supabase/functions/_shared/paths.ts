/**
 * Résolution de chemins slugifiés → entités. Un `path` Memento est
 * `workspace/section[/sous-section...]` (pour une section) ou
 * `workspace/section[/...]/document` (pour un document). Le premier segment est
 * toujours le slug du workspace.
 *
 * Pas de fallback : un chemin qui ne résout pas lève une erreur explicite.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, workspaces, sections, documents } from "./db.ts";

export type Workspace = typeof workspaces.$inferSelect;
export type Section = typeof sections.$inferSelect;
export type Document = typeof documents.$inferSelect;

export function splitPath(path: string): string[] {
  const segments = path.split("/").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) throw new Error(`Chemin vide`);
  return segments;
}

export async function resolveWorkspaceBySlug(slug: string): Promise<Workspace> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
  if (!ws) throw new Error(`Workspace introuvable: "${slug}"`);
  return ws;
}

export async function resolveWorkspaceById(id: string): Promise<Workspace> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
  if (!ws) throw new Error(`Workspace introuvable: ${id}`);
  return ws;
}

/** Descend l'arbre de sections en suivant la chaîne de slugs sous le bon parent. */
export async function resolveSectionByPath(
  path: string,
): Promise<{ workspace: Workspace; section: Section }> {
  const segments = splitPath(path);
  if (segments.length < 2) {
    throw new Error(`Chemin de section invalide: "${path}" (attendu workspace/section/...)`);
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
    if (!row) throw new Error(`Section introuvable: "${slug}" dans le chemin "${path}"`);
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
    throw new Error(`Chemin de document invalide: "${path}" (attendu workspace/section/.../document)`);
  }
  const docSlug = segments[segments.length - 1];
  const { workspace, section } = await resolveSectionByPath(segments.slice(0, -1).join("/"));
  const [document] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.sectionId, section.id), eq(documents.slug, docSlug)))
    .limit(1);
  if (!document) throw new Error(`Document introuvable: "${docSlug}" dans le chemin "${path}"`);
  return { workspace, section, document };
}

/**
 * Construit la table {sectionId → chemin slugifié complet} pour un workspace,
 * préfixée par le slug du workspace. Utilisé pour reconstituer sectionPath/docPath
 * dans les hits de recherche sans requête récursive.
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
 * Ids des sections d'un sous-arbre (préfixe de chemin slugifié). Sert au filtre
 * `sectionPath` de la recherche — lexical ET sémantique, mêmes sections pour les
 * deux régimes. Préfixe sans correspondance → liste vide (zéro hit, pas d'erreur).
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
