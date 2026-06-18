/**
 * User preference: default KB. The server stays stateless — this is a persisted
 * config (re-read on every request), not a session. An explicit `workspace`
 * always wins; the default is only a fallback when the argument is omitted.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, orgs, pinnedWorkspaces, userPrefs, workspaces } from "./db.ts";
import { assertAccess, effectiveRole } from "./access.ts";

/** User's default KB, or null. Ignores a preference that has become inaccessible.
 *  Access check via `effectiveRole` (not "my KBs") so a pinned public KB —
 *  owned or not — stays a valid default. */
export async function getDefaultWorkspace(sub: string): Promise<{ slug: string; name: string } | null> {
  const [p] = await db.select({ wsId: userPrefs.defaultWorkspaceId }).from(userPrefs)
    .where(eq(userPrefs.userId, sub)).limit(1);
  if (!p?.wsId) return null;
  if (!(await effectiveRole(sub, p.wsId))) return null; // access lost → forget the default
  const [w] = await db.select({ slug: workspaces.slug, name: workspaces.name }).from(workspaces)
    .where(eq(workspaces.id, p.wsId)).limit(1);
  return w ?? null;
}

/** Sets the default KB (must be accessible to the user). */
export async function setDefaultWorkspace(sub: string, slug: string): Promise<{ slug: string; name: string }> {
  await assertAccess(sub, { workspace: slug });
  const [w] = await db.select({ id: workspaces.id, slug: workspaces.slug, name: workspaces.name })
    .from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
  if (!w) throw new Error(`workspace not found: ${slug}`);
  await db.insert(userPrefs).values({ userId: sub, defaultWorkspaceId: w.id })
    .onConflictDoUpdate({ target: userPrefs.userId, set: { defaultWorkspaceId: w.id } });
  return { slug: w.slug, name: w.name };
}

/** User's pinned KBs (typically public ones from other orgs), not archived, access verified.
 *  Distinct from the default: this is a COLLECTION (multi), surfaced in contextMap.pinned and
 *  covered by global search. */
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
  // Access filter: a KB that has become private/unreadable silently disappears from the universe.
  const checked = await Promise.all(rows.map(async (r) => ((await effectiveRole(sub, r.id)) ? r : null)));
  return checked.filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Ids of accessible pinned KBs — feeds the union of global search. */
export async function pinnedWorkspaceIds(sub: string): Promise<string[]> {
  return (await listPins(sub)).map((r) => r.id);
}

/** Pins a KB (must be readable — public KBs are readable by everyone). Idempotent. */
export async function pinWorkspace(sub: string, slug: string): Promise<{ slug: string; name: string }> {
  await assertAccess(sub, { workspace: slug });
  const [w] = await db.select({ id: workspaces.id, slug: workspaces.slug, name: workspaces.name })
    .from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
  if (!w) throw new Error(`workspace not found: ${slug}`);
  await db.insert(pinnedWorkspaces).values({ userId: sub, workspaceId: w.id }).onConflictDoNothing();
  return { slug: w.slug, name: w.name };
}

/** Removes a KB from the pinned set. */
export async function unpinWorkspace(sub: string, slug: string): Promise<{ slug: string }> {
  const [w] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
  if (w) await db.delete(pinnedWorkspaces).where(and(eq(pinnedWorkspaces.userId, sub), eq(pinnedWorkspaces.workspaceId, w.id)));
  return { slug };
}

/** Slug of the KB to use: the explicit one, otherwise the default, otherwise an explicit error. */
export async function effectiveWorkspace(sub: string, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const d = await getDefaultWorkspace(sub);
  if (!d) throw new Error("no KB specified and no default — call mem_use_workspace({workspace}) or pass `workspace`");
  return d.slug;
}
