/**
 * Écriture curée (Lot 2) — verbes mutants au grain du bloc/document. Toute mutation
 * exige un `reason` et journalise une `MemRevision` (avant/après). Cf. spec §5.2.
 *
 * L'autorisation (membre admin/curator de l'org propriétaire) est vérifiée en amont
 * par les handlers via assertAccess(..., { write: true }).
 */
import { and, eq, sql } from "drizzle-orm";
import { embedBlocks, nearDuplicates } from "./semantic.ts";
import { db, documents, blocks, sections, revisions, sources, blockSources, links, comments } from "./db.ts";
import { workspaceIdForTarget } from "./access.ts";

/** Contexte d'écriture optionnel : relie la révision à une ingestion (Lot 5). */
export type WriteCtx = { ingestionId?: string };

// ── Helpers ───────────────────────────────────────────────────────────────────
export function slugify(input: string, max = 60): string {
  const s = input
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");
  return s || "doc";
}

/** Découpe un markdown en blocs PROSE (paragraphes fusionnés, taille bornée). */
function splitMarkdown(text: string, maxChars = 1500, maxBlocks = 40): string[] {
  const paras = text.replace(/\r\n/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let buf = "";
  for (const p of paras) {
    if (buf && buf.length + p.length + 2 > maxChars) { out.push(buf); buf = p; }
    else buf = buf ? `${buf}\n\n${p}` : p;
    if (out.length >= maxBlocks) break;
  }
  if (buf && out.length < maxBlocks) out.push(buf);
  return out;
}

async function nextPosition(table: "documents" | "blocks", parentCol: string, parentId: string): Promise<number> {
  const t = table === "documents" ? documents : blocks;
  const col = table === "documents" ? documents.sectionId : blocks.documentId;
  void parentCol;
  const [r] = await db.select({ m: sql<number>`coalesce(max(position), -1)` }).from(t).where(eq(col, parentId));
  return Number(r?.m ?? -1) + 1;
}

async function sectionWorkspace(sectionId: string): Promise<string> {
  const [s] = await db.select({ ws: sections.workspaceId }).from(sections).where(eq(sections.id, sectionId)).limit(1);
  if (!s) throw new Error(`Section introuvable: ${sectionId}`);
  return s.ws;
}

export async function revise(
  workspaceId: string, targetType: string, targetId: string | null, op: string,
  reason: string, actor: string, before: unknown, after: unknown,
  ingestionId?: string,
): Promise<void> {
  await db.insert(revisions).values({
    workspaceId, targetType, targetId, op, reason, actor, actorKind: "agent",
    before: before ?? null, after: after ?? null, ingestionId: ingestionId ?? null,
  });
}

// ── Verbes ──────────────────────────────────────────────────────────────────
type BlockInput = { type: string; content: string };

export async function addDocument(
  args: { sectionId: string; title: string; summary?: string; kind?: string; blocks?: string | BlockInput[]; clientKey?: string; reason?: string },
  actor: string,
  ctx?: WriteCtx,
) {
  const wsId = await sectionWorkspace(args.sectionId);

  // Idempotence (#44) : même clientKey sous la même section → no-op, renvoie l'existant.
  if (args.clientKey) {
    const [dup] = await db.select().from(documents)
      .where(and(eq(documents.sectionId, args.sectionId), eq(documents.clientKey, args.clientKey))).limit(1);
    if (dup) {
      const dupBlocks = await db.select().from(blocks).where(eq(blocks.documentId, dup.id)).orderBy(blocks.position);
      return { document: dup, blocks: dupBlocks, deduplicated: true };
    }
  }

  // slug unique sous la section
  let slug = slugify(args.title);
  const existing = await db.select({ slug: documents.slug }).from(documents).where(eq(documents.sectionId, args.sectionId));
  const taken = new Set(existing.map((d) => d.slug));
  if (taken.has(slug)) { let n = 2; while (taken.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}`; }

  const [doc] = await db.insert(documents).values({
    sectionId: args.sectionId, title: args.title, slug,
    summary: args.summary ?? "", kind: args.kind ?? null, status: "ACTIVE",
    clientKey: args.clientKey ?? null,
    position: await nextPosition("documents", "section_id", args.sectionId),
  }).onConflictDoNothing({ target: [documents.sectionId, documents.clientKey] }).returning();
  // Course perdue entre le check et l'insert : l'autre requête a gagné, renvoyer son résultat.
  if (!doc) return addDocument(args, actor, ctx);

  const toInsert: { documentId: string; type: any; content: string; position: number }[] = [];
  if (typeof args.blocks === "string") {
    splitMarkdown(args.blocks).forEach((content, i) => toInsert.push({ documentId: doc.id, type: "PROSE", content, position: i }));
  } else if (Array.isArray(args.blocks)) {
    args.blocks.forEach((b, i) => toInsert.push({ documentId: doc.id, type: b.type as any, content: b.content, position: i }));
  }
  const blockRows = toInsert.length ? await db.insert(blocks).values(toInsert).returning() : [];
  await embedBlocks(blockRows.map((b) => ({ id: b.id, content: b.content }))); // best-effort (NULL si API down)

  await revise(wsId, "document", doc.id, "create", args.reason ?? `ajout document « ${args.title} »`, actor, null, { title: args.title, slug, blocks: blockRows.length }, ctx?.ingestionId);
  return { document: doc, blocks: blockRows };
}

export async function addBlock(
  args: { documentId: string; type: string; content: string; position?: number; clientKey?: string; reason?: string },
  actor: string,
  ctx?: WriteCtx,
) {
  const wsId = await workspaceIdForTarget("document", args.documentId);
  if (!wsId) throw new Error(`Document introuvable: ${args.documentId}`);

  // Idempotence (#44) : même clientKey dans le même document → no-op, renvoie l'existant.
  if (args.clientKey) {
    const [dup] = await db.select().from(blocks)
      .where(and(eq(blocks.documentId, args.documentId), eq(blocks.clientKey, args.clientKey))).limit(1);
    if (dup) return { ...dup, deduplicated: true };
  }

  const [b] = await db.insert(blocks).values({
    documentId: args.documentId, type: args.type as any, content: args.content,
    clientKey: args.clientKey ?? null,
    position: args.position ?? await nextPosition("blocks", "document_id", args.documentId),
  }).onConflictDoNothing({ target: [blocks.documentId, blocks.clientKey] }).returning();
  if (!b) return addBlock(args, actor, ctx); // course perdue check/insert → relit l'existant
  await embedBlocks([{ id: b.id, content: b.content }]); // best-effort
  await revise(wsId, "block", b.id, "create", args.reason ?? "ajout bloc", actor, null, { type: b.type, content: b.content }, ctx?.ingestionId);
  // Signal anti-doublon (#44) : blocs quasi identiques déjà en base — l'agent juge.
  const similar = await nearDuplicates(wsId, { blockId: b.id });
  return similar.length ? { ...b, similarExisting: similar } : b;
}

export async function updateBlock(
  args: { id: string; content?: string; type?: string; reason: string },
  actor: string,
  ctx?: WriteCtx,
) {
  const wsId = await workspaceIdForTarget("block", args.id);
  if (!wsId) throw new Error(`Bloc introuvable: ${args.id}`);
  const [before] = await db.select().from(blocks).where(eq(blocks.id, args.id)).limit(1);
  const patch: Record<string, unknown> = {};
  if (args.content !== undefined) patch.content = args.content;
  if (args.type !== undefined) patch.type = args.type as any;
  const [after] = await db.update(blocks).set(patch).where(eq(blocks.id, args.id)).returning();
  if (args.content !== undefined) await embedBlocks([{ id: after.id, content: after.content }]); // best-effort
  await revise(wsId, "block", args.id, "update", args.reason, actor, before, after, ctx?.ingestionId);
  return after;
}

export async function setBlockType(args: { id: string; type: string; reason: string }, actor: string, ctx?: WriteCtx) {
  const wsId = await workspaceIdForTarget("block", args.id);
  if (!wsId) throw new Error(`Bloc introuvable: ${args.id}`);
  const [before] = await db.select().from(blocks).where(eq(blocks.id, args.id)).limit(1);
  const [after] = await db.update(blocks).set({ type: args.type as any }).where(eq(blocks.id, args.id)).returning();
  await revise(wsId, "block", args.id, "set_type", args.reason, actor, before, after, ctx?.ingestionId);
  return after;
}

export async function deleteBlock(args: { id: string; reason: string }, actor: string, ctx?: WriteCtx) {
  const wsId = await workspaceIdForTarget("block", args.id);
  if (!wsId) throw new Error(`Bloc introuvable: ${args.id}`);
  const [before] = await db.select().from(blocks).where(eq(blocks.id, args.id)).limit(1);
  await db.delete(blocks).where(eq(blocks.id, args.id));
  await revise(wsId, "block", args.id, "delete", args.reason, actor, before, null, ctx?.ingestionId);
  return { deleted: args.id };
}

// ── Sources ───────────────────────────────────────────────────────────────────
/**
 * Attache une source à un bloc. Soit on réutilise une source existante (`sourceId`),
 * soit on en crée une à la volée (`kind` + `title` requis). Une source est autonome
 * et réutilisable : pas de scope workspace (le lien bloc↔source l'est).
 */
export async function attachSource(
  args: {
    blockId: string; sourceId?: string;
    kind?: string; title?: string; ref?: string; citation?: string;
    locator?: string; reason?: string;
  },
  actor: string,
  ctx?: WriteCtx,
) {
  const wsId = await workspaceIdForTarget("block", args.blockId);
  if (!wsId) throw new Error(`Bloc introuvable: ${args.blockId}`);
  let sourceId = args.sourceId;
  let created: typeof sources.$inferSelect | null = null;
  if (!sourceId) {
    if (!args.kind || !args.title) throw new Error("`sourceId`, ou (`kind` + `title`) requis");
    [created] = await db.insert(sources).values({
      kind: args.kind as any, title: args.title,
      ref: args.ref ?? null, citation: args.citation ?? null,
    }).returning();
    sourceId = created.id;
  }
  await db.insert(blockSources)
    .values({ blockId: args.blockId, sourceId, locator: args.locator ?? null })
    .onConflictDoNothing();
  await revise(wsId, "block", args.blockId, "attach_source", args.reason ?? "ajout source", actor, null, { sourceId, locator: args.locator ?? null }, ctx?.ingestionId);
  return { blockId: args.blockId, sourceId, source: created };
}

export async function detachSource(args: { blockId: string; sourceId: string; reason?: string }, actor: string, ctx?: WriteCtx) {
  const wsId = await workspaceIdForTarget("block", args.blockId);
  if (!wsId) throw new Error(`Bloc introuvable: ${args.blockId}`);
  await db.delete(blockSources)
    .where(and(eq(blockSources.blockId, args.blockId), eq(blockSources.sourceId, args.sourceId)));
  await revise(wsId, "block", args.blockId, "detach_source", args.reason ?? "retrait source", actor, { sourceId: args.sourceId }, null, ctx?.ingestionId);
  return { blockId: args.blockId, sourceId: args.sourceId, detached: true };
}

// ── Vérification ───────────────────────────────────────────────────────────────
/** Marque un bloc comme vérifié (horodatage + acteur), ou retire la vérif (`verified:false`). */
export async function verifyBlock(args: { id: string; verified?: boolean; reason?: string }, actor: string, ctx?: WriteCtx) {
  const wsId = await workspaceIdForTarget("block", args.id);
  if (!wsId) throw new Error(`Bloc introuvable: ${args.id}`);
  const [before] = await db.select().from(blocks).where(eq(blocks.id, args.id)).limit(1);
  const verified = args.verified !== false;
  const [after] = await db.update(blocks)
    .set(verified ? { verifiedAt: new Date(), verifiedBy: actor } : { verifiedAt: null, verifiedBy: null })
    .where(eq(blocks.id, args.id)).returning();
  await revise(
    wsId, "block", args.id, verified ? "verify" : "unverify",
    args.reason ?? (verified ? "vérifié" : "vérification retirée"),
    actor, { verifiedAt: before.verifiedAt }, { verifiedAt: after.verifiedAt }, ctx?.ingestionId,
  );
  return { id: args.id, verifiedAt: after.verifiedAt, verifiedBy: after.verifiedBy };
}

// ── Déplacement ────────────────────────────────────────────────────────────────
/**
 * Déplace un bloc : réordonne dans son document, ou le rattache à un autre document
 * du même workspace (`toDocumentId`). Renumérote les positions à plat (0..n-1) dans
 * le(s) document(s) touché(s) — serveur bête, positions toujours denses.
 */
export async function moveBlock(
  args: { id: string; toDocumentId?: string; position?: number; reason: string },
  actor: string,
  ctx?: WriteCtx,
) {
  const wsId = await workspaceIdForTarget("block", args.id);
  if (!wsId) throw new Error(`Bloc introuvable: ${args.id}`);
  const [block] = await db.select().from(blocks).where(eq(blocks.id, args.id)).limit(1);
  const before = { documentId: block.documentId, position: block.position };

  const targetDoc = args.toDocumentId ?? block.documentId;
  if (targetDoc !== block.documentId) {
    const destWs = await workspaceIdForTarget("document", targetDoc);
    if (!destWs) throw new Error(`Document cible introuvable: ${targetDoc}`);
    if (destWs !== wsId) throw new Error("déplacement cross-workspace interdit");
  }

  // Document de destination : frères ordonnés, hors le bloc déplacé, puis insertion.
  const dest = (await db.select({ id: blocks.id }).from(blocks)
    .where(eq(blocks.documentId, targetDoc)).orderBy(blocks.position))
    .filter((b) => b.id !== args.id)
    .map((b) => b.id);
  const idx = args.position === undefined ? dest.length : Math.max(0, Math.min(args.position, dest.length));
  dest.splice(idx, 0, args.id);
  for (let i = 0; i < dest.length; i++) {
    await db.update(blocks)
      .set(dest[i] === args.id ? { position: i, documentId: targetDoc } : { position: i })
      .where(eq(blocks.id, dest[i]));
  }
  // Document source (si différent) : retasser les positions restantes.
  if (targetDoc !== block.documentId) {
    const src = (await db.select({ id: blocks.id }).from(blocks)
      .where(eq(blocks.documentId, block.documentId)).orderBy(blocks.position)).map((b) => b.id);
    for (let i = 0; i < src.length; i++) {
      await db.update(blocks).set({ position: i }).where(eq(blocks.id, src[i]));
    }
  }

  const after = { documentId: targetDoc, position: idx };
  await revise(wsId, "block", args.id, "move", args.reason, actor, before, after, ctx?.ingestionId);
  return { id: args.id, ...after };
}

// ── Liens & obsolescence (briques de la boucle d'ingestion — classes CONTRADICT/OBSOLETE) ──
/** Crée un lien typé entre deux blocs du même workspace. */
export async function linkBlocks(
  args: { fromId: string; toId: string; relation: string; note?: string; reason?: string },
  actor: string,
  ctx?: WriteCtx,
) {
  const wsId = await workspaceIdForTarget("block", args.fromId);
  if (!wsId) throw new Error(`Bloc introuvable: ${args.fromId}`);
  const toWs = await workspaceIdForTarget("block", args.toId);
  if (!toWs) throw new Error(`Bloc introuvable: ${args.toId}`);
  if (toWs !== wsId) throw new Error("lien cross-workspace interdit");
  const [l] = await db.insert(links).values({
    fromBlockId: args.fromId, toBlockId: args.toId, relation: args.relation as any,
    note: args.note ?? null, createdBy: actor,
  }).onConflictDoNothing().returning();
  await revise(wsId, "link", l?.id ?? null, "link", args.reason ?? `lien ${args.relation}`, actor, null, { fromId: args.fromId, toId: args.toId, relation: args.relation }, ctx?.ingestionId);
  return l ?? { fromBlockId: args.fromId, toBlockId: args.toId, relation: args.relation, note: "déjà existant" };
}

/** Passe un document en DEPRECATED (obsolescence). `supersededBy` est tracé en révision. */
export async function deprecateDocument(
  args: { id: string; supersededBy?: string; reason: string },
  actor: string,
  ctx?: WriteCtx,
) {
  const wsId = await workspaceIdForTarget("document", args.id);
  if (!wsId) throw new Error(`Document introuvable: ${args.id}`);
  const [before] = await db.select().from(documents).where(eq(documents.id, args.id)).limit(1);
  const [after] = await db.update(documents).set({ status: "DEPRECATED" }).where(eq(documents.id, args.id)).returning();
  await revise(wsId, "document", args.id, "deprecate", args.reason, actor, { status: before.status }, { status: "DEPRECATED", supersededBy: args.supersededBy ?? null }, ctx?.ingestionId);
  return { id: args.id, status: after.status, supersededBy: args.supersededBy ?? null };
}

/** Supprime un lien typé entre deux blocs. */
export async function unlinkBlocks(args: { linkId: string; reason?: string }, actor: string, ctx?: WriteCtx) {
  const [link] = await db.select().from(links).where(eq(links.id, args.linkId)).limit(1);
  if (!link) throw new Error(`Lien introuvable: ${args.linkId}`);
  const wsId = await workspaceIdForTarget("block", link.fromBlockId);
  if (!wsId) throw new Error(`Bloc source introuvable: ${link.fromBlockId}`);
  await db.delete(links).where(eq(links.id, args.linkId));
  await revise(wsId, "link", args.linkId, "unlink", args.reason ?? "retrait lien", actor,
    { fromId: link.fromBlockId, toId: link.toBlockId, relation: link.relation }, null, ctx?.ingestionId);
  return { deleted: args.linkId };
}

// ── Commentaires (annotations, cible polymorphe) ───────────────────────────────
/** Annote un bloc/document/section. Les commentaires sont leur propre trace (author + date). */
export async function addComment(
  args: { targetType: string; targetId: string; body: string; authorKind?: string },
  actor: string,
) {
  const [c] = await db.insert(comments).values({
    targetType: args.targetType as any, targetId: args.targetId, body: args.body,
    author: actor, authorKind: args.authorKind ?? "human",
  }).returning();
  return c;
}

/** Marque un commentaire comme résolu (horodatage). */
export async function resolveComment(args: { id: string }) {
  const [c] = await db.update(comments).set({ resolvedAt: new Date() }).where(eq(comments.id, args.id)).returning();
  if (!c) throw new Error(`Commentaire introuvable: ${args.id}`);
  return { id: c.id, resolvedAt: c.resolvedAt };
}
