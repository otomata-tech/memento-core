/**
 * HTTP helpers shared across functions (CORS + JSON response).
 *
 * Cross-origin allowed origins: no `*`, we only reflect a known origin.
 * (The `api` function still keeps its local copy — convergence eventually.)
 */
const ALLOWED_ORIGINS = new Set(
  [
    Deno.env.get("MEMENTO_APP_URL"),
    Deno.env.get("MEMENTO_PUBLIC_URL"),
    "https://mento.cc",
    "https://me.mento.cc",
    "https://agent.otomata.tech",
    "http://localhost:5188",
    "http://localhost:5173",
  ]
    .filter((u): u is string => !!u)
    .map((u) => {
      try { return new URL(u).origin; } catch { return u; }
    }),
);

export function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "vary": "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) h["access-control-allow-origin"] = origin;
  return h;
}

export function jsonRes(data: unknown, status = 200, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors },
  });
}
