/**
 * Lecture du journal de révisions (Lot 2). Chaque mutation curée a écrit une
 * `MemRevision` (op + motif + acteur + avant/après). Ici on l'expose en lecture,
 * filtrable par cible, du plus récent au plus ancien. Cf. spec §5.2.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, revisions, workspaces } from "./db.ts";

export async function listRevisions(args: {
  workspace: string;
  targetType?: string;
  targetId?: string;
  since?: string;
  limit?: number;
}) {
  const [ws] = await db.select({ id: workspaces.id }).from(workspaces)
    .where(eq(workspaces.slug, args.workspace)).limit(1);
  if (!ws) throw new Error(`Workspace introuvable: ${args.workspace}`);

  const conds = [eq(revisions.workspaceId, ws.id)];
  if (args.targetType) conds.push(eq(revisions.targetType, args.targetType));
  if (args.targetId) conds.push(eq(revisions.targetId, args.targetId));
  if (args.since) {
    const since = new Date(args.since);
    if (isNaN(since.getTime())) throw new Error(`\`since\` invalide: "${args.since}" (attendu ISO 8601)`);
    conds.push(gte(revisions.createdAt, since));
  }

  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  // total honnête : nombre de révisions correspondantes, pas le nombre retourné.
  const [{ n: total }] = await db.select({ n: sql<number>`count(*)::int` })
    .from(revisions).where(and(...conds));
  const rows = await db.select({
    id: revisions.id,
    targetType: revisions.targetType,
    targetId: revisions.targetId,
    op: revisions.op,
    reason: revisions.reason,
    actor: revisions.actor,
    actorKind: revisions.actorKind,
    before: revisions.before,
    after: revisions.after,
    ingestionId: revisions.ingestionId,
    createdAt: revisions.createdAt,
  }).from(revisions).where(and(...conds)).orderBy(desc(revisions.createdAt)).limit(limit);

  return {
    workspace: args.workspace,
    count: rows.length,
    total: Number(total),
    hasMore: Number(total) > rows.length,
    revisions: rows,
  };
}
