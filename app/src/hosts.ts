// Domain roles in prod (cf. docs/deployment-edge.md):
//   mento.cc / www.mento.cc → showcase site (public landing: /, /plugin)
//   me.mento.cc             → app (viewer + login + oauth) — canonical
//   mcp.mento.cc            → MCP endpoint (no human SPA)
// Dev (memento.dev, localhost) and transition (mento.cc, base.mento.cc) behave like the full app.
const SITE_HOSTS = new Set(["mento.cc", "www.mento.cc"]);

/** App origin — target of redirects from the showcase site. */
export const APP_ORIGIN = "https://me.mento.cc";

/** Served on the showcase domain (mento.cc)? There, only the public site pages remain. */
export function isSiteHost(): boolean {
  return SITE_HOSTS.has(location.host);
}
