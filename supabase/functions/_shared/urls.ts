/**
 * Canonical viewer link echoed by the read verbs (mem_document, mem_block,
 * mem_search hits). Without a provided URL, the agent fabricates a plausible
 * one on the connector host (mcp.mento.cc/doc/<id>) — which redirects to the
 * landing site. The server stays dumb: plain concatenation.
 */
export function docUrl(workspaceSlug: string, documentId: string, blockId?: string): string {
  const url = `${appBase()}/w/${workspaceSlug}/doc/${documentId}`;
  return blockId ? `${url}?block=${blockId}` : url;
}

/** Link to the Loop (validation queue), anchored on an ingestion (`?ing=`). */
export function loopUrl(workspaceSlug: string, ingestionId: string): string {
  return `${appBase()}/w/${workspaceSlug}/loop?ing=${ingestionId}`;
}

function appBase(): string {
  const base = (Deno.env.get("MEMENTO_APP_URL") ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("MEMENTO_APP_URL missing (viewer links)");
  return base;
}
