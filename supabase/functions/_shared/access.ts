/**
 * Per-workspace access control (issue #60). The org is the TENANT (directory);
 * each KB carries its own scope: `visibility` (`org` = org members access it with
 * their org role; `private` = explicit grants only) + individual grants
 * (`mem_workspace_grants`), externals included.
 *
 * Effective role = max(explicit grant, org role if visibility=org).
 * Granularity = whole workspace — no per-section/document ACL.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, orgs, memberships, workspaces, workspaceGrants, sections, documents, blocks, ingestions, links, comments } from "./db.ts";

const ROLE_RANK: Record<string, number> = { member: 1, curator: 2, admin: 3 };
const WRITE_RANK = ROLE_RANK.curator;
import { splitPath } from "./paths.ts";

export class AccessError extends Error {}

/** Indistinct message: "not found" and "forbidden" give the SAME response, so as
 *  not to turn the error into a cross-tenant existence oracle (KB slugs are unique
 *  and guessable). */
const NOT_FOUND_OR_FORBIDDEN = "resource not found or access denied";

/**
 * Safe error message to return to the client. Masks Postgres driver errors
 * (SQLSTATE/severity) that would reveal the schema; lets intentional application
 * errors through (validation, "not found").
 */
export function safeErrorMessage(e: unknown): string {
  const anyE = e as { code?: unknown; severity?: unknown };
  const looksLikeDbError =
    (typeof anyE?.code === "string" && /^[0-9A-Z]{5}$/.test(anyE.code)) ||
    typeof anyE?.severity === "string";
  if (looksLikeDbError) return "internal error";
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
 * Effective role of the user on a workspace — null = no access.
 *
 * `public` scope: read (`member`) is granted to EVERYONE, including the anonymous
 * user (`sub === ""`). The owning org nonetheless keeps its org role (it can curate
 * ITS public base); grants always elevate. So a public KB = `org` + worldwide read,
 * never a downgrade of the org.
 */
export async function effectiveRole(sub: string, wsId: string): Promise<string | null> {
  const [ws] = await db.select({ orgId: workspaces.orgId, visibility: workspaces.visibility })
    .from(workspaces).where(eq(workspaces.id, wsId)).limit(1);
  if (!ws) return null;
  // The anonymous user has neither grant nor membership: only the public scope opens read for them.
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
    best = "member"; // worldwide read (floor), never above an already-acquired role
  }
  return best;
}

/**
 * Ids of accessible workspaces: (`org`/`public` KBs of one's orgs) ∪ (granted KBs).
 * Public KBs of OTHER orgs do NOT appear here (otherwise the "my bases" list would
 * balloon with all the public ones) — they are discovered via the gallery / public
 * search, or by explicitly pinning them (cf. getDefaultWorkspace).
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

/** Refs {id, slug, org} of public KBs (not archived) — gallery + public search. */
export async function publicWorkspaceRefs(): Promise<{ id: string; slug: string; org: string | null }[]> {
  const rows = await db
    .select({ id: workspaces.id, slug: workspaces.slug, org: orgs.slug })
    .from(workspaces)
    .leftJoin(orgs, eq(workspaces.orgId, orgs.id))
    .where(and(eq(workspaces.visibility, "public"), isNull(workspaces.archivedAt)));
  return [...rows];
}

/** Resolves the targeted workspace id from any verb entry point. */
type Kind = "section" | "document" | "block" | "ingestion" | "link" | "comment";

export async function resolveWorkspaceId(ref: {
  workspace?: string;
  path?: string;
  id?: string; // section/document/block/ingestion/link/comment depending on the verb
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
    // document/block → walks up to the section then to the workspace
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

/** Throws AccessError if the user has no access to the targeted workspace (write ⇒ admin/curator role). */
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
      throw new AccessError("writing restricted to admin/curator roles");
    }
    // Archiving freezes writes: an archived KB is read-only until reactivation
    // (otherwise archiving would revoke nothing via direct access).
    const [ws] = await db.select({ archivedAt: workspaces.archivedAt })
      .from(workspaces).where(eq(workspaces.id, wsId)).limit(1);
    if (ws?.archivedAt) throw new AccessError("archived KB: writing impossible (reactivate it first)");
  }
}

/**
 * Throws AccessError if the user is not an ADMIN OF THE ORG owning the KB.
 * Governance (sharing, visibility, archiving, transfer) is a tenant act — a per-base
 * grant never delegates it (decision 2026-06-12: grants = member|curator,
 * read/write only).
 */
export async function assertWorkspaceAdmin(sub: string, slug: string): Promise<void> {
  const [w] = await db.select({ orgId: workspaces.orgId }).from(workspaces)
    .where(eq(workspaces.slug, slug)).limit(1);
  if (!w) throw new AccessError(NOT_FOUND_OR_FORBIDDEN);
  if (!w.orgId) throw new AccessError("KB without owning org");
  const [m] = await db.select({ role: memberships.role }).from(memberships)
    .where(and(eq(memberships.orgId, w.orgId), eq(memberships.userId, sub))).limit(1);
  if (m?.role !== "admin") throw new AccessError("admins of the owning org only");
}

/** Workspace id of a document/block (to log a revision). */
export async function workspaceIdForTarget(
  kind: "document" | "block",
  id: string,
): Promise<string | null> {
  return resolveWorkspaceId({ id, kind });
}
