/**
 * Org/KB context for the MCP agent. The org = TENANT (member directory);
 * each KB carries its own scope (visibility + grants, issue #60). Everything is
 * designed so an agent doesn't pick the wrong target: topology in a single call
 * (`contextMap`), {workspace, org} echo on context-bearing verbs (`wsContext`),
 * errors that list the options.
 */
import { eq, inArray, isNull, and, or, sql } from "drizzle-orm";
import { db, orgs, memberships, workspaces, workspaceGrants } from "./db.ts";
import { getDefaultWorkspace, effectiveWorkspace, listPins, pinnedWorkspaceIds } from "./prefs.ts";
import { ensureDefaultWorkspace } from "./admin.ts";
import { AccessError } from "./access.ts";

// myRole = access to the CONTENT (null = none: e.g. a private KB of my org that I can
// manage as an org-admin without being able to read it).
type WsEntry = { slug: string; name: string; summary: string; visibility: string; myRole: string | null };
export type ContextMap = {
  default: string | null;
  orgs: { org: string; name: string; myRole: string; personal: boolean; workspaces: WsEntry[] }[];
  /** KBs granted in orgs the caller is NOT a member of ("shared with me"). */
  shared: (WsEntry & { org: string })[];
  /** KBs pinned by the user (typically public ones from other orgs), excluding orgs/shared. */
  pinned: (WsEntry & { org: string })[];
};

const RANK: Record<string, number> = { member: 1, curator: 2, admin: 3 };

