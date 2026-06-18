/**
 * Drizzle migration runner — non-interactive (instead of `db:push` which requires
 * a TTY). Applies the missing migrations from drizzle/ based on the journal.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL missing");
  process.exit(1);
}

const client = postgres(url, { max: 1 });
const db = drizzle(client);

await migrate(db, { migrationsFolder: "./drizzle" });
await client.end();
console.error("[migrate] migrations applied");
