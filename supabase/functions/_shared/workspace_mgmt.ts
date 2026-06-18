/**
 * KB (workspace) management: editable doctrine, metadata, archiving.
 * The doctrine (preamble = meta-instructions) lives in `mem_settings`
 * (key `doctrine.preamble`), read by getDoctrine. Here we write it.
 *
 * Authorization handled upstream by the handlers (assertAccess write for doctrine/metadata,
 * assertWorkspaceAdmin for archiving).
 */
import { and, eq } from "drizzle-orm";
import { db, workspaces, settings, revisions } from "./db.ts";

async function wsBySlug(slug: string) {
  const [w] = await db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
  if (!w) throw new Error(`workspace not found: ${slug}`);
  return w;
}

async function revise(workspaceId: string, op: string, reason: string, actor: string, before: unknown, after: unknown) {
  await db.insert(revisions).values({
    workspaceId, targetType: "workspace", targetId: null, op, reason, actor,
    actorKind: "agent", before: before ?? null, after: after ?? null,
  });
}

/** Writes the doctrine preamble (meta-instructions, markdown) of a KB. */
export async function setDoctrine(args: { workspace: string; preamble: string }, actor: string) {
  const w = await wsBySlug(args.workspace);
  const [prev] = await db.select({ value: settings.value }).from(settings)
    .where(and(eq(settings.workspaceId, w.id), eq(settings.key, "doctrine.preamble"))).limit(1);
  await db.insert(settings).values({ workspaceId: w.id, key: "doctrine.preamble", value: args.preamble })
    .onConflictDoUpdate({ target: [settings.workspaceId, settings.key], set: { value: args.preamble } });
  await revise(w.id, "set_doctrine", "doctrine edit", actor,
    { len: prev?.value?.length ?? 0 }, { len: args.preamble.length });
  return { workspace: w.slug, preambleLength: args.preamble.length };
}

/** Updates a KB's metadata (name and/or summary). The slug stays stable. */
export async function updateWorkspace(args: { workspace: string; name?: string; summary?: string }, actor: string) {
  const w = await wsBySlug(args.workspace);
  const patch: Record<string, unknown> = {};
  if (args.name !== undefined) patch.name = args.name.trim();
  if (args.summary !== undefined) patch.summary = args.summary.trim();
  if (Object.keys(patch).length === 0) throw new Error("nothing to update (name and/or summary)");
  const [after] = await db.update(workspaces).set(patch).where(eq(workspaces.id, w.id)).returning();
  await revise(w.id, "update_workspace", "KB metadata edit", actor,
    { name: w.name, summary: w.summary }, { name: after.name, summary: after.summary });
  return { workspace: after.slug, name: after.name, summary: after.summary };
}

/** Archives (hides) or reactivates a KB. Reversible. */
export async function archiveWorkspace(args: { workspace: string; archived?: boolean }, actor: string) {
  const w = await wsBySlug(args.workspace);
  const archived = args.archived !== false;
  const [after] = await db.update(workspaces)
    .set({ archivedAt: archived ? new Date() : null }).where(eq(workspaces.id, w.id)).returning();
  await revise(w.id, archived ? "archive_workspace" : "unarchive_workspace",
    archived ? "KB archiving" : "KB reactivation", actor,
    { archivedAt: w.archivedAt }, { archivedAt: after.archivedAt });
  return { workspace: after.slug, archived: !!after.archivedAt };
}
