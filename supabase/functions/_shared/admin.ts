/**
 * Access administration (admin UI) — managing an org's members.
 * Admins only, for the targeted org. In-function mirror of the CLI `server/src/admin.ts`.
 *
 * email↔sub resolution via `auth.users` (same DATABASE_URL connection as the CLI).
 * Org creation / workspace assignment stay in the CLI (privileged, rare ops).
 */
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, orgs, memberships, workspaces, workspaceGrants, documents, sections } from "./db.ts";
import { AccessError, accessibleWorkspaceIds } from "./access.ts";
import { slugify } from "./write.ts";
import { assertWithinLimit } from "./ratelimit.ts";
import { emailConfigured, sendEmail } from "./email/resend.ts";
import { invitationEmail } from "./email/templates.ts";

const ROLES = ["admin", "curator", "member"];

async function emailsFor(subs: string[]): Promise<Map<string, { email: string; pending: boolean }>> {
  if (!subs.length) return new Map();
  const list = sql.join(subs.map((s) => sql`${s}`), sql`, `);
  const rows = await db.execute<{ id: string; email: string; signed: boolean }>(
    sql`select id::text as id, email, (last_sign_in_at is not null) as signed
        from auth.users where id::text in (${list})`,
  );
  // pending = provisioned account (invitation) that has never signed in.
  return new Map([...rows].map((r) => [r.id, { email: r.email, pending: !r.signed }]));
}

async function subForEmail(email: string): Promise<string> {
  const rows = await db.execute<{ id: string }>(
    sql`select id::text as id from auth.users where email = ${email} limit 1`,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`No Supabase account for "${email}" (the user must have signed in at least once)`);
  return id;
}

async function orgBySlug(slug: string) {
  const [o] = await db.select().from(orgs).where(eq(orgs.slug, slug)).limit(1);
  if (!o) throw new Error(`org not found: ${slug}`);
  return o;
}

async function roleOf(sub: string, orgId: string): Promise<string | null> {
  const [m] = await db.select({ role: memberships.role }).from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, sub))).limit(1);
  return m?.role ?? null;
}

async function assertOrgAdmin(sub: string, orgId: string): Promise<void> {
  if ((await roleOf(sub, orgId)) !== "admin") throw new AccessError("org admins only");
}

/** email→sub resolution for the other services (grants). */
export const emailsForSubs = emailsFor;

/**
 * User's personal org ("Alexis's Workspace", issue #60) — auto-provisioned on
 * first topological access, idempotent (`mem_orgs.personal_for` unique).
 * Any account (guests included) can therefore create their own KBs there.
 */
export async function ensurePersonalOrg(sub: string): Promise<void> {
  const [existing] = await db.select({ id: orgs.id }).from(orgs)
    .where(eq(orgs.personalFor, sub)).limit(1);
  if (existing) return;
  const emails = await emailsFor([sub]);
  const local = (emails.get(sub)?.email ?? "perso").split("@")[0];
  let slug = slugify(`perso-${local}`);
  const taken = new Set((await db.select({ slug: orgs.slug }).from(orgs)).map((o) => o.slug));
  if (taken.has(slug)) { let n = 2; while (taken.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}`; }
  try {
    const [o] = await db.insert(orgs)
      .values({ slug, name: `Personal (${local})`, personalFor: sub }).returning();
    await db.insert(memberships).values({ orgId: o.id, userId: sub, role: "admin" })
      .onConflictDoNothing();
  } catch {
    // race lost on unique(personal_for): the other request created the org — nothing to do.
  }
}

/**
 * Onboarding: guarantees a personal org AND ≥ 1 accessible KB. A signed-in account
 * must NEVER be left without a KB (otherwise a dead end on the home screen). If no KB
 * is accessible to them (neither `org`/`public` of one of their orgs, nor granted), creates
 * a default private KB in their personal org (+ curator grant: `private` ⇒ the org role does
 * NOT grant read access to the content, see effectiveRole). Idempotent; anonymous = no-op.
 */
export async function ensureDefaultWorkspace(sub: string): Promise<void> {
  if (!sub) return;
  await ensurePersonalOrg(sub);
  if ((await accessibleWorkspaceIds(sub)).length) return;
  const [perso] = await db.select({ id: orgs.id }).from(orgs)
    .where(eq(orgs.personalFor, sub)).limit(1);
  if (!perso) return; // ensurePersonalOrg just ensured it — defensive.
  const emails = await emailsFor([sub]);
  const local = (emails.get(sub)?.email ?? "perso").split("@")[0];
  let slug = slugify(`${local}-base`);
  const taken = new Set((await db.select({ slug: workspaces.slug }).from(workspaces)).map((w) => w.slug));
  if (taken.has(slug)) { let n = 2; while (taken.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}`; }
  try {
    const [w] = await db.insert(workspaces)
      .values({ slug, name: "My first KB", summary: "", orgId: perso.id, visibility: "private" })
      .returning();
    await db.insert(workspaceGrants)
      .values({ workspaceId: w.id, userId: sub, role: "curator", createdBy: sub })
      .onConflictDoNothing();
  } catch {
    // race lost (two simultaneous requests): the other one created the KB — nothing to do.
  }
}

