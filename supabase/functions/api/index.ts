/**
 * Memento REST — Supabase Edge Function (Deno). Miroir des verbes `mem_*` au-dessus
 * de la couche services partagée (`../_shared/`), pour le serveur-à-serveur et le
 * viewer. Mêmes query params que la surface MCP (id | path, workspace, q...).
 *
 * Déployé, la function "api" répond sur /api/*. En local : deno run -A .../api/index.ts
 */
import { listWorkspaces, listPublicWorkspaces, getDoctrine } from "../_shared/workspaces.ts";
import { getSection } from "../_shared/sections.ts";
import { getDocument, getBlock } from "../_shared/documents.ts";
import { searchBlocks, searchPublic } from "../_shared/search.ts";
import { listRevisions } from "../_shared/revisions.ts";
import { verifyBlock, attachSource, addComment, resolveComment } from "../_shared/write.ts";
import { getIngestion, listIngestions, applyIngestion, rejectIngestion, requestChanges } from "../_shared/ingestion.ts";
import {
  listMyOrgs, removeMember, inviteMember, createWorkspace, createOrg, deleteOrg,
  resendInvite, inviteLinkFor, transferWorkspace, ensureDefaultWorkspace, ensureAccount,
} from "../_shared/admin.ts";
import { getDefaultWorkspace, setDefaultWorkspace, listPins, pinWorkspace, unpinWorkspace } from "../_shared/prefs.ts";
import { listAccounts } from "../_shared/platform.ts";
import { listGrants, grantAccess, revokeGrant, setVisibility } from "../_shared/grants.ts";
import { logUsage, listUsageLogs } from "../_shared/usage_log.ts";
import { setDoctrine, updateWorkspace, archiveWorkspace } from "../_shared/workspace_mgmt.ts";
import { authenticate } from "../_shared/auth.ts";
import { assertAccess, assertWorkspaceAdmin, accessibleWorkspaceIds, AccessError, safeErrorMessage } from "../_shared/access.ts";
import { assertWithinLimit, RateLimitError } from "../_shared/ratelimit.ts";

/** Origines autorisées à appeler l'API en cross-origin (le viewer passe par un
 *  proxy same-origin et n'en a pas besoin). Pas de `*` : on ne reflète qu'une
 *  origine connue. */
const ALLOWED_ORIGINS = new Set(
  [
    Deno.env.get("MEMENTO_APP_URL"),
    Deno.env.get("MEMENTO_PUBLIC_URL"),
    "https://mento.cc",
    "https://me.mento.cc",
    "http://localhost:5188",
    "http://localhost:5173",
  ]
    .filter((u): u is string => !!u)
    .map((u) => {
      try { return new URL(u).origin; } catch { return u; }
    }),
);

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "vary": "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) h["access-control-allow-origin"] = origin;
  return h;
}

function jsonRes(data: unknown, status = 200, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors },
  });
}

/** Routes réservées aux comptes connectés même sur une KB publique : la couche
 *  éditoriale/audit (journal de révisions, file d'ingestions) porte l'identité des
 *  contributeurs — pas une donnée publique. La lecture de contenu, elle, est ouverte. */
function requireAuthenticated(sub: string): void {
  if (!sub) throw new AccessError("ressource introuvable ou accès refusé");
}

