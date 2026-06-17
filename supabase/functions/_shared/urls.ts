/**
 * Lien viewer canonique échoué par les verbes de lecture (mem_document,
 * mem_block, hits de mem_search). Sans URL fournie, l'agent en fabrique une
 * plausible sur le host du connecteur (mcp.mento.cc/doc/<id>) — qui redirige
 * vers la vitrine. Le serveur reste bête : simple concaténation.
 */
export function docUrl(workspaceSlug: string, documentId: string, blockId?: string): string {
  const url = `${appBase()}/w/${workspaceSlug}/doc/${documentId}`;
  return blockId ? `${url}?block=${blockId}` : url;
}

/** Lien vers la Boucle (file de validation), ancré sur une ingestion (`?ing=`). */
export function loopUrl(workspaceSlug: string, ingestionId: string): string {
  return `${appBase()}/w/${workspaceSlug}/loop?ing=${ingestionId}`;
}

function appBase(): string {
  const base = (Deno.env.get("MEMENTO_APP_URL") ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("MEMENTO_APP_URL absent (liens viewer)");
  return base;
}
