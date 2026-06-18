/**
 * Per-KB grants (issue #60): explicit access of a user to ONE base — elevate a
 * member (curator on this KB), restrict via `visibility=private`, or invite an
 * external (guest) without entering them into the org.
 *
 * A grant gives READ (member) or WRITE (curator) — never governance (decision
 * 2026-06-12): sharing/visibility/transfer remain with the admins of the owning
 * org (assertWorkspaceAdmin). Guest invitation: same invitation flow as org
 * members (GoTrue provisioning + Resend email), only the landing changes (grant
 * instead of membership).
 */
import { and, eq } from "drizzle-orm";
import { db, workspaces, workspaceGrants, orgs, memberships } from "./db.ts";
import { assertWorkspaceAdmin, effectiveRole } from "./access.ts";
import { ensureAccount, emailsForSubs } from "./admin.ts";
import { assertWithinLimit } from "./ratelimit.ts";

const ROLES = ["curator", "member"];

async function wsBySlug(slug: string) {
  const [w] = await db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
  if (!w) throw new Error(`workspace not found: ${slug}`);
  return w;
}

/**
 * The full "who has access" of a KB: visibility, explicit grants, and access
 * INHERITED from the org (members + org role) when visibility=org — without which the
 * grants list alone is misleading. For the Share panel and mem_grants.
 */
export async function listGrants(sub: string, args: { workspace: string }) {
  await assertWorkspaceAdmin(sub, args.workspace);
  const w = await wsBySlug(args.workspace);
  const rows = await db.select().from(workspaceGrants)
    .where(eq(workspaceGrants.workspaceId, w.id));
  const orgMembers = w.orgId
    ? await db.select({ userId: memberships.userId, role: memberships.role }).from(memberships)
        .where(eq(memberships.orgId, w.orgId))
    : [];
  const emails = await emailsForSubs([
    ...new Set([...rows.map((g) => g.userId), ...orgMembers.map((m) => m.userId)]),
  ]);
  const [org] = w.orgId
    ? await db.select({ slug: orgs.slug, name: orgs.name }).from(orgs).where(eq(orgs.id, w.orgId)).limit(1)
    : [];
  const present = (userId: string, role: string) => {
    const u = emails.get(userId);
    return { userId, email: u?.email ?? null, role, pending: u?.pending ?? false };
  };
  return {
    workspace: w.slug,
    org: org?.slug ?? null,
    orgName: org?.name ?? null,
    visibility: w.visibility,
    grants: rows.map((g) => present(g.userId, g.role))
      .sort((a, b) => (a.email ?? a.userId).localeCompare(b.email ?? b.userId)),
    // Inherited: members of the owning org — effective access if org OR public
    // (otherwise, private: empty informative list).
    inherited: w.visibility === "org" || w.visibility === "public"
      ? orgMembers.map((m) => present(m.userId, m.role))
          .sort((a, b) => (a.email ?? a.userId).localeCompare(b.email ?? b.userId))
      : [],
  };
}

/**
 * Grants (or updates) a user's access to ONE KB, by email. Nonexistent account →
 * provisioned + invitation email (GoTrue flow shared with the orgs).
 */
export async function grantAccess(
  sub: string,
  args: { workspace: string; email: string; role?: string },
) {
  await assertWorkspaceAdmin(sub, args.workspace);
  await assertWithinLimit(sub, "invite"); // a grant may provision + send an email
  const w = await wsBySlug(args.workspace);
  const role = ROLES.includes(args.role ?? "") ? args.role! : "member";
  const account = await ensureAccount(args.email.trim(), {
    scope: "workspace", targetName: w.name, role, inviterSub: sub,
  });

  await db.insert(workspaceGrants)
    .values({ workspaceId: w.id, userId: account.sub, role, createdBy: sub })
    .onConflictDoUpdate({
      target: [workspaceGrants.workspaceId, workspaceGrants.userId],
      set: { role },
    });
  return {
    workspace: w.slug, email: args.email.trim(), role,
    provisioned: account.provisioned, emailSent: account.emailSent, inviteLink: account.inviteLink,
  };
}

/** Removes an explicit access. (Governance stays with the org-admin: no lockout possible.) */
export async function revokeGrant(sub: string, args: { workspace: string; userId: string }) {
  await assertWorkspaceAdmin(sub, args.workspace);
  const w = await wsBySlug(args.workspace);
  await db.delete(workspaceGrants)
    .where(and(eq(workspaceGrants.workspaceId, w.id), eq(workspaceGrants.userId, args.userId)));
  return { workspace: w.slug, removed: args.userId };
}

/**
 * Changes a KB's scope. Switch to `private`: sets a curator grant for the caller
 * (their org role no longer grants read — governance, however, stays with them via
 * the org). Switch to `org`/`public`: the grants remain (elevations kept). `public` =
 * worldwide read (anonymous included) + gallery + public search; the owning org keeps
 * its role (it curates its public base).
 */
export async function setVisibility(
  sub: string,
  args: { workspace: string; visibility: "org" | "private" | "public" },
) {
  await assertWorkspaceAdmin(sub, args.workspace);
  const w = await wsBySlug(args.workspace);
  if (w.visibility === args.visibility) return { workspace: w.slug, visibility: w.visibility };
  if (args.visibility === "private") {
    await db.insert(workspaceGrants)
      .values({ workspaceId: w.id, userId: sub, role: "curator", createdBy: sub })
      .onConflictDoNothing();
  }
  await db.update(workspaces).set({ visibility: args.visibility }).where(eq(workspaces.id, w.id));
  return { workspace: w.slug, visibility: args.visibility };
}

export { effectiveRole };
