/**
 * Memento admin CLI — access management (orgs, members, workspace assignment).
 * Targets the DB pointed to by DATABASE_URL (Supabase direct for prod, local otherwise).
 *
 *   npm run admin -- whoami <email>                 # Supabase sub of an email (auth.users table)
 *   npm run admin -- org-create <slug> <name>
 *   npm run admin -- member-add <org-slug> <email|sub> <role=member|admin>
 *   npm run admin -- ws-assign <ws-slug> <org-slug>
 *   npm run admin -- list
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db, client, orgs, memberships, workspaces } from "./db.js";

async function resolveSub(emailOrSub: string): Promise<string> {
  if (!emailOrSub.includes("@")) return emailOrSub;
  const rows = await db.execute<{ id: string }>(
    sql`select id::text as id from auth.users where email = ${emailOrSub} limit 1`,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`No Supabase user for ${emailOrSub} (auth.users table missing locally?)`);
  return id;
}

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  switch (cmd) {
    case "whoami":
      console.log(await resolveSub(a[0]));
      break;
    case "org-create": {
      const [o] = await db.insert(orgs).values({ slug: a[0], name: a[1] ?? a[0] }).returning();
      console.log(`org ${o.slug} (${o.id})`);
      break;
    }
    case "member-add": {
      const [org] = await db.select().from(orgs).where(eq(orgs.slug, a[0])).limit(1);
      if (!org) throw new Error(`org not found: ${a[0]}`);
      const sub = await resolveSub(a[1]);
      await db.insert(memberships).values({ orgId: org.id, userId: sub, role: a[2] ?? "member" })
        .onConflictDoUpdate({ target: [memberships.orgId, memberships.userId], set: { role: a[2] ?? "member" } });
      console.log(`member ${sub} → ${org.slug} (${a[2] ?? "member"})`);
      break;
    }
    case "ws-assign": {
      const [org] = await db.select().from(orgs).where(eq(orgs.slug, a[1])).limit(1);
      if (!org) throw new Error(`org not found: ${a[1]}`);
      const r = await db.update(workspaces).set({ orgId: org.id }).where(eq(workspaces.slug, a[0])).returning();
      if (r.length === 0) throw new Error(`workspace not found: ${a[0]}`);
      console.log(`workspace ${a[0]} → org ${org.slug}`);
      break;
    }
    case "list": {
      const os = await db.select().from(orgs);
      for (const o of os) {
        const ms = await db.select().from(memberships).where(eq(memberships.orgId, o.id));
        const ws = await db.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.orgId, o.id));
        console.log(`org ${o.slug}: members=${ms.map((m) => m.role + ":" + m.userId.slice(0, 8)).join(",") || "-"} | workspaces=${ws.map((w) => w.slug).join(",") || "-"}`);
      }
      break;
    }
    default:
      console.error("commands: whoami | org-create | member-add | ws-assign | list");
      process.exit(1);
  }
  await client.end();
}

main().catch(async (e) => { console.error("[admin]", e.message); await client.end().catch(() => {}); process.exit(1); });
