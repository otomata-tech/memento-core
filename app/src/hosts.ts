// Rôles de domaine en prod (cf. docs/deployment-edge.md) :
//   mento.cc / www.mento.cc → site vitrine (landing publique : /, /plugin)
//   me.mento.cc             → app (viewer + login + oauth) — canonique
//   mcp.mento.cc            → endpoint MCP (pas de SPA humaine)
// Dev (memento.dev, localhost) et transition se comportent comme l'app complète.
const SITE_HOSTS = new Set(["mento.cc", "www.mento.cc"]);

/** Origine de l'app — cible des redirections depuis le site vitrine. */
export const APP_ORIGIN = "https://me.mento.cc";

/** Servi sur le domaine vitrine (mento.cc) ? Là, seules les pages publiques de site restent. */
export function isSiteHost(): boolean {
  return SITE_HOSTS.has(location.host);
}