/**
 * Orgs the caller is a member of, with members (email + role) and workspaces
 * VISIBLE to them: `org` KBs, private ones granted to them, and — if they are
 * org-admin — the EXISTENCE of their org's private KBs (governance: they can
 * share/archive them, not read their content without a grant).
 * Provisions the personal org along the way (topological entry point of the UI).
 */
export async function listMyOrgs(sub: string) {
  await ensureDefaultWorkspace(sub);
  const mine = await db.select({ orgId: memberships.orgId, role: memberships.role })
    .from(memberships).where(eq(memberships.userId, sub));
  if (!mine.length) return { orgs: [] };
  const orgIds = mine.map((m) => m.orgId);
  const myRole = new Map(mine.map((m) => [m.orgId, m.role]));
  const adminOrgIds = mine.filter((m) => m.role === "admin").map((m) => m.orgId);

  const myGrants = await db.select({ wsId: workspaceGrants.workspaceId })
    .from(workspaceGrants).where(eq(workspaceGrants.userId, sub));
  const grantedIds = myGrants.map((g) => g.wsId);

  const [orgRows, allMembers, wsRows] = await Promise.all([
    db.select().from(orgs).where(inArray(orgs.id, orgIds)),
    db.select().from(memberships).where(inArray(memberships.orgId, orgIds)),
    db.select({
      id: workspaces.id, orgId: workspaces.orgId, slug: workspaces.slug,
      name: workspaces.name, visibility: workspaces.visibility,
    }).from(workspaces).where(and(
      inArray(workspaces.orgId, orgIds),
      or(
        eq(workspaces.visibility, "org"),
        grantedIds.length ? inArray(workspaces.id, grantedIds) : sql`false`,
        adminOrgIds.length ? inArray(workspaces.orgId, adminOrgIds) : sql`false`,
      ),
    )),
  ]);
  const emails = await emailsFor([...new Set(allMembers.map((m) => m.userId))]);

  return {
    orgs: orgRows.map((o) => ({
      id: o.id, slug: o.slug, name: o.name, myRole: myRole.get(o.id) ?? null,
      personal: o.personalFor === sub,
      members: allMembers.filter((m) => m.orgId === o.id)
        .map((m) => {
          const u = emails.get(m.userId);
          return { userId: m.userId, email: u?.email ?? null, role: m.role, pending: u?.pending ?? false };
        })
        .sort((a, b) => (a.email ?? a.userId).localeCompare(b.email ?? b.userId)),
      workspaces: wsRows.filter((w) => w.orgId === o.id)
        .map((w) => ({ slug: w.slug, name: w.name, visibility: w.visibility })),
    })),
  };
}

function gotrueEnv() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("invitation unavailable (service_role missing)");
  // The invitee lands on the APP (me.mento.cc), not on the MCP subdomain.
  const appUrl = Deno.env.get("MEMENTO_APP_URL");
  if (!appUrl) throw new Error("MEMENTO_APP_URL missing (invitation redirect)");
  const redirectTo = `${appUrl}/callback`;
  const headers = { "content-type": "application/json", apikey: key, Authorization: `Bearer ${key}` };
  return { url, headers, redirectTo };
}

/**
 * Provisions the account (if needed) AND returns the GoTrue action link WITHOUT sending
 * an email — Memento sends it itself via Resend (see deliverInvite). For an already
 * existing account, `type=magiclink`; otherwise `invite`.
 */
