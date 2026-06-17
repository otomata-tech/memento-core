// /.well-known/* → function mcp (discovery OAuth : PRM RFC 9728 + AS metadata).
import { proxyTo } from "../_proxy";

export const onRequest = (ctx: { request: Request }): Promise<Response> => {
  const { pathname } = new URL(ctx.request.url); // ex. /.well-known/oauth-protected-resource
  return proxyTo("/functions/v1/mcp" + pathname, ctx.request, true);
};
