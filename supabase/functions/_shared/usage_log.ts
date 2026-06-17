/**
 * Log d'usage — télémétrie produit : les agents y notent les problèmes rencontrés
 * avec l'outil Memento lui-même (erreur, résultat surprenant, capacité manquante,
 * friction, doc trompeuse). PAS du savoir KB : pas de FK workspace (texte libre),
 * pas de MemRevision, écriture ouverte à tout user authentifié — le signalement
 * doit toujours passer, même quand le contexte est cassé.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db, usageLogs } from "./db.ts";
import { assertAccess } from "./access.ts";

export const USAGE_KINDS = ["bug", "unexpected", "missing", "friction", "docs", "other"] as const;

export async function logUsage(
  args: {
    kind: string;
    summary: string;
    detail?: string;
    verb?: string;
    workspace?: string;
  },
  sub: string,
) {
  const [row] = await db.insert(usageLogs).values({
    userId: sub,
    workspaceSlug: args.workspace ?? null,
    verb: args.verb ?? null,
    kind: args.kind,
    summary: args.summary,
    detail: args.detail ?? null,
  }).returning({ id: usageLogs.id, createdAt: usageLogs.createdAt });
  return { logged: true, id: row.id, createdAt: row.createdAt, message: "Merci — signalement enregistré." };
}

/** Sans `workspace` : mes propres signalements. Avec `workspace` : tous les
 *  signalements de cette KB — réservé admin/curator (write) de l'org. */
export async function listUsageLogs(
  args: { workspace?: string; verb?: string; kind?: string; limit?: number },
  sub: string,
) {
  const conds = [];
  if (args.workspace) {
    await assertAccess(sub, { workspace: args.workspace }, { write: true });
    conds.push(eq(usageLogs.workspaceSlug, args.workspace));
  } else {
    conds.push(eq(usageLogs.userId, sub));
  }
  if (args.verb) conds.push(eq(usageLogs.verb, args.verb));
  if (args.kind) conds.push(eq(usageLogs.kind, args.kind));

  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const [{ n: total }] = await db.select({ n: sql<number>`count(*)::int` })
    .from(usageLogs).where(and(...conds));
  const rows = await db.select({
    id: usageLogs.id,
    userId: usageLogs.userId,
    workspace: usageLogs.workspaceSlug,
    verb: usageLogs.verb,
    kind: usageLogs.kind,
    summary: usageLogs.summary,
    detail: usageLogs.detail,
    createdAt: usageLogs.createdAt,
  }).from(usageLogs).where(and(...conds)).orderBy(desc(usageLogs.createdAt)).limit(limit);

  return { count: rows.length, total: Number(total), hasMore: Number(total) > rows.length, logs: rows };
}
