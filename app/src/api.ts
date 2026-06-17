// Client REST minimal vers le backend Memento (/api miroir des verbes MCP).
import { supabase } from "./auth";

/** Jeton de session, ou null en lecture anonyme (KB publique). */
async function token(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/** En-tête Authorization seulement si une session existe (sinon lecture anonyme). */
async function authHeader(): Promise<Record<string, string>> {
  const t = await token();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const res = await fetch(`/api${path}?${qs}`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function send<T>(method: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { ...(await authHeader()), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `${path} → ${res.status}`);
  return data as T;
}

export interface Workspace { slug: string; name: string; summary: string }
export interface PinnedWorkspace { id: string; slug: string; name: string; summary: string; org: string | null }
export interface SectionNode {
  id: string; title: string; slug: string; summary: string;
  docCount: number; blockCount: number; children: SectionNode[];
}
export interface Doctrine {
  workspace: { slug: string; name: string; summary: string };
  preamble: string;
  tree: SectionNode[];
  conventions: Record<string, string[]>;
}
export interface DocMeta { id: string; title: string; slug: string; summary: string; kind: string | null; status: string; sectionId?: string }
export interface SectionView {
  section: { id: string; title: string; slug: string; summary: string; depth: number };
  subsections: { id: string; title: string; slug: string; summary: string }[];
  documents: (DocMeta & { blockCount: number })[];
}
export interface BlockSource { sourceId?: string; kind?: string; title: string; ref: string | null; citation: string | null; locator: string | null }
export interface BlockLink { id: string; relation: string; note: string | null; toBlockId?: string; fromBlockId?: string }
export interface BlockComment { id: string; body: string; author: string; authorKind: string; resolvedAt: string | null }
export interface Block {
  id: string; type: string; content: string; position: number; verifiedAt: string | null;
  sources: BlockSource[]; linksFrom: BlockLink[]; linksTo: BlockLink[]; comments: BlockComment[];
}
export interface DocumentView { document: DocMeta; blocks: Block[] }

export interface Revision {
  id: string; targetType: string; targetId: string | null; op: string; reason: string;
  actor: string; actorKind: string; ingestionId: string | null; createdAt: string;
}
export interface ChangeFeedback { author: string; authorKind: string; body: string; at: string }
export interface IngestionChange {
  id: string; op: string; class: string; target: string | null; rationale: string | null;
  payload: Record<string, unknown>; applied: boolean; appliedAt?: string; error?: string;
  feedback?: ChangeFeedback[]; edited?: boolean; editedBy?: string;
}
export interface IngestionCounts { total: number; applied: number; pending: number; errored: number; byClass: Record<string, number> }
export interface IngestionSummary { id: string; title: string; status: string; sourceId: string | null; createdBy: string | null; createdAt: string; counts: IngestionCounts }
export interface IngestionDetail extends IngestionSummary { summary: string; reviewNote: string | null; changes: IngestionChange[]; decidedBy: string | null; decidedAt: string | null }
export interface ChangeEdit { id: string; payload: Record<string, unknown> }
export interface FeedbackItem { changeId?: string; body: string }
export interface SearchHit { blockId: string; type: string; snippet: string; rank: number; docPath: string; sectionPath: string }
export interface SearchResult { hits: SearchHit[]; total: number }

export interface OrgMember { userId: string; email: string | null; role: string; pending: boolean }
export interface PlatformAccount {
  id: string; email: string; provider: string | null;
  createdAt: string; lastSignInAt: string | null; orgs: string | null;
}
export interface AdminOrg {
  id: string; slug: string; name: string; myRole: string | null; personal: boolean;
  members: OrgMember[];
  workspaces: { slug: string; name: string; visibility: "org" | "private" | "public" }[];
}
export interface PublicWorkspace { slug: string; name: string; summary: string; org: string | null; orgName: string | null }
export interface PublicSearchHit extends SearchHit { workspace: string | null; org: string | null; docTitle: string; url: string | null }
export interface WorkspaceGrant { userId: string; email: string | null; role: string; pending: boolean }
export interface WorkspaceAccess {
  workspace: string; org: string | null; orgName: string | null;
  visibility: "org" | "private" | "public";
  grants: WorkspaceGrant[];
  inherited: WorkspaceGrant[]; // membres de l'org (si visibility=org)
}

export const api = {
  workspaces: () => get<Workspace[]>("/workspaces"),
  doctrine: (workspace: string) => get<Doctrine>("/doctrine", { workspace }),
  section: (id: string) => get<SectionView>("/section", { id }),
  document: (id: string) => get<DocumentView>("/document", { id }),
  documentByPath: (path: string) => get<DocumentView>("/document", { path }),
  block: (id: string) => get<Block & { documentId: string }>("/block", { id }),
  search: (workspace: string, q: string, maxHits = 20) => get<SearchResult>("/search", { workspace, q, maxHits }),
  prefs: () => get<{ defaultWorkspace: string | null }>("/prefs"),
  setDefaultWorkspace: (workspace: string) =>
    send<{ defaultWorkspace: string }>("POST", "/prefs/default-workspace", { workspace }),
  pinned: () => get<PinnedWorkspace[]>("/prefs/pins"),
  pinWorkspace: (workspace: string) => send<{ slug: string; name: string }>("POST", "/prefs/pin", { workspace }),
  unpinWorkspace: (workspace: string) => send<{ slug: string }>("DELETE", "/prefs/pin", { workspace }),
  setDoctrine: (workspace: string, preamble: string) =>
    send<{ workspace: string }>("POST", "/workspace/doctrine", { workspace, preamble }),
  updateWorkspace: (workspace: string, name: string, summary: string) =>
    send<{ workspace: string; name: string; summary: string }>("POST", "/workspace/update", { workspace, name, summary }),
  archiveWorkspace: (workspace: string, archived: boolean) =>
    send<{ workspace: string; archived: boolean }>("POST", "/workspace/archive", { workspace, archived }),
  revisions: (workspace: string, limit = 50) =>
    get<{ count: number; revisions: Revision[] }>("/revisions", { workspace, limit }),
  ingestions: (workspace: string, status?: string) =>
    get<{ count: number; ingestions: IngestionSummary[] }>("/ingestions", { workspace, status }),
  ingestion: (id: string) => get<IngestionDetail>("/ingestion", { id }),
  // ── Écriture curée (curator/admin) — miroir REST des verbes mem_* ──
  verifyBlock: (id: string, verified = true, reason?: string) =>
    send<{ id: string; verifiedAt: string | null; verifiedBy: string | null }>(
      "POST", "/block/verify", { id, verified, reason }),
  attachSource: (input: { blockId: string; kind: string; title: string; ref?: string; citation?: string; locator?: string; reason?: string }) =>
    send<{ blockId: string; sourceId: string }>("POST", "/block/source", input),
  addComment: (input: { targetType: string; targetId: string; body: string; authorKind?: string }) =>
    send<BlockComment>("POST", "/block/comment", input),
  resolveComment: (id: string) =>
    send<{ id: string; resolvedAt: string | null }>("POST", "/comment/resolve", { id }),
  applyIngestion: (id: string, acceptIds?: string[], edits?: ChangeEdit[]) =>
    send<IngestionDetail>("POST", "/ingestion/apply", { id, acceptIds, edits }),
  rejectIngestion: (id: string, reason?: string) =>
    send<{ id: string; status: string }>("POST", "/ingestion/reject", { id, reason }),
  requestChanges: (id: string, input: { note?: string; items?: FeedbackItem[] }) =>
    send<IngestionDetail & { requested: number; hasNote: boolean }>("POST", "/ingestion/request-changes", { id, ...input }),
  admin: {
    orgs: () => get<{ orgs: AdminOrg[] }>("/admin/orgs"),
    accounts: () => get<{ count: number; accounts: PlatformAccount[] }>("/admin/accounts"),
    createOrg: (name: string) =>
      send<{ slug: string; name: string; myRole: string }>("POST", "/admin/orgs", { name }),
    deleteOrg: (orgSlug: string) =>
      send<{ deleted: string }>("DELETE", "/admin/orgs", { orgSlug }),
    invite: (orgSlug: string, email: string, role: string) =>
      send<{ orgSlug: string; email: string; role: string; provisioned: boolean; emailSent: boolean; inviteLink: string | null }>(
        "POST", "/admin/invite", { orgSlug, email, role }),
    resendInvite: (orgSlug: string, email: string) =>
      send<{ email: string; emailSent: boolean }>("POST", "/admin/invite/resend", { orgSlug, email }),
    inviteLink: (orgSlug: string, email: string) =>
      send<{ email: string; link: string }>("POST", "/admin/invite/link", { orgSlug, email }),
    createWorkspace: (orgSlug: string, name: string, summary: string) =>
      send<{ slug: string; name: string; orgSlug: string }>("POST", "/admin/workspaces", { orgSlug, name, summary }),
    transferWorkspace: (toOrg: string, workspace: string) =>
      send<{ workspace: string; toOrg: string }>("POST", "/admin/workspaces/transfer", { workspace, toOrg }),
    removeMember: (orgSlug: string, userId: string) =>
      send<{ removed: string }>("DELETE", "/admin/members", { orgSlug, userId }),
  },
  // ── Périmètre par KB (issue #60) — réservé aux admins de la base ──
  grants: (workspace: string) => get<WorkspaceAccess>("/workspace/grants", { workspace }),
  grant: (workspace: string, email: string, role: string) =>
    send<{ workspace: string; email: string; role: string; provisioned: boolean; emailSent: boolean; inviteLink: string | null }>(
      "POST", "/workspace/grants", { workspace, email, role }),
  revokeGrant: (workspace: string, userId: string) =>
    send<{ workspace: string; removed: string }>("DELETE", "/workspace/grants", { workspace, userId }),
  setVisibility: (workspace: string, visibility: "org" | "private" | "public") =>
    send<{ workspace: string; visibility: string }>("POST", "/workspace/visibility", { workspace, visibility }),
  // ── Surface publique (sans auth) : galerie + recherche des KB publiques ──
  public: {
    workspaces: () => get<PublicWorkspace[]>("/public/workspaces"),
    search: (q: string, maxHits = 30) =>
      get<{ hits: PublicSearchHit[]; total: number; hasMore: boolean }>("/public/search", { q, maxHits }),
  },
};
