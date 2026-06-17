/**
 * Connexion Node (outillage : drizzle-kit, migrate, admin, seed, import).
 * Le schéma est canonique dans ./schema.ts (partagé avec le runtime Deno).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export * from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL manquante");
export const client = postgres(connectionString);
export const db = drizzle(client);
