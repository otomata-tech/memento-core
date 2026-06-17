/**
 * Garde d'authentification OAuth 2.1 (Supabase comme serveur d'autorisation).
 *
 * La function est un *resource server* (RFC 9728) : elle vérifie elle-même les JWT
 * via le JWKS Supabase (ES256), advertise le serveur d'autorisation par le PRM, et
 * renvoie 401 + WWW-Authenticate quand le token manque/est invalide.
 *
 * Env :
 *   MEMENTO_AUTH_URL     ex. https://<ref>.supabase.co/auth/v1  (issuer + JWKS)
 *   MEMENTO_PUBLIC_URL    base publique du MCP, ex. https://mcp.mento.cc
 *   MEMENTO_ALLOWED_EMAILS (optionnel) allowlist d'emails, séparés par virgule
 */
import { createRemoteJWKSet, jwtVerify } from "https://esm.sh/jose@5.9.6";

const authUrl = () => (Deno.env.get("MEMENTO_AUTH_URL") ?? "").replace(/\/+$/, "");
const publicUrl = () => (Deno.env.get("MEMENTO_PUBLIC_URL") ?? "").replace(/\/+$/, "");

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function jwks() {
  if (!_jwks) _jwks = createRemoteJWKSet(new URL(`${authUrl()}/.well-known/jwks.json`));
  return _jwks;
}

export interface Claims {
  sub?: string;
  email?: string;
  role?: string;
  [k: string]: unknown;
}
export type AuthResult =
  | { ok: true; claims: Claims }
  | { ok: false; status: number; message: string };

export async function authenticate(req: Request): Promise<AuthResult> {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, status: 401, message: "jeton Bearer manquant" };

  let claims: Claims;
  try {
    const { payload } = await jwtVerify(m[1], jwks(), {
      issuer: authUrl(),
      audience: "authenticated",
    });
    claims = payload as Claims;
  } catch {
    return { ok: false, status: 401, message: "jeton invalide ou expiré" };
  }

  if (claims.role !== "authenticated") {
    return { ok: false, status: 403, message: "rôle non autorisé (clé anon refusée)" };
  }
  const allow = Deno.env.get("MEMENTO_ALLOWED_EMAILS");
  if (allow && allow.trim()) {
    const list = allow.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!claims.email || !list.includes(claims.email.toLowerCase())) {
      return { ok: false, status: 403, message: "utilisateur non autorisé" };
    }
  }
  return { ok: true, claims };
}

/** PRM RFC 9728 — désigne le serveur d'autorisation au client MCP. */
export function protectedResourceMetadata() {
  return {
    resource: `${publicUrl()}/mcp`,
    authorization_servers: [authUrl()],
    bearer_methods_supported: ["header"],
  };
}

/** En-tête WWW-Authenticate pointant vers le PRM (déclenche le flow OAuth côté host). */
export function wwwAuthenticate(): string {
  return `Bearer resource_metadata="${publicUrl()}/.well-known/oauth-protected-resource"`;
}

/** Reconnaît les chemins de découverte servis sans auth. */
export function isDiscoveryPath(pathname: string): "prm" | "as" | null {
  if (/\/\.well-known\/oauth-protected-resource(\/mcp)?$/.test(pathname)) return "prm";
  if (/\/\.well-known\/oauth-authorization-server$/.test(pathname)) return "as";
  return null;
}

/** Proxy de la métadonnée du serveur d'autorisation Supabase (RFC 8414). */
export async function authServerMetadata(): Promise<Response> {
  const r = await fetch(`${authUrl()}/.well-known/oauth-authorization-server`);
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}