/** Full topology of the caller: orgs (role) → visible KBs (+ effective role per KB), shared KBs, default. */
export async function contextMap(sub: string): Promise<ContextMap> {
  await ensureDefaultWorkspace(sub);
  const [mine, myGrants, def, pins] = await Promise.all([
    db.select({ orgId: memberships.orgId, role: memberships.role })
      .from(memberships).where(eq(memberships.userId, sub)),
    db.select({ wsId: workspaceGrants.workspaceId, role: workspaceGrants.role })
      .from(workspaceGrants).where(eq(workspaceGrants.userId, sub)),
    getDefaultWorkspace(sub),
    listPins(sub),
  ]);
  const orgIds = mine.map((m) => m.orgId);
  const orgRole = new Map(mine.map((m) => [m.orgId, m.role]));
  const adminOrgIds = mine.filter((m) => m.role === "admin").map((m) => m.orgId);
  const grantRole = new Map(myGrants.map((g) => [g.wsId, g.role]));
  const grantedIds = [...grantRole.keys()];

  // Visible KBs: `org` ones from the caller's orgs ∪ granted ∪ (existence of the private
  // ones of the caller's admin-orgs — governance without reading), not archived.
  const conds = [];
  if (orgIds.length) conds.push(and(inArray(workspaces.orgId, orgIds), inArray(workspaces.visibility, ["org", "public"])));
  if (grantedIds.length) conds.push(inArray(workspaces.id, grantedIds));
  if (adminOrgIds.length) conds.push(inArray(workspaces.orgId, adminOrgIds));
  const wsRows = conds.length
    ? await db.select({
        id: workspaces.id, orgId: workspaces.orgId, slug: workspaces.slug,
        name: workspaces.name, summary: workspaces.summary, visibility: workspaces.visibility,
      }).from(workspaces).where(and(or(...conds), isNull(workspaces.archivedAt)))
    : [];

  const touchedOrgIds = [...new Set([...orgIds, ...wsRows.map((w) => w.orgId).filter((x): x is string => !!x)])];
  const orgRows = touchedOrgIds.length
    ? await db.select().from(orgs).where(inArray(orgs.id, touchedOrgIds))
    : [];
  const orgById = new Map(orgRows.map((o) => [o.id, o]));

  const entry = (w: typeof wsRows[number]): WsEntry => {
    const viaOrg = (w.visibility === "org" || w.visibility === "public") && w.orgId ? orgRole.get(w.orgId) ?? null : null;
    const viaGrant = grantRole.get(w.id) ?? null;
    const myRole = [viaOrg, viaGrant].filter(Boolean)
      .sort((a, b) => (RANK[b!] ?? 0) - (RANK[a!] ?? 0))[0] ?? null;
    return { slug: w.slug, name: w.name, summary: w.summary, visibility: w.visibility, myRole };
  };

  const orgsOut = orgRows
    .filter((o) => orgRole.has(o.id))
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((o) => ({
      org: o.slug,
      name: o.name,
      myRole: orgRole.get(o.id) ?? "member",
      personal: o.personalFor === sub,
      workspaces: wsRows.filter((w) => w.orgId === o.id).map(entry)
        .sort((a, b) => a.slug.localeCompare(b.slug)),
    }));
  const sharedOut = wsRows
    .filter((w) => !w.orgId || !orgRole.has(w.orgId))
    .map((w) => ({ ...entry(w), org: w.orgId ? orgById.get(w.orgId)?.slug ?? "?" : "?" }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  // Pinned = the user's pins MINUS those already visible via orgs/shared (dedup by slug).
  // These are typically public KBs from other orgs: read (member), no org role.
  const knownSlugs = new Set([...orgsOut.flatMap((o) => o.workspaces.map((w) => w.slug)), ...sharedOut.map((w) => w.slug)]);
  const pinnedOut = pins
    .filter((p) => !knownSlugs.has(p.slug))
    .map((p) => ({ slug: p.slug, name: p.name, summary: p.summary, visibility: "public", myRole: "member", org: p.org ?? "?" }));

  return { default: def?.slug ?? null, orgs: orgsOut, shared: sharedOut, pinned: pinnedOut };
}

/** Compact summary "org → kb1, kb2 · org2 → kb3" for error messages. */
export function describeMap(map: ContextMap, max = 12): string {
  const parts: string[] = [];
  let n = 0;
  for (const o of map.orgs) {
    const slugs = o.workspaces.slice(0, Math.max(0, max - n)).map((w) => w.slug);
    n += slugs.length;
    if (slugs.length) parts.push(`${o.org} → ${slugs.join(", ")}`);
    if (n >= max) { parts.push("…"); break; }
  }
  if (n < max && map.shared.length) {
    parts.push(`shared → ${map.shared.slice(0, max - n).map((w) => w.slug).join(", ")}`);
  }
  return parts.join(" · ") || "(none)";
}

/**
 * Effective KB (explicit > default) + its owning org. To be used by any verb
 * with an optional `workspace`: the response echoes {workspace, org} so the
 * agent sees — and announces — where it acts. Unknown slug → error that lists the options.
 */
export async function wsContext(sub: string, explicit?: string): Promise<{ workspace: string; org: string }> {
  let slug: string;
  try {
    slug = await effectiveWorkspace(sub, explicit);
  } catch {
    const map = await contextMap(sub);
    throw new Error(
      `no KB specified or set as default. Accessible KBs: ${describeMap(map)}. ` +
        "Set mem_use_workspace({workspace}) or pass `workspace`.",
    );
  }
  const [row] = await db
    .select({ org: orgs.slug })
    .from(workspaces)
    .innerJoin(orgs, eq(workspaces.orgId, orgs.id))
    .where(eq(workspaces.slug, slug))
    .limit(1);
  if (!row) {
    // Unknown slug: response indistinguishable from "access denied" (cf. assertAccess)
    // so we don't confirm the existence of a KB belonging to another tenant. We echo
    // NEITHER the slug NOR the KB list here (the agent has mem_workspaces).
    throw new AccessError("resource not found or access denied");
  }
  return { workspace: slug, org: row.org };
}

/** Refs {id, slug, org} of accessible KBs (org-visible ∪ granted) — serves global search. */
export async function accessibleWorkspaceRefs(sub: string): Promise<{ id: string; slug: string; org: string }[]> {
  const [mine, myGrants] = await Promise.all([
    db.select({ orgId: memberships.orgId }).from(memberships).where(eq(memberships.userId, sub)),
    db.select({ wsId: workspaceGrants.workspaceId }).from(workspaceGrants)
      .where(eq(workspaceGrants.userId, sub)),
  ]);
  const pinIds = await pinnedWorkspaceIds(sub); // pinned ones are part of the searchable universe
  const conds = [];
  if (mine.length) {
    conds.push(and(inArray(workspaces.orgId, mine.map((m) => m.orgId)), inArray(workspaces.visibility, ["org", "public"])));
  }
  if (myGrants.length) conds.push(inArray(workspaces.id, myGrants.map((g) => g.wsId)));
  if (pinIds.length) conds.push(inArray(workspaces.id, pinIds));
  if (!conds.length) return [];
  const rows = await db
    .select({ id: workspaces.id, slug: workspaces.slug, org: orgs.slug })
    .from(workspaces)
    .innerJoin(orgs, eq(workspaces.orgId, orgs.id))
    .where(and(or(...conds), isNull(workspaces.archivedAt)));
  // Dedup (a KB may match several conditions) by id.
  return [...new Map(rows.map((r) => [r.id, r])).values()];
}
