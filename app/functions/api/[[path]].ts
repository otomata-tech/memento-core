// /api/* → function api Supabase (miroir REST lecture du viewer).
import { proxyTo } from "../_proxy";

export const onRequest = (ctx: { request: Request }): Promise<Response> => {
  const { pathname } = new URL(ctx.request.url); // ex. /api/workspaces
  return proxyTo("/functions/v1" + pathname, ctx.request, true);
};
