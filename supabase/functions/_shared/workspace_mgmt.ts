/**
 * Gestion d'une KB (workspace) : doctrine éditable, métadonnées, archivage.
 * La doctrine (préambule = méta-instructions) vit dans `mem_settings`
 * (clé `doctrine.preamble`), lue par getDoctrine. Ici on l'écrit.
 *
 * Autorisation faite en amont par les handlers (assertAccess write pour doctrine/métadonnées,
 * assertWorkspaceAdmin pour l'archivage).
 */
import { and, eq } from "drizzle-orm";
import { db, workspaces, settings, revisions } from "./db.ts";

async function wsBySlug(slug: string) {
  const [w] = await db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
  if (!w) throw new Error(`workspace introuvable: ${slug}`);
  return w;
}

async function revise(workspaceId: string, op: string, reason: string, actor: string, before: unknown, after: unknown) {
  await db.insert(revisions).values({
    workspaceId, targetType: "workspace", targetId: null, op, reason, actor,
    actorKind: "agent", before: before ?? null, after: after ?? null,
  });
}

/** Écrit le préambule de doctrine (méta-instructions, markdown) d'une KB. */
export async function setDoctrine(args: { workspace: string; preamble: string }, actor: string) {
  const w = await wsBySlug(args.workspace);
  const [prev] = await db.select({ value: settings.value }).from(settings)
    .where(and(eq(settings.workspaceId, w.id), eq(settings.key, "doctrine.preamble"))).limit(1);
  await db.insert(settings).values({ workspaceId: w.id, key: "doctrine.preamble", value: args.preamble })
    .onConflictDoUpdate({ target: [settings.workspaceId, settings.key], set: { value: args.preamble } });
  await revise(w.id, "set_doctrine", "édition de la doctrine", actor,
    { len: prev?.value?.length ?? 0 }, { len: args.preamble.length });
  return { workspace: w.slug, preambleLength: args.preamble.length };
}

/** Modifie les métadonnées d'une KB (nom et/ou résumé). Le slug reste stable. */
export async function updateWorkspace(args: { workspace: string; name?: string; summary?: string }, actor: string) {
  const w = await wsBySlug(args.workspace);
  const patch: Record<string, unknown> = {};
  if (args.name !== undefined) patch.name = args.name.trim();
  if (args.summary !== undefined) patch.summary = args.summary.trim();
  if (Object.keys(patch).length === 0) throw new Error("rien à modifier (name et/ou summary)");
  const [after] = await db.update(workspaces).set(patch).where(eq(workspaces.id, w.id)).returning();
  await revise(w.id, "update_workspace", "édition des métadonnées de la KB", actor,
    { name: w.name, summary: w.summary }, { name: after.name, summary: after.summary });
  return { workspace: after.slug, name: after.name, summary: after.summary };
}

/** Archive (masque) ou réactive une KB. Réversible. */
export async function archiveWorkspace(args: { workspace: string; archived?: boolean }, actor: string) {
  const w = await wsBySlug(args.workspace);
  const archived = args.archived !== false;
  const [after] = await db.update(workspaces)
    .set({ archivedAt: archived ? new Date() : null }).where(eq(workspaces.id, w.id)).returning();
  await revise(w.id, archived ? "archive_workspace" : "unarchive_workspace",
    archived ? "archivage de la KB" : "réactivation de la KB", actor,
    { archivedAt: w.archivedAt }, { archivedAt: after.archivedAt });
  return { workspace: after.slug, archived: !!after.archivedAt };
}
