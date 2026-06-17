/**
 * Préférence utilisateur : KB par défaut. Le serveur reste sans état — c'est une
 * config persistée (relue à chaque requête), pas une session. Un `workspace` explicite
 * l'emporte toujours ; le défaut n'est qu'un repli quand l'argument est omis.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, orgs, pinnedWorkspaces, userPrefs, workspaces } from "./db.ts";
import { assertAccess, effectiveRole } from "./access.ts";

/** KB par défaut du user, ou null. Ignore une préférence devenue inaccessible.
 *  Test d'accès par `effectiveRole` (et non « mes bases ») pour qu'une KB publique
 *  épinglée — possédée ou non — reste un défaut valide. */
export async function getDefaultWorkspace(sub: string): Promise<{ slug: string; name: string } | null> {
  const [p] = await db.select({ wsId: userPrefs.defaultWorkspaceId }).from(userPrefs)
    .where(eq(userPrefs.userId, sub)).limit(1);
  if (!p?.wsId) return null;
  if (!(await effectiveRole(sub, p.wsId))) return null; // accès perdu → on oublie le défaut
  const [w] = await db.select({ slug: workspaces.slug, name: workspaces.name }).from(workspaces)
    .where(eq(workspaces.id, p.wsId)).limit(1);
  return w ?? null;
}

/** Fixe la KB par défaut (doit être accessible au user). */
export async function setDefaultWorkspace(sub: string, slug: string): Promise<{ slug: string; name: string }> {
  await assertAccess(sub, { workspace: slug });
  const [w] = await db.select({ id: workspaces.id, slug: workspaces.slug, name: workspaces.name })
    .from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
  if (!w) throw new Error(`workspace introuvable: ${slug}`);
  await db.insert(userPrefs).values({ userId: sub, defaultWorkspaceId: w.id })
    .onConflictDoUpdate({ target: userPrefs.userId, set: { defaultWorkspaceId: w.id } });
  return { slug: w.slug, name: w.name };
}

/** KB épinglées du user (typiquement publiques d'autres orgs), non archivées, accès vérifié.
 *  Distinct du défaut : c'est une COLLECTION (multi), surfacée dans contextMap.pinned et
 *  couverte par la recherche globale. */
export async function listPins(sub: string): Promise<{ id: string; slug: string; name: string; summary: string; org: string | null }[]> {
  const rows = await db
    .select({
      id: workspaces.id, slug: workspaces.slug, name: workspaces.name,
      summary: workspaces.summary, org: orgs.slug,
    })
    .from(pinnedWorkspaces)
    .innerJoin(workspaces, eq(pinnedWorkspaces.workspaceId, workspaces.id))
    .leftJoin(orgs, eq(workspaces.orgId, orgs.id))
    .where(and(eq(pinnedWorkspaces.userId, sub), isNull(workspaces.archivedAt)));
  // Filtre d'accès : une KB devenue privée/non lisible disparaît silencieusement de l'univers.
  const checked = await Promise.all(rows.map(async (r) => ((await effectiveRole(sub, r.id)) ? r : null)));
  return checked.filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Ids des KB épinglées accessibles — sert l'union de la recherche globale. */
export async function pinnedWorkspaceIds(sub: string): Promise<string[]> {
  return (await listPins(sub)).map((r) => r.id);
}

/** Épingle une KB (doit être lisible — les KB publiques le sont par tous). Idempotent. */
export async function pinWorkspace(sub: string, slug: string): Promise<{ slug: string; name: string }> {
  await assertAccess(sub, { workspace: slug });
  const [w] = await db.select({ id: workspaces.id, slug: workspaces.slug, name: workspaces.name })
    .from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
  if (!w) throw new Error(`workspace introuvable: ${slug}`);
  await db.insert(pinnedWorkspaces).values({ userId: sub, workspaceId: w.id }).onConflictDoNothing();
  return { slug: w.slug, name: w.name };
}

/** Retire une KB des épinglées. */
export async function unpinWorkspace(sub: string, slug: string): Promise<{ slug: string }> {
  const [w] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
  if (w) await db.delete(pinnedWorkspaces).where(and(eq(pinnedWorkspaces.userId, sub), eq(pinnedWorkspaces.workspaceId, w.id)));
  return { slug };
}

/** Slug de la KB à utiliser : l'explicite, sinon le défaut, sinon erreur explicite. */
export async function effectiveWorkspace(sub: string, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const d = await getDefaultWorkspace(sub);
  if (!d) throw new Error("aucune KB précisée et aucune par défaut — appelle mem_use_workspace({workspace}) ou passe `workspace`");
  return d.slug;
}