async function generateInviteLink(email: string, existing = false): Promise<{ sub: string; link: string }> {
  const { url, headers, redirectTo } = gotrueEnv();
  const res = await fetch(`${url}/auth/v1/admin/generate_link`, {
    method: "POST", headers,
    body: JSON.stringify({ type: existing ? "magiclink" : "invite", email, redirect_to: redirectTo }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("[invite] GoTrue generate_link failure:", res.status, data);
    throw new Error("link generation failed");
  }
  const link = data.action_link ?? data.properties?.action_link;
  const sub = data.user?.id ?? data.id;
  if (!link || !sub) throw new Error("unexpected generate_link response");
  return { sub, link };
}

/** Invitation metadata to enrich the email (targeted org/KB, role, inviter). */
export interface InviteMeta {
  scope: "org" | "workspace";
  targetName: string;
  role?: string;
  inviterSub?: string;
}

/**
 * Sends the invitation email via Resend for an already generated action link. If the
 * provider is not configured or fails, falls back to the link to be passed along by
 * hand (the admin copies it from the UI) — no loss of functionality.
 */
async function deliverInvite(
  email: string,
  link: string,
  meta?: InviteMeta,
): Promise<{ emailSent: boolean; inviteLink: string | null }> {
  if (!emailConfigured()) return { emailSent: false, inviteLink: link };
  let inviterEmail: string | null = null;
  if (meta?.inviterSub) {
    inviterEmail = (await emailsFor([meta.inviterSub])).get(meta.inviterSub)?.email ?? null;
  }
  try {
    const msg = invitationEmail({
      link,
      scope: meta?.scope ?? "org",
      targetName: meta?.targetName ?? "Memento",
      role: meta?.role,
      inviterEmail,
    });
    await sendEmail({ ...msg, to: email });
    return { emailSent: true, inviteLink: null };
  } catch (_e) {
    return { emailSent: false, inviteLink: link };
  }
}

/**
 * Invites a member. Existing account → role added/updated (no email). New account →
 * provisioned + invitation email sent by Memento via Resend; if the provider is
 * missing or fails, falls back to a link to be passed along by hand. Org admin required.
 */
export async function inviteMember(sub: string, args: { orgSlug: string; email: string; role: string }) {
  const org = await orgBySlug(args.orgSlug);
  await assertOrgAdmin(sub, org.id);
  await assertWithinLimit(sub, "invite");
  const role = ROLES.includes(args.role) ? args.role : "member";
  const email = args.email.trim();

  const account = await ensureAccount(email, { scope: "org", targetName: org.name, role, inviterSub: sub });
  await db.insert(memberships).values({ orgId: org.id, userId: account.sub, role })
    .onConflictDoUpdate({ target: [memberships.orgId, memberships.userId], set: { role } });

  return {
    orgSlug: org.slug, email, role,
    provisioned: account.provisioned, emailSent: account.emailSent, inviteLink: account.inviteLink,
  };
}

/**
 * Account for this email — existing as-is, otherwise provisioned (GoTrue, no email)
 * + invitation email sent by Memento via Resend (fallback: link to pass along).
 * Shared building block for orgs / grants: ONE invitation flow, two landings
 * (membership or grant). `meta` enriches the email (org/KB, role, inviter).
 */
export async function ensureAccount(
  email: string,
  meta?: InviteMeta,
): Promise<{ sub: string; provisioned: boolean; emailSent: boolean; inviteLink: string | null }> {
  let existing: string | null = null;
  try { existing = await subForEmail(email); } catch { existing = null; }
  if (existing) return { sub: existing, provisioned: false, emailSent: false, inviteLink: null };
  const { sub, link } = await generateInviteLink(email);
  const { emailSent, inviteLink } = await deliverInvite(email, link, meta);
  return { sub, provisioned: true, emailSent, inviteLink };
}

/**
 * Resends an invitation to a member who has never signed in (pending): magic link
 * generated by GoTrue (no email) then sent by Memento via Resend. Falls back to a link
 * to pass along if the provider is missing/fails. Org admin required.
 */
export async function resendInvite(sub: string, args: { orgSlug: string; email: string }) {
  const org = await orgBySlug(args.orgSlug);
  await assertOrgAdmin(sub, org.id);
  await assertWithinLimit(sub, "invite");
  const email = args.email.trim();
  await subForEmail(email); // must exist (provisioned)
  const { link } = await generateInviteLink(email, true); // magic link (existing account)
  const { emailSent, inviteLink } = await deliverInvite(email, link, {
    scope: "org", targetName: org.name, inviterSub: sub,
  });
  return { orgSlug: org.slug, email, emailSent, inviteLink };
}

/** Sign-in link to pass along by hand (messaging fallback) for an existing account. */
export async function inviteLinkFor(sub: string, args: { orgSlug: string; email: string }) {
  const org = await orgBySlug(args.orgSlug);
  await assertOrgAdmin(sub, org.id);
  await assertWithinLimit(sub, "invite");
  const email = args.email.trim();
  await subForEmail(email);
  const { link } = await generateInviteLink(email, true);
  return { orgSlug: org.slug, email, link };
}

/**
 * Creates an org (sharing scope: mission/client, personal) — the creator
 * becomes its admin. No gating beyond authentication: an empty scope
 * exposes nothing. Slug deduplicated globally.
 */
export async function createOrg(sub: string, args: { name: string; slug?: string }) {
  if (!args.name?.trim()) throw new Error("organization name required");
  await assertWithinLimit(sub, "create_org"); // no org-admin gating here → bounds the throughput

  let slug = slugify(args.slug?.trim() || args.name);
  const taken = new Set((await db.select({ slug: orgs.slug }).from(orgs)).map((o) => o.slug));
  if (taken.has(slug)) { let n = 2; while (taken.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}`; }

  const [o] = await db.insert(orgs).values({ slug, name: args.name.trim() }).returning();
  await db.insert(memberships).values({ orgId: o.id, userId: sub, role: "admin" });
  return { slug: o.slug, name: o.name, myRole: "admin" };
}

/**
 * Renames an org (display name and/or slug). Org admin required. The slug is the
 * stable handle used by orgSlug-addressed verbs (create/transfer/grant) — changing
 * it is allowed but must stay globally unique; a collision is a hard error (no silent
 * suffixing, unlike creation). A personal org's slug is locked (it backs `personal_for`).
 */
export async function updateOrg(sub: string, args: { orgSlug: string; name?: string; slug?: string }) {
  const org = await orgBySlug(args.orgSlug);
  await assertOrgAdmin(sub, org.id);

  const patch: { name?: string; slug?: string } = {};
  if (args.name?.trim()) patch.name = args.name.trim();
  if (args.slug?.trim()) {
    if (org.personalFor) throw new Error("a personal org's slug is locked");
    const slug = slugify(args.slug.trim());
    if (slug !== org.slug) {
      const taken = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, slug)).limit(1);
      if (taken.length) throw new Error(`slug already taken: ${slug}`);
      patch.slug = slug;
    }
  }
  if (!patch.name && !patch.slug) throw new Error("nothing to update (provide name and/or slug)");

  const [o] = await db.update(orgs).set(patch).where(eq(orgs.id, org.id)).returning();
  return { slug: o.slug, name: o.name, myRole: "admin" };
}

/**
 * Hard-deletes an org's ARCHIVED workspaces (content first, FK-safe). Archiving is a soft
 * delete and the `workspaces.org_id` FK is `restrict`, so an archived KB would otherwise block
 * its org's deletion forever — and there is no user-facing hard-delete of a KB. This makes
 * "archive the KB, then delete its org" actually work (the deleteOrg message promised it).
 */
async function purgeArchivedWorkspaces(orgId: string): Promise<void> {
  const wss = await db.select({ id: workspaces.id }).from(workspaces)
    .where(and(eq(workspaces.orgId, orgId), isNotNull(workspaces.archivedAt)));
  for (const ws of wss) {
    // documents → blocks/links/block_sources cascade from documents.
    await db.delete(documents).where(
      inArray(documents.sectionId, db.select({ id: sections.id }).from(sections).where(eq(sections.workspaceId, ws.id))),
    );
    // sections: parent_id is RESTRICT — delete leaves first, looping until none remain.
    for (;;) {
      const rows = await db.select({ id: sections.id, parentId: sections.parentId }).from(sections)
        .where(eq(sections.workspaceId, ws.id));
      if (!rows.length) break;
      const parents = new Set(rows.map((r) => r.parentId).filter(Boolean) as string[]);
      const leaves = rows.map((r) => r.id).filter((id) => !parents.has(id));
      await db.delete(sections).where(inArray(sections.id, leaves.length ? leaves : rows.map((r) => r.id)));
    }
    // the workspace itself: revisions / ingestions / grants cascade from workspaces.
    await db.delete(workspaces).where(eq(workspaces.id, ws.id));
  }
}

/**
 * Deletes an org once it owns no ACTIVE KB and has no member other than the caller — fixes a
 * mistake. Archived KBs do NOT block (they are purged as part of deletion); only live ones do.
 */
export async function deleteOrg(sub: string, args: { orgSlug: string }) {
  const org = await orgBySlug(args.orgSlug);
  await assertOrgAdmin(sub, org.id);
  const [active, members] = await Promise.all([
    db.select({ id: workspaces.id }).from(workspaces)
      .where(and(eq(workspaces.orgId, org.id), isNull(workspaces.archivedAt))).limit(1),
    db.select({ u: memberships.userId }).from(memberships).where(eq(memberships.orgId, org.id)),
  ]);
  if (active.length) throw new Error("the org owns active KBs — archive or reassign them first");
  if (members.some((m) => m.u !== sub)) throw new Error("the org has other members — remove them first");
  await purgeArchivedWorkspaces(org.id); // archived KBs are soft-deleted — remove them so the org can go
  await db.delete(orgs).where(eq(orgs.id, org.id)); // memberships cascade
  return { deleted: org.slug };
}

/**
 * Transfers a KB to another org = change of TENANT (e.g. promoting a KB from the
 * personal org to the team org). The scope (visibility/grants) follows the KB.
 * Gating: admin of BOTH orgs — a per-KB grant NEVER delegates the tenancy
 * (otherwise a guest grant-admin could exfiltrate the KB to their own org).
 */
export async function transferWorkspace(sub: string, args: { workspace: string; toOrg: string }) {
  const [w] = await db.select().from(workspaces).where(eq(workspaces.slug, args.workspace)).limit(1);
  if (!w) throw new Error(`KB not found: ${args.workspace}`);
  if (!w.orgId) throw new Error("KB without an owning org — reassign via the tooling");
  const dest = await orgBySlug(args.toOrg);
  if (dest.id === w.orgId) throw new Error("the KB is already in this org");
  await assertOrgAdmin(sub, w.orgId);
  await assertOrgAdmin(sub, dest.id);
  await db.update(workspaces).set({ orgId: dest.id }).where(eq(workspaces.id, w.id));
  return { workspace: w.slug, toOrg: dest.slug };
}

/**
 * Creates an empty KB in an org the caller is admin of. `visibility` defaults to
 * `org`; `private` → curator grant placed on the creator (read/write — governance
 * stays with them anyway through the org).
 */
export async function createWorkspace(
  sub: string,
  args: { orgSlug: string; name: string; summary?: string; slug?: string; visibility?: "org" | "private" | "public" },
) {
  const org = await orgBySlug(args.orgSlug);
  await assertOrgAdmin(sub, org.id);
  if (!args.name?.trim()) throw new Error("KB name required");
  const visibility = args.visibility === "private" || args.visibility === "public" ? args.visibility : "org";

  // globally unique slug (mem_workspaces.slug is unique across all orgs).
  let slug = slugify(args.slug?.trim() || args.name);
  const taken = new Set((await db.select({ slug: workspaces.slug }).from(workspaces)).map((w) => w.slug));
  if (taken.has(slug)) { let n = 2; while (taken.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}`; }

  const [w] = await db.insert(workspaces).values({
    slug, name: args.name.trim(), summary: args.summary?.trim() ?? "", orgId: org.id, visibility,
  }).returning();
  if (visibility === "private") {
    await db.insert(workspaceGrants)
      .values({ workspaceId: w.id, userId: sub, role: "curator", createdBy: sub })
      .onConflictDoNothing();
  }
  return { slug: w.slug, name: w.name, summary: w.summary, orgSlug: org.slug, visibility };
}

/** Removes a member. Admin required. Refuses to remove the last admin (anti-lockout). */
export async function removeMember(sub: string, args: { orgSlug: string; userId: string }) {
  const org = await orgBySlug(args.orgSlug);
  await assertOrgAdmin(sub, org.id);
  const admins = await db.select({ u: memberships.userId }).from(memberships)
    .where(and(eq(memberships.orgId, org.id), eq(memberships.role, "admin")));
  if (admins.length === 1 && admins[0].u === args.userId) {
    throw new Error("cannot remove the last admin of the org");
  }
  await db.delete(memberships).where(and(eq(memberships.orgId, org.id), eq(memberships.userId, args.userId)));
  return { removed: args.userId, orgSlug: org.slug };
}
