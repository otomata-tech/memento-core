/**
 * Connexion Deno (runtime prod Edge Functions). Le schéma est canonique dans
 * ../../../server/src/schema.ts (source unique partagée avec l'outillage Node) ;
 * l'import-map de deno.json résout `drizzle-orm/` pour tout le graphe, y compris
 * ce fichier hors du dossier functions.
 *
 * Pooler Supavisor transaction (prepare:false) — isolates éphémères de l'Edge.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export * from "../../../server/src/schema.ts";

const connectionString = Deno.env.get("DATABASE_URL");
if (!connectionString) throw new Error("DATABASE_URL manquante");
export const client = postgres(connectionString, { prepare: false });
export const db = drizzle(client);
