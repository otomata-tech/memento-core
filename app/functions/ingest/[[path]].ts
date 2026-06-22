// /ingest/* → PostHog EU (reverse proxy first-party, contourne les ad-blockers).
//   /ingest/static/* → eu-assets.i.posthog.com/static/*  (lib JS, assets)
//   /ingest/*        → eu.i.posthog.com/*                 (ingestion events)
// Pendant CF Pages du snippet Caddy `posthog_proxy` des sites tuls.me. api_host
// côté front = location.origin + '/ingest' → même domaine = quasi-imbloquable.
const ASSETS = "https://eu-assets.i.posthog.com";
const INGEST = "https://eu.i.posthog.com";

export const onRequest = (ctx: { request: Request }): Promise<Response> => {
  const url = new URL(ctx.request.url);
  const path = url.pathname.replace(/^\/ingest/, ""); // strip → /static/array.js | /i/v0/e/
  const upstream = path.startsWith("/static") ? ASSETS : INGEST;
  const target = upstream + path + url.search;

  const headers = new Headers(ctx.request.headers);
  headers.delete("host"); // redérivé de target par le runtime

  const init: RequestInit & { duplex?: "half" } = {
    method: ctx.request.method,
    headers,
    redirect: "manual",
  };
  if (ctx.request.method !== "GET" && ctx.request.method !== "HEAD") {
    init.body = ctx.request.body;
    init.duplex = "half"; // requis pour streamer un body de requête
  }

  return fetch(target, init).then((resp) => new Response(resp.body, resp));
};