async function route(path: string, q: URLSearchParams, sub: string): Promise<unknown> {
  const id = q.get("id") ?? undefined;
  const p = q.get("path") ?? undefined;
  switch (path) {
    // ── Surface PUBLIQUE (sans auth) : galerie + recherche des KB publiques ──
    case "/public/workspaces":
      return listPublicWorkspaces();
    case "/public/search":
      await assertWithinLimit(sub, "search_public"); // anonyme (sub="") = no-op, borné WAF
      return searchPublic({
        q: q.get("q") ?? "",
        blockType: q.get("blockType") ?? undefined,
        docKind: q.get("docKind") ?? undefined,
        maxHits: q.get("maxHits") ? Number(q.get("maxHits")) : undefined,
      });
    case "/workspaces":
      // Onboarding : un compte loggé sans KB s'en voit créer une (org perso, privée).
      await ensureDefaultWorkspace(sub); // anonyme (sub="") = no-op
      return listWorkspaces({ ids: await accessibleWorkspaceIds(sub) });
    case "/prefs":
      return { defaultWorkspace: (await getDefaultWorkspace(sub))?.slug ?? null };
    case "/prefs/pins":
      requireAuthenticated(sub);
      return listPins(sub);
    case "/admin/orgs":
      return listMyOrgs(sub);
    case "/admin/accounts":
      // Gating dans listAccounts : opérateurs plateforme (MEMENTO_PLATFORM_ADMINS).
      return listAccounts(sub);
    case "/workspace/grants":
      // Gating dans listGrants : admin effectif de la base.
      return listGrants(sub, { workspace: q.get("workspace")! });
    case "/doctrine":
      await assertAccess(sub, { workspace: q.get("workspace")! });
      return getDoctrine(q.get("workspace")!);
    case "/section":
      await assertAccess(sub, p ? { path: p } : { id, kind: "section" });
      return getSection({ id, path: p });
    case "/document":
      await assertAccess(sub, p ? { path: p } : { id, kind: "document" });
      return getDocument({ id, path: p });
    case "/block":
      await assertAccess(sub, { id: q.get("id")!, kind: "block" });
      return getBlock(q.get("id")!);
    case "/search":
      await assertAccess(sub, { workspace: q.get("workspace")! });
      return searchBlocks({
        workspace: q.get("workspace")!,
        q: q.get("q") ?? "",
        blockType: q.get("blockType") ?? undefined,
        sectionPath: q.get("sectionPath") ?? undefined,
        docKind: q.get("docKind") ?? undefined,
        maxHits: q.get("maxHits") ? Number(q.get("maxHits")) : undefined,
      });
    case "/revisions":
      requireAuthenticated(sub);
      await assertAccess(sub, { workspace: q.get("workspace")! });
      return listRevisions({
        workspace: q.get("workspace")!,
        targetType: q.get("targetType") ?? undefined,
        targetId: q.get("targetId") ?? undefined,
        since: q.get("since") ?? undefined,
        limit: q.get("limit") ? Number(q.get("limit")) : undefined,
      });
    case "/ingestions":
      requireAuthenticated(sub);
      await assertAccess(sub, { workspace: q.get("workspace")! });
      return listIngestions({ workspace: q.get("workspace")!, status: q.get("status") ?? undefined });
    case "/ingestion":
      requireAuthenticated(sub);
      await assertAccess(sub, { id: q.get("id")!, kind: "ingestion" });
      return getIngestion(q.get("id")!);
    case "/usage-logs":
      // Scoping dans listUsageLogs : mes logs, ou ceux d'une KB si admin/curator.
      return listUsageLogs({
        workspace: q.get("workspace") ?? undefined,
        verb: q.get("verb") ?? undefined,
        kind: q.get("kind") ?? undefined,
        limit: q.get("limit") ? Number(q.get("limit")) : undefined,
      }, sub);
    default: return null;
  }
}

