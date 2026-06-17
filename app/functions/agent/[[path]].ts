// /agent/* → function agent Supabase (mode agent : chat SSE sur une KB publique).
// Miroir de /api : le corps (POST) et la réponse (SSE) sont streamés tels quels.
import { proxyTo } from "../_proxy";

export const onRequest = (ctx: { request: Request }): Promise<Response> => {
  const { pathname } = new URL(ctx.request.url); // ex. /agent/chat
  return proxyTo("/functions/v1" + pathname, ctx.request, true);
};
