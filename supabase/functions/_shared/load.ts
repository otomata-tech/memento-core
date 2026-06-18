/**
 * Lecture-avant-écriture (issue : faire vivre le graphe via des agents context-riches).
 *
 * Principe : un agent ne devrait pas écrire dans une KB de taille raisonnable sans
 * l'avoir d'abord chargée en entier — ça lui évite les doublons, lui fait placer le
 * bloc au bon endroit, et lui donne tous les blockId pour relier (graphe).
 *
 * Le serveur ne peut pas prouver qu'un agent a « lu » : il prouve qu'il a APPELÉ
 * `mem_load` (seul émetteur du jeton) pour la VERSION courante de la KB. Le jeton est
 * sans état — HMAC(secret, "<wsId>|<version>") — donc pas de table : il respecte le
 * « serveur sans état ». Au write, on recalcule le HMAC pour la version actuelle :
 * absent → l'agent n'a pas chargé ; périmé → la KB a changé depuis, il doit recharger.
 *
 * Mode WARN (défaut) : l'écriture passe quand même, mais on annote la réponse et on
 * journalise le miss (mesure de conformité avant de basculer en blocage dur).
 */
import { eq, sql } from "drizzle-orm";
import { db, blocks, documents, sections, revisions, usageLogs, workspaces } from "./db.ts";
import { getSetting } from "./workspaces.ts";

// Au-dessus de ce nombre de blocs, « tout lire » est impraticable → le gate est inactif
// (on retombe sur recherche + signal similarExisting). Surchargeable par KB via le
// setting "load.threshold.blocks".
const DEFAULT_THRESHOLD_BLOCKS = 200;

export async function loadThreshold(wsId: string): Promise<number> {
  const raw = await getSetting(wsId, "load.threshold.blocks");
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD_BLOCKS;
}

/** Version de la KB = horodatage de sa dernière mutation curée (une révision = un
 *  changement). Pas cher, monotone, suffisant pour de la concurrence optimiste. */
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

// ── Jeton de chargement (sans état, HMAC) ────────────────────────────────────
// Le secret atteste « émis par mem_load » : sans lui, un agent pourrait lire la
// version (mem_revisions) et forger un jeton. Si le secret n'est pas configuré, la
// feature est INACTIVE (jeton null, aucun warn) — dégradation propre, pas de faux gate.
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

// ── Chargement complet d'une KB ──────────────────────────────────────────────
export async function loadWorkspace(wsId: string) {
  const [blockCount, threshold, version] = await Promise.all([
    countBlocks(wsId), loadThreshold(wsId), getWorkspaceVersion(wsId),
  ]);

  if (blockCount > threshold) {
    // Trop gros pour un chargement intégral : le gate ne s'applique pas à cette KB.
    return {
      loaded: false as const, blockCount, threshold,
      reason: `KB trop volumineuse pour un chargement intégral (${blockCount} blocs > seuil ${threshold}). ` +
        `Utilise mem_doctrine + mem_search/mem_list pour cibler ; le garde-fou lecture-avant-écriture ne s'applique pas ici.`,
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

  // Regroupe en documents ordonnés (l'agent lit un fonds structuré, pas un tas de blocs).
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

// ── Garde-fou lecture-avant-écriture (mode WARN) ─────────────────────────────
export type LoadGate = { ok: boolean; warning?: string };

/**
 * Vérifie, AVANT une écriture, que l'agent a chargé la KB à la version courante.
 * Mode WARN : ne lève jamais — renvoie un avertissement (et journalise le miss) que
 * le handler attache à sa réponse. Inactif si la KB dépasse le seuil ou si le secret
 * n'est pas configuré.
 */
export async function loadGate(
  sub: string, wsId: string, verb: string, loadToken: string | undefined,
): Promise<LoadGate> {
  if (!loadSecret()) return { ok: true }; // feature inactive (non configurée)

  const blockCount = await countBlocks(wsId);
  const threshold = await loadThreshold(wsId);
  if (blockCount > threshold) return { ok: true }; // gate inactif sur les grosses KB

  const version = await getWorkspaceVersion(wsId);
  const expected = await makeLoadToken(wsId, version);
  if (loadToken && loadToken === expected) return { ok: true };

  const [ws] = await db.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, wsId)).limit(1);
  const slug = ws?.slug ?? "";
  const cause = loadToken ? "jeton périmé (la KB a changé depuis ton mem_load)" : "jeton absent (tu n'as pas appelé mem_load)";
  const warning =
    `Écriture sans chargement intégral de la KB : ${cause}. ` +
    `Appelle d'abord mem_load("${slug}") puis repasse son loadToken — ça t'évite les doublons, ` +
    `te fait placer le bloc au bon endroit et te donne les blockId pour relier (CONTRADICTS/SUPERSEDES/DEPENDS_ON). ` +
    `[mode warn : l'écriture est passée quand même]`;

  // Journalise le miss pour mesurer la conformité (kind réservé hors USAGE_KINDS publics).
  await db.insert(usageLogs).values({
    userId: sub, workspaceSlug: slug, verb, kind: "load-gate-miss",
    summary: cause, detail: `blocs=${blockCount} seuil=${threshold} version=${version}`,
  }).catch(() => {}); // best-effort : un échec de télémétrie ne casse jamais l'écriture

  return { ok: false, warning };
}
