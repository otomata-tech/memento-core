/**
 * Realtime "inbox changed" signal — Supabase **Broadcast** (pub/sub), NOT
 * `postgres_changes` (which, with no RLS on mem_ingestions, would stream row content
 * to any subscriber). The channel carries NO data — just a per-user ping; clients
 * refetch through the authorized REST endpoints (/inbox, /ingestions).
 *
 * Topic = `inbox-user-<sub>` (the recipient's auth UUID, NOT a guessable KB slug), so a
 * third party can't subscribe to a base they don't own just by knowing its slug. The
 * server resolves recipients (org members of the owning org + per-KB grant holders) and
 * pings each of THEIR topics. Fire-and-forget + awaited; never throws into the op.
 *
 * (Full lockdown — subscribe-time auth — would need Realtime Authorization: private
 * channels + RLS on realtime.messages. The UUID topic is the pragmatic mitigation.)
 */
import { eq } from "drizzle-orm";
import { db, workspaces, memberships, workspaceGrants } from "./db.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

/** Subs who can act on this KB: org members (if visibility org/public) ∪ grant holders. */
async function inboxRecipients(workspaceId: string): Promise<string[]> {
  const [ws] = await db.select({ orgId: workspaces.orgId, visibility: workspaces.visibility })
    .from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!ws) return [];
  const subs = new Set<string>();
  if (ws.orgId && (ws.visibility === "org" || ws.visibility === "public")) {
    for (const m of await db.select({ u: memberships.userId }).from(memberships).where(eq(memberships.orgId, ws.orgId))) subs.add(m.u);
  }
  for (const g of await db.select({ u: workspaceGrants.userId }).from(workspaceGrants).where(eq(workspaceGrants.workspaceId, workspaceId))) subs.add(g.u);
  return [...subs];
}

export async function broadcastInbox(workspaceId: string | undefined): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY || !workspaceId) return;
  try {
    const recipients = await inboxRecipients(workspaceId);
    if (!recipients.length) return;
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ messages: recipients.map((sub) => ({ topic: `inbox-user-${sub}`, event: "changed", payload: {}, private: false })) }),
    });
  } catch (e) {
    console.error("[realtime] broadcastInbox failed:", e);
  }
}
