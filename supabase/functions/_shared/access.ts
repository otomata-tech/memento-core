/**
 * Contrôle d'accès par workspace (issue #60). L'org est le TENANT (annuaire) ;
 * chaque KB porte son périmètre : `visibility` (`org` = les membres de l'org y
 * accèdent avec leur rôle d'org ; `private` = grants explicites seuls) + grants
 * individuels (`mem_workspace_grants`), externes compris.
 *
 * Rôle effectif = max(grant explicite, rôle d'org si visibility=org).
 * Granularité = workspace entier — pas d'ACL par section/document.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, orgs, memberships, workspaces, workspaceGrants, sections, documents, blocks, ingestions, links, comments } from "./db.ts";

const ROLE_RANK: Record<string, number> = { member: 1, curator: 2, admin: 3 };
const WRITE_RANK = ROLE_RANK.curator;
import { splitPath } from "./paths.ts";

export class AccessError extends Error {}

/** Message indistinct : « introuvable » et « interdit » donnent la MÊME réponse,
 *  pour ne pas faire de l'erreur un oracle d'existence cross-tenant (les slugs de
 *  KB sont uniques et devinables). */
const NOT_FOUND_OR_FORBIDDEN = "ressource introuvable ou accès refusé";

/**
 * Message d'erreur sûr à renvoyer au client. Masque les erreurs du driver
 * Postgres (SQLSTATE/severity) qui révéleraient le schéma ; laisse passer les
 * erreurs applicatives intentionnelles (validation, « introuvable »).
 */
export function safeErrorMessage(e: unknown): string {
  const anyE = e as { code?: unknown; severity?: unknown };
  const looksLikeDbError =
    (typeof anyE?.code === "string" && /^[0-9A-Z]{5}$/.test(anyE.code)) ||
    typeof anyE?.severity === "string";
  if (looksLikeDbError) return "erreur interne";
  return e instanceof Error ? e.message : String(e);
}

export async function userOrgIds(sub: string): Promise<string[]> {
  const rows = await db
    .select({ orgId: memberships.orgId })
    .from(memberships)
    .where(eq(memberships.userId, sub));
  return rows.map((r) => r.orgId);
}

/**
 * Rôle effectif du user sur un workspace — null = aucun accès.
 *
 * Périmètre `public` : la lecture (`member`) est accordée à TOUT le monde, y
 * compris l'anonyme (`sub === ""`). L'org propriétaire garde néanmoins son rôle
 * d'org (elle peut curer SA base publique) ; les grants élèvent toujours. Donc
 * une KB publique = `org` + lecture mondiale, jamais une rétrogradation de l'org.
 */
export async function effectiveRole(sub: string, wsId: string): Promise<string | null> {
  const [ws] = await db.select({ orgId: workspaces.orgId, visibility: workspaces.visibility })
    .from(workspaces).where(eq(workspaces.id, wsId)).limit(1);
  if (!ws) return null;
  // L'anonyme n'a ni grant ni membership : seul le périmètre public lui ouvre la lecture.
  const [g] = sub
    ? await db.select({ role: workspaceGrants.role }).from(workspaceGrants)
        .where(and(eq(workspaceGrants.workspaceId, wsId), eq(workspaceGrants.userId, sub))).limit(1)
    : [];
  let best: string | null = g?.role ?? null;
  if ((ws.visibility === "org" || ws.visibility === "public") && ws.orgId && sub) {
    const [m] = await db.select({ role: memberships.role }).from(memberships)
      .where(and(eq(memberships.orgId, ws.orgId), eq(memberships.userId, sub))).limit(1);
    if (m && (!best || (ROLE_RANK[m.role] ?? 0) > (ROLE_RANK[best] ?? 0))) best = m.role;
  }
  if (ws.visibility === "public" && (!best || (ROLE_RANK.member > (ROLE_RANK[best] ?? 0)))) {
    best = "member"; // lecture mondiale (plancher), jamais au-dessus d'un rôle déjà acquis
  }
  return best;
}

/**
 * Ids des workspaces accessibles : (KB `org`/`public` de ses orgs) ∪ (KB grantées).
 * Les KB publiques d'AUTRES orgs n'y figurent PAS (sinon la liste « mes bases »
 * gonflerait de tout le public) — on les découvre par la galerie / recherche
 * publique, ou en les épinglant explicitement (cf. getDefaultWorkspace).
 */
export async function accessibleWorkspaceIds(sub: string): Promise<string[]> {
  if (!sub) return [];
  const orgIds = await userOrgIds(sub);
  const viaOrg = orgIds.length
    ? await db.select({ id: workspaces.id }).from(workspaces)
        .where(and(inArray(workspaces.orgId, orgIds), inArray(workspaces.visibility, ["org", "public"])))
    : [];
  const viaGrant = await db.select({ id: workspaceGrants.workspaceId }).from(workspaceGrants)
    .where(eq(workspaceGrants.userId, sub));
  return [...new Set([...viaOrg.map((r) => r.id), ...viaGrant.map((r) => r.id)])];
}

/** Réfs {id, slug, org} des KB publiques (non archivées) — galerie + recherche publique. */
export async function publicWorkspaceRefs(): Promise<{ id: string; slug: string; org: string | null }[]> {
  const rows = await db
    .select({ id: workspaces.id, slug: workspaces.slug, org: orgs.slug })
    .from(workspaces)
    .leftJoin(orgs, eq(workspaces.orgId, orgs.id))
    .where(and(eq(workspaces.visibility, "public"), isNull(workspaces.archivedAt)));
  return [...rows];
}

