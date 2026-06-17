/**
 * Contexte org/KB pour l'agent MCP. L'org = TENANT (annuaire de membres) ;
 * chaque KB porte son périmètre (visibility + grants, issue #60). Tout est
 * pensé pour qu'un agent ne se trompe pas de cible : topologie en un appel
 * (`contextMap`), écho {workspace, org} sur les verbes à contexte (`wsContext`),
 * erreurs qui listent les options.
 */
import { eq, inArray, isNull, and, or, sql } from "drizzle-orm";
import { db, orgs, memberships, workspaces, workspaceGrants } from "./db.ts";
import { getDefaultWorkspace, effectiveWorkspace, listPins, pinnedWorkspaceIds } from "./prefs.ts";
import { ensureDefaultWorkspace } from "./admin.ts";
import { AccessError } from "./access.ts";

// myRole = accès au CONTENU (null = aucun : ex. private de mon org que je peux
// gérer en tant qu'org-admin sans pouvoir la lire).
type WsEntry = { slug: string; name: string; summary: string; visibility: string; myRole: string | null };
export type ContextMap = {
  default: string | null;
  orgs: { org: string; name: string; myRole: string; personal: boolean; workspaces: WsEntry[] }[];
  /** KB grantées dans des orgs dont le caller n'est PAS membre (« partagées avec moi »). */
  shared: (WsEntry & { org: string })[];
  /** KB épinglées par le user (typiquement publiques d'autres orgs), hors orgs/shared. */
  pinned: (WsEntry & { org: string })[];
};

const RANK: Record<string, number> = { member: 1, curator: 2, admin: 3 };

/** Topologie complète du caller : orgs (rôle) → KB visibles (+ rôle effectif par KB), KB partagées, défaut. */
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

  // KB visibles : `org` de ses orgs ∪ grantées ∪ (existence des private de ses
  // orgs-admin — gouvernance sans lecture), non archivées.
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

  // Épinglées = pins du user MOINS celles déjà visibles via orgs/shared (dédup par slug).
  // Ce sont typiquement des KB publiques d'autres orgs : lecture (member), pas de rôle d'org.
  const knownSlugs = new Set([...orgsOut.flatMap((o) => o.workspaces.map((w) => w.slug)), ...sharedOut.map((w) => w.slug)]);
  const pinnedOut = pins
    .filter((p) => !knownSlugs.has(p.slug))
    .map((p) => ({ slug: p.slug, name: p.name, summary: p.summary, visibility: "public", myRole: "member", org: p.org ?? "?" }));

  return { default: def?.slug ?? null, orgs: orgsOut, shared: sharedOut, pinned: pinnedOut };
}

/** Résumé compact « org → kb1, kb2 · org2 → kb3 » pour les messages d'erreur. */
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
    parts.push(`partagées → ${map.shared.slice(0, max - n).map((w) => w.slug).join(", ")}`);
  }
  return parts.join(" · ") || "(aucune)";
}

/**
 * KB effective (explicite > défaut) + son org propriétaire. À utiliser par tout
 * verbe à `workspace` optionnel : la réponse écho {workspace, org} pour que
 * l'agent voie — et annonce — où il agit. Slug inconnu → erreur qui liste les options.
 */
export async function wsContext(sub: string, explicit?: string): Promise<{ workspace: string; org: string }> {
  let slug: string;
  try {
    slug = await effectiveWorkspace(sub, explicit);
  } catch {
    const map = await contextMap(sub);
    throw new Error(
      `aucune KB précisée ni par défaut. KB accessibles : ${describeMap(map)}. ` +
        "Fixe mem_use_workspace({workspace}) ou passe `workspace`.",
    );
  }
  const [row] = await db
    .select({ org: orgs.slug })
    .from(workspaces)
    .innerJoin(orgs, eq(workspaces.orgId, orgs.id))
    .where(eq(workspaces.slug, slug))
    .limit(1);
  if (!row) {
    // Slug inconnu : réponse indistincte d'un « accès refusé » (cf. assertAccess)
    // pour ne pas confirmer l'existence d'une KB d'un autre tenant. On n'écho NI
    // le slug NI la liste des KB ici (l'agent dispose de mem_workspaces).
    throw new AccessError("ressource introuvable ou accès refusé");
  }
  return { workspace: slug, org: row.org };
}

/** Réfs {id, slug, org} des KB accessibles (org-visibles ∪ grantées) — sert la recherche globale. */
export async function accessibleWorkspaceRefs(sub: string): Promise<{ id: string; slug: string; org: string }[]> {
  const [mine, myGrants] = await Promise.all([
    db.select({ orgId: memberships.orgId }).from(memberships).where(eq(memberships.userId, sub)),
    db.select({ wsId: workspaceGrants.workspaceId }).from(workspaceGrants)
      .where(eq(workspaceGrants.userId, sub)),
  ]);
  const pinIds = await pinnedWorkspaceIds(sub); // les épinglées font partie de l'univers cherchable
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
  // Dédup (une KB peut matcher plusieurs conditions) par id.
  return [...new Map(rows.map((r) => [r.id, r])).values()];
}
