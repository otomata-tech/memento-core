/**
 * Runner de migrations Drizzle — non interactif (à la place de `db:push` qui exige
 * un TTY). Applique les migrations manquantes de drizzle/ d'après le journal.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL manquant");
  process.exit(1);
}

const client = postgres(url, { max: 1 });
const db = drizzle(client);

await migrate(db, { migrationsFolder: "./drizzle" });
await client.end();
console.error("[migrate] migrations appliquées");
