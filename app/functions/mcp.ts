// /mcp → function mcp Supabase. Query droppée (mirror Caddy `rewrite * /functions/v1/mcp`).
import { proxyTo } from "./_proxy";

export const onRequest = (ctx: { request: Request }): Promise<Response> =>
  proxyTo("/functions/v1/mcp", ctx.request, false);
