/**
 * Deno connection (prod Edge Functions runtime). The schema is canonical in
 * ../../../server/src/schema.ts (single source shared with the Node tooling);
 * the deno.json import-map resolves `drizzle-orm/` for the whole graph, including
 * this file outside the functions folder.
 *
 * Supavisor transaction pooler (prepare:false) — ephemeral Edge isolates.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export * from "../../../server/src/schema.ts";

const connectionString = Deno.env.get("DATABASE_URL");
if (!connectionString) throw new Error("DATABASE_URL is missing");
export const client = postgres(connectionString, { prepare: false });
export const db = drizzle(client);
