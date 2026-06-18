/**
 * Node connection (tooling: drizzle-kit, migrate, admin, seed, import).
 * The schema is canonical in ./schema.ts (shared with the Deno runtime).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export * from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL missing");
export const client = postgres(connectionString);
export const db = drizzle(client);
