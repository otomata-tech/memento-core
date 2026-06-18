/**
 * OAuth 2.1 authentication guard (Supabase as authorization server).
 *
 * The function is a *resource server* (RFC 9728): it verifies the JWTs itself via the
 * Supabase JWKS (ES256), advertises the authorization server through the PRM, and
 * returns 401 + WWW-Authenticate when the token is missing/invalid.
 *
 * Env:
 *   MEMENTO_AUTH_URL     e.g. https://<ref>.supabase.co/auth/v1  (issuer + JWKS)
 *   MEMENTO_PUBLIC_URL    public base of the MCP, e.g. https://mento.cc
 *   MEMENTO_ALLOWED_EMAILS (optional) email allowlist, comma-separated
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
  if (!m) return { ok: false, status: 401, message: "missing Bearer token" };

  let claims: Claims;
  try {
    const { payload } = await jwtVerify(m[1], jwks(), {
      issuer: authUrl(),
      audience: "authenticated",
    });
    claims = payload as Claims;
  } catch {
    return { ok: false, status: 401, message: "invalid or expired token" };
  }

  if (claims.role !== "authenticated") {
    return { ok: false, status: 403, message: "unauthorized role (anon key refused)" };
  }
  const allow = Deno.env.get("MEMENTO_ALLOWED_EMAILS");
  if (allow && allow.trim()) {
    const list = allow.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!claims.email || !list.includes(claims.email.toLowerCase())) {
      return { ok: false, status: 403, message: "unauthorized user" };
    }
  }
  return { ok: true, claims };
}

/** PRM RFC 9728 — designates the authorization server to the MCP client. */
export function protectedResourceMetadata() {
  return {
    resource: `${publicUrl()}/mcp`,
    authorization_servers: [authUrl()],
    bearer_methods_supported: ["header"],
  };
}

/** WWW-Authenticate header pointing to the PRM (triggers the OAuth flow on the host side). */
export function wwwAuthenticate(): string {
  return `Bearer resource_metadata="${publicUrl()}/.well-known/oauth-protected-resource"`;
}

/** Recognizes the discovery paths served without auth. */
export function isDiscoveryPath(pathname: string): "prm" | "as" | null {
  if (/\/\.well-known\/oauth-protected-resource(\/mcp)?$/.test(pathname)) return "prm";
  if (/\/\.well-known\/oauth-authorization-server$/.test(pathname)) return "as";
  return null;
}

/** Proxy of the Supabase authorization server metadata (RFC 8414). */
export async function authServerMetadata(): Promise<Response> {
  const r = await fetch(`${authUrl()}/.well-known/oauth-authorization-server`);
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}
