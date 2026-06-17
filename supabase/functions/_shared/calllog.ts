/**
 * Journal des appels de tools MCP — port Deno/TS d'otomata-calllog
 * (lib Python du monorepo otomata ; même contrat de ligne, table `tool_calls`,
 * migration 0012). Une ligne par verbe appelé : sub, tool, args tronqués,
 * ok/error, duration_ms, server="memento".
 *
 * Fire-and-forget : l'écriture ne retarde jamais la réponse et un échec ne
 * fait pas échouer le verbe. Sur Supabase Edge, une promesse pendante après
 * la réponse peut être tuée par l'isolate → EdgeRuntime.waitUntil quand
 * disponible (local Deno : simple .catch()).
 */
import { sql } from "drizzle-orm";
import { db } from "./db.ts";

const SERVER = "memento";
const MAX_ARG_CHARS = 300;
const MAX_ERROR_CHARS = 500;

function truncatedArgs(args: unknown): Record<string, unknown> | null {
  if (!args || typeof args !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (v === null || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      out[k] = s.length > MAX_ARG_CHARS ? `${s.slice(0, MAX_ARG_CHARS)}…` : s;
    }
  }
  return out;
}

function fireAndForget(p: Promise<unknown>): void {
  const guarded = p.catch((e) => console.error("journalisation tool_call en échec:", e));
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(guarded);
}

function record(row: {
  sub: string | null; tool: string; args: unknown;
  ok: boolean; error: string | null; durationMs: number;
}): void {
  fireAndForget(db.execute(sql`
    insert into tool_calls (server, sub, tool, args, ok, error, duration_ms)
    values (${SERVER}, ${row.sub}, ${row.tool}, ${JSON.stringify(truncatedArgs(row.args))}::jsonb,
            ${row.ok}, ${row.error}, ${row.durationMs})`));
}

/** Enrobe le handler d'un verbe : journalise l'appel (succès, erreur levée, isError MCP). */
export function withCallLog<A, R extends { isError?: boolean }>(
  tool: string,
  sub: string,
  handler: (args: A) => Promise<R>,
): (args: A) => Promise<R> {
  return async (args: A) => {
    const t0 = performance.now();
    try {
      const result = await handler(args);
      record({
        sub, tool, args, ok: !result?.isError,
        error: null, durationMs: Math.round(performance.now() - t0),
      });
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      record({
        sub, tool, args, ok: false,
        error: msg.slice(0, MAX_ERROR_CHARS), durationMs: Math.round(performance.now() - t0),
      });
      throw e;
    }
  };
}
