/**
 * Read-before-write (issue: keep the graph alive via context-rich agents).
 *
 * Principle: an agent should not write into a reasonably-sized KB without having
 * first loaded it in full — this avoids duplicates, makes it place the block in the
 * right spot, and gives it all the blockIds to link (graph).
 *
 * The server cannot prove that an agent "read": it proves that it CALLED `mem_load`
 * (the sole token issuer) for the current VERSION of the KB. The token is stateless —
 * HMAC(secret, "<wsId>|<version>") — so no table: it honors the "stateless server".
 * On write, the HMAC is recomputed for the current version: absent → the agent didn't
 * load; stale → the KB has changed since, it must reload.
 *
 * WARN mode (default): the write passes anyway, but we annotate the response and log
 * the miss (compliance measurement before switching to hard blocking).
 */
import { eq, sql } from "drizzle-orm";
import { db, blocks, documents, sections, revisions, usageLogs, workspaces } from "./db.ts";
import { getSetting } from "./workspaces.ts";

// Above this number of blocks, "reading everything" is impractical → the gate is inactive
// (we fall back to search + similarExisting signal). Overridable per KB via the
// "load.threshold.blocks" setting.
const DEFAULT_THRESHOLD_BLOCKS = 200;

export async function loadThreshold(wsId: string): Promise<number> {
  const raw = await getSetting(wsId, "load.threshold.blocks");
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD_BLOCKS;
}

/** KB version = timestamp of its last curated mutation (one revision = one change).
 *  Cheap, monotonic, sufficient for optimistic concurrency. */
export async function getWorkspaceVersion(wsId: string): Promise<string> {
  const [row] = await db.select({ max: sql<string | null>`max(${revisions.createdAt})::text` })
    .from(revisions).where(eq(revisions.workspaceId, wsId));
  return row?.max ?? "genesis";
}

export async function countBlocks(wsId: string): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM mem_blocks b
    JOIN mem_documents d ON d.id = b.document_id
    JOIN mem_sections s ON s.id = d.section_id
    WHERE s.workspace_id = ${wsId}`);
  return Number(row?.n ?? 0);
}

// ── Load token (stateless, HMAC) ─────────────────────────────────────────────
// The secret attests "issued by mem_load": without it, an agent could read the
// version (mem_revisions) and forge a token. If the secret is not configured, the
// feature is INACTIVE (null token, no warn) — clean degradation, no false gate.
const loadSecret = () => Deno.env.get("MEMENTO_LOAD_SECRET") ?? "";

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function makeLoadToken(wsId: string, version: string): Promise<string | null> {
  const secret = loadSecret();
  if (!secret) return null;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${wsId}|${version}`));
  return hex(sig);
}

// ── Full load of a KB ─────────────────────────────────────────────────────────
export async function loadWorkspace(wsId: string) {
  const [blockCount, threshold, version] = await Promise.all([
    countBlocks(wsId), loadThreshold(wsId), getWorkspaceVersion(wsId),
  ]);

  if (blockCount > threshold) {
    // Too big for a full load: the gate does not apply to this KB.
    return {
      loaded: false as const, blockCount, threshold,
      reason: `KB too large for a full load (${blockCount} blocks > threshold ${threshold}). ` +
        `Use mem_doctrine + mem_search/mem_list to target; the read-before-write guardrail does not apply here.`,
    };
  }

  const rows = await db.select({
    blockId: blocks.id, type: blocks.type, content: blocks.content,
    blockPos: blocks.position, verifiedAt: blocks.verifiedAt,
    docId: documents.id, docTitle: documents.title, docStatus: documents.status, docPos: documents.position,
    sectionId: sections.id, sectionTitle: sections.title, sectionSlug: sections.slug, sectionPos: sections.position,
  })
    .from(blocks)
    .innerJoin(documents, eq(blocks.documentId, documents.id))
    .innerJoin(sections, eq(documents.sectionId, sections.id))
    .where(eq(sections.workspaceId, wsId))
    .orderBy(sections.position, documents.position, blocks.position);

  // Groups into ordered documents (the agent reads a structured corpus, not a heap of blocks).
  const docMap = new Map<string, {
    id: string; title: string; status: string; section: string;
    blocks: { id: string; type: string; content: string; verifiedAt: Date | null }[];
  }>();
  for (const r of rows) {
    let d = docMap.get(r.docId);
    if (!d) {
      d = { id: r.docId, title: r.docTitle, status: r.docStatus, section: r.sectionTitle, blocks: [] };
      docMap.set(r.docId, d);
    }
    d.blocks.push({ id: r.blockId, type: r.type, content: r.content, verifiedAt: r.verifiedAt });
  }

  return {
    loaded: true as const,
    blockCount, threshold, version,
    loadToken: await makeLoadToken(wsId, version),
    documents: [...docMap.values()],
  };
}

// ── Read-before-write guardrail (WARN mode) ──────────────────────────────────
export type LoadGate = { ok: boolean; warning?: string };

/**
 * Verifies, BEFORE a write, that the agent loaded the KB at the current version.
 * WARN mode: never throws — returns a warning (and logs the miss) that the handler
 * attaches to its response. Inactive if the KB exceeds the threshold or if the secret
 * is not configured.
 */
export async function loadGate(
  sub: string, wsId: string, verb: string, loadToken: string | undefined,
): Promise<LoadGate> {
  if (!loadSecret()) return { ok: true }; // feature inactive (not configured)

  const blockCount = await countBlocks(wsId);
  const threshold = await loadThreshold(wsId);
  if (blockCount > threshold) return { ok: true }; // gate inactive on large KBs

  const version = await getWorkspaceVersion(wsId);
  const expected = await makeLoadToken(wsId, version);
  if (loadToken && loadToken === expected) return { ok: true };

  const [ws] = await db.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, wsId)).limit(1);
  const slug = ws?.slug ?? "";
  const cause = loadToken ? "stale token (the KB has changed since your mem_load)" : "missing token (you didn't call mem_load)";
  const warning =
    `Write without a full load of the KB: ${cause}. ` +
    `Call mem_load("${slug}") first then pass back its loadToken — this avoids duplicates, ` +
    `makes you place the block in the right spot and gives you the blockIds to link (CONTRADICTS/SUPERSEDES/DEPENDS_ON). ` +
    `[warn mode: the write passed anyway]`;

  // Logs the miss to measure compliance (kind reserved outside public USAGE_KINDS).
  await db.insert(usageLogs).values({
    userId: sub, workspaceSlug: slug, verb, kind: "load-gate-miss",
    summary: cause, detail: `blocs=${blockCount} seuil=${threshold} version=${version}`,
  }).catch(() => {}); // best-effort: a telemetry failure never breaks the write

  return { ok: false, warning };
}