/** Résout l'id du workspace ciblé depuis n'importe quel point d'entrée des verbes. */
type Kind = "section" | "document" | "block" | "ingestion" | "link" | "comment";

export async function resolveWorkspaceId(ref: {
  workspace?: string;
  path?: string;
  id?: string; // section/document/block/ingestion/link/comment selon le verbe
  kind?: Kind;
}): Promise<string | null> {
  if (ref.workspace) {
    const [w] = await db.select({ id: workspaces.id }).from(workspaces)
      .where(eq(workspaces.slug, ref.workspace)).limit(1);
    return w?.id ?? null;
  }
  if (ref.path) {
    const slug = splitPath(ref.path)[0];
    const [w] = await db.select({ id: workspaces.id }).from(workspaces)
      .where(eq(workspaces.slug, slug)).limit(1);
    return w?.id ?? null;
  }
  if (ref.id && ref.kind) {
    if (ref.kind === "section") {
      const [s] = await db.select({ ws: sections.workspaceId }).from(sections)
        .where(eq(sections.id, ref.id)).limit(1);
      return s?.ws ?? null;
    }
    if (ref.kind === "ingestion") {
      const [i] = await db.select({ ws: ingestions.workspaceId }).from(ingestions)
        .where(eq(ingestions.id, ref.id)).limit(1);
      return i?.ws ?? null;
    }
    if (ref.kind === "link") {
      const [l] = await db.select({ from: links.fromBlockId }).from(links)
        .where(eq(links.id, ref.id)).limit(1);
      return l ? resolveWorkspaceId({ id: l.from, kind: "block" }) : null;
    }
    if (ref.kind === "comment") {
      const [c] = await db.select({ t: comments.targetType, tid: comments.targetId }).from(comments)
        .where(eq(comments.id, ref.id)).limit(1);
      return c ? resolveWorkspaceId({ id: c.tid, kind: c.t.toLowerCase() as Kind }) : null;
    }
    // document/block → remonte jusqu'à la section puis au workspace
    let sectionId: string | undefined;
    if (ref.kind === "document") {
      const [d] = await db.select({ sec: documents.sectionId }).from(documents)
        .where(eq(documents.id, ref.id)).limit(1);
      sectionId = d?.sec;
    } else {
      const [b] = await db.select({ doc: blocks.documentId }).from(blocks)
        .where(eq(blocks.id, ref.id)).limit(1);
      if (b) {
        const [d] = await db.select({ sec: documents.sectionId }).from(documents)
          .where(eq(documents.id, b.doc)).limit(1);
        sectionId = d?.sec;
      }
    }
    if (!sectionId) return null;
    const [s] = await db.select({ ws: sections.workspaceId }).from(sections)
      .where(eq(sections.id, sectionId)).limit(1);
    return s?.ws ?? null;
  }
  return null;
}

/** Lève AccessError si le user n'a pas accès au workspace ciblé (write ⇒ rôle admin/curator). */
export async function assertAccess(
  sub: string,
  ref: { workspace?: string; path?: string; id?: string; kind?: Kind },
  opts?: { write?: boolean },
): Promise<void> {
  const wsId = await resolveWorkspaceId(ref);
  if (!wsId) throw new AccessError(NOT_FOUND_OR_FORBIDDEN);
  const role = await effectiveRole(sub, wsId);
  if (!role) throw new AccessError(NOT_FOUND_OR_FORBIDDEN);
  if (opts?.write) {
    if ((ROLE_RANK[role] ?? 0) < WRITE_RANK) {
      throw new AccessError("écriture réservée aux rôles admin/curator");
    }
    // L'archivage gèle l'écriture : une KB archivée est en lecture seule jusqu'à
    // réactivation (sinon l'archivage ne révoquerait rien par accès direct).
    const [ws] = await db.select({ archivedAt: workspaces.archivedAt })
      .from(workspaces).where(eq(workspaces.id, wsId)).limit(1);
    if (ws?.archivedAt) throw new AccessError("KB archivée : écriture impossible (réactive-la d'abord)");
  }
}

/**
 * Lève AccessError si le user n'est pas ADMIN DE L'ORG propriétaire de la KB.
 * La gouvernance (partage, visibilité, archivage, transfert) est un acte de
 * tenant — un grant par base ne la délègue jamais (décision 2026-06-12 :
 * grants = member|curator, lecture/écriture seulement).
 */
export async function assertWorkspaceAdmin(sub: string, slug: string): Promise<void> {
  const [w] = await db.select({ orgId: workspaces.orgId }).from(workspaces)
    .where(eq(workspaces.slug, slug)).limit(1);
  if (!w) throw new AccessError(NOT_FOUND_OR_FORBIDDEN);
  if (!w.orgId) throw new AccessError("KB sans org propriétaire");
  const [m] = await db.select({ role: memberships.role }).from(memberships)
    .where(and(eq(memberships.orgId, w.orgId), eq(memberships.userId, sub))).limit(1);
  if (m?.role !== "admin") throw new AccessError("réservé aux admins de l'org propriétaire");
}

/** Id du workspace d'un document/bloc (pour journaliser une révision). */
export async function workspaceIdForTarget(
  kind: "document" | "block",
  id: string,
): Promise<string | null> {
  return resolveWorkspaceId({ id, kind });
}