/** Routes mutantes (admin + préférences) — POST/DELETE avec body JSON. */
async function mutationRoute(method: string, path: string, body: any, sub: string): Promise<unknown> {
  switch (`${method} ${path}`) {
    case "POST /admin/invite": return inviteMember(sub, body);
    case "POST /admin/invite/resend": return resendInvite(sub, body);
    case "POST /admin/invite/link": return inviteLinkFor(sub, body);
    case "POST /admin/orgs": return createOrg(sub, body);
    case "DELETE /admin/orgs": return deleteOrg(sub, body);
    case "POST /admin/workspaces": return createWorkspace(sub, body);
    case "POST /admin/workspaces/transfer": return transferWorkspace(sub, body);
    case "DELETE /admin/members": return removeMember(sub, body);
    case "POST /prefs/default-workspace": {
      const w = await setDefaultWorkspace(sub, body.workspace);
      return { defaultWorkspace: w.slug, name: w.name };
    }
    case "POST /prefs/pin":
      requireAuthenticated(sub);
      return pinWorkspace(sub, body.workspace); // assertAccess (lecture) dans la fn
    case "DELETE /prefs/pin":
      requireAuthenticated(sub);
      return unpinWorkspace(sub, body.workspace);
    case "POST /workspace/doctrine":
      await assertAccess(sub, { workspace: body.workspace }, { write: true });
      return setDoctrine(body, sub);
    case "POST /workspace/update":
      await assertAccess(sub, { workspace: body.workspace }, { write: true });
      return updateWorkspace(body, sub);
    case "POST /workspace/archive":
      await assertWorkspaceAdmin(sub, body.workspace);
      return archiveWorkspace(body, sub);
    // ── Périmètre par KB (gating admin effectif dans les services, issue #60) ──
    case "POST /workspace/grants": return grantAccess(sub, body);
    case "DELETE /workspace/grants": return revokeGrant(sub, body);
    case "POST /workspace/visibility": return setVisibility(sub, body);
    // ── Écriture curée (réservée admin/curator, gated par assertAccess write) ──
    case "POST /block/verify":
      await assertAccess(sub, { id: body.id, kind: "block" }, { write: true });
      return verifyBlock(body, sub);
    case "POST /block/source":
      await assertAccess(sub, { id: body.blockId, kind: "block" }, { write: true });
      return attachSource(body, sub);
    case "POST /block/comment":
      await assertAccess(sub, { id: body.targetId, kind: body.targetType.toLowerCase() }, { write: true });
      return addComment(body, sub);
    case "POST /comment/resolve":
      await assertAccess(sub, { id: body.id, kind: "comment" }, { write: true });
      return resolveComment({ id: body.id });
    case "POST /ingestion/apply":
      await assertAccess(sub, { id: body.id, kind: "ingestion" }, { write: true });
      return applyIngestion(body, sub);
    case "POST /ingestion/reject":
      await assertAccess(sub, { id: body.id, kind: "ingestion" }, { write: true });
      return rejectIngestion(body, sub);
    case "POST /ingestion/request-changes":
      await assertAccess(sub, { id: body.id, kind: "ingestion" }, { write: true });
      return requestChanges(body, sub);
    case "POST /usage-log":
      // Feedback produit : ouvert à tout user authentifié, aucun rôle requis.
      return logUsage(body, sub);
    default: return null;
  }
}

Deno.serve({ port: Number(Deno.env.get("PORT") ?? 8000) }, async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const url = new URL(req.url);
  // Retire le préfixe de routage de la function (/api) s'il est présent.
  const path = url.pathname.replace(/^\/api/, "") || "/";
  if (path === "/health") return new Response("ok", { headers: cors });
  // Fédération oto→memento (otomata#16) : un compte créé sur oto demande la création
  // du compte memento correspondant (jointure par email). Authentifié par le SECRET
  // DE SERVICE partagé (MEMENTO_PROVISION_BEARER), PAS par l'OAuth user — avant
  // authenticate(). memento reste propriétaire de la création (ensureAccount).
  if (path === "/federation/provision" && req.method === "POST") {
    const secret = Deno.env.get("MEMENTO_PROVISION_BEARER");
    const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!secret || got !== secret) return jsonRes({ error: "forbidden" }, 403, cors);
    const body = await req.json().catch(() => ({})) as { email?: string };
    const email = (body.email ?? "").trim();
    if (!email) return jsonRes({ error: "email requis" }, 400, cors);
    try {
      const r = await ensureAccount(email);
      return jsonRes({ ok: true, provisioned: r.provisioned, sub: r.sub }, 200, cors);
    } catch (e) {
      console.error("[api] federation/provision:", e);
      return jsonRes({ error: safeErrorMessage(e) }, 500, cors);
    }
  }
  // Lecture anonyme autorisée (GET) : sans token, on poursuit en sub="" et chaque
  // route reste gardée par assertAccess → seul le périmètre `public` passe (réponse
  // indistincte d'un refus sinon). Les mutations exigent toujours un token valide.
  const auth = await authenticate(req);
  if (!auth.ok && req.method !== "GET") return jsonRes({ error: auth.message }, auth.status, cors);
  const sub = auth.ok ? (auth.claims.sub ?? "") : "";
  try {
    const data = req.method === "GET"
      ? await route(path, url.searchParams, sub)
      : await mutationRoute(req.method, path, await req.json().catch(() => ({})), sub);
    if (data === null) return jsonRes({ error: `route inconnue: ${path}` }, 404, cors);
    return jsonRes(data, 200, cors);
  } catch (e) {
    if (e instanceof AccessError) return jsonRes({ error: e.message }, 403, cors);
    if (e instanceof RateLimitError) return jsonRes({ error: e.message }, 429, cors);
    console.error(`[api] ${req.method} ${path}:`, e);
    return jsonRes({ error: safeErrorMessage(e) }, 400, cors);
  }
});
