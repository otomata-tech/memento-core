<script setup lang="ts">
// « Boucle » — la file de validation comme porte d'entrée : inbox d'ingestions ·
// revue propose-valide (CONFIRM/ENRICH/CONTRADICT verrouillé/OBSOLETE) · journal des révisions.
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, type IngestionSummary, type IngestionDetail, type IngestionChange, type Revision } from "../api";
import AppShell from "../components/AppShell.vue";
import { renderMd } from "../lib/blocks";
import { toast } from "../lib/toast";

const route = useRoute();
const router = useRouter();

const ws = ref<string>(route.params.ws as string);
const list = ref<IngestionSummary[]>([]);
const detail = ref<IngestionDetail | null>(null);
const revisions = ref<Revision[]>([]);
const selected = reactive<Record<string, boolean>>({});
const befores = reactive<Record<string, string>>({}); // contenu actuel des blocs ciblés par update_block → diff
const editing = reactive<Record<string, boolean>>({}); // changes ouverts en édition en place
const editBuf = reactive<Record<string, any>>({});     // buffer d'édition par change
const fbOpen = reactive<Record<string, boolean>>({});  // zone de feedback ouverte par change
const fbBuf = reactive<Record<string, string>>({});    // feedback humain par change
const note = ref("");                                  // note de revue globale (→ agent)
const busy = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);

const STATUS_LABEL: Record<string, string> = {
  PROPOSED: "proposée", APPLIED: "appliquée", REJECTED: "rejetée",
  PARTIAL: "partielle", CHANGES_REQUESTED: "renvoyée à l'agent",
};
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s.toLowerCase();
const actionable = computed(() => ["PROPOSED", "PARTIAL", "CHANGES_REQUESTED"].includes(detail.value?.status ?? ""));
const editableOps = new Set(["add_block", "update_block", "add_document"]);

// Un changement est sélectionnable s'il n'est ni appliqué ni une contradiction (jamais auto-appliquée).
const selectable = (c: IngestionChange) => !c.applied && c.class !== "CONTRADICT";
const acceptIds = computed(() => detail.value?.changes.filter((c) => selectable(c) && selected[c.id]).map((c) => c.id) ?? []);
const blockOps = new Set(["attach_source", "detach_source", "link_blocks", "update_block", "set_block_type", "verify_block", "move_block", "delete_block"]);
function targetBlockId(c: IngestionChange): string | null {
  const p = c.payload as Record<string, unknown>;
  const id = (p?.blockId ?? p?.id) as string | undefined;
  return blockOps.has(c.op) && typeof id === "string" ? id : null;
}

// Le contenu EFFECTIF d'un changement (ce qui sera écrit), pas seulement le rationale (le pourquoi).
// On valide à l'aveugle si on ne le voit pas — surtout pour add_block, où il n'existe nulle part ailleurs.
function changeBody(c: IngestionChange): { kind: string; md: string } | null {
  const p = c.payload as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  if (c.op === "add_block") { const md = s(p.content); return md.trim() ? { kind: s(p.type) || "BLOC", md } : null; }
  if (c.op === "update_block") { const md = s(p.content); return md.trim() ? { kind: "nouveau contenu", md } : null; }
  if (c.op === "add_document") {
    const parts: string[] = [];
    if (s(p.title)) parts.push(`# ${s(p.title)}`);
    if (s(p.summary)) parts.push(s(p.summary));
    if (typeof p.blocks === "string") parts.push(s(p.blocks));
    else if (Array.isArray(p.blocks)) parts.push(...(p.blocks as unknown[]).map((b) => s((b as Record<string, unknown>)?.content)).filter(Boolean));
    return parts.length ? { kind: "DOCUMENT", md: parts.join("\n\n") } : null;
  }
  return null;
}
// Pour les ops sans corps textuel (set_block_type, link_blocks, attach_source…) : les args concrets, rien de caché.
function payloadPreview(c: IngestionChange): string {
  const p = c.payload as Record<string, unknown>;
  return Object.entries(p)
    .filter(([k]) => !["content", "reason", "clientKey", "blocks"].includes(k))
    .map(([k, v]) => { const t = typeof v === "string" ? v : JSON.stringify(v); return `${k}: ${t.length > 80 ? t.slice(0, 80) + "…" : t}`; })
    .join("  ·  ");
}
// Mémoïse par id pour ne pas re-parser à chaque render du template.
const bodies = computed(() => Object.fromEntries((detail.value?.changes ?? []).map((c) => [c.id, changeBody(c)])));

const esc = (s: string) => s.replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]!));
// Diff mot-à-mot par LCS (O(n·m), suffisant pour un bloc) — segments égaux / ajoutés / retirés.
function wordDiff(a: string, b: string): { t: "eq" | "add" | "del"; s: string }[] {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/), n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { t: "eq" | "add" | "del"; s: string }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) out.push({ t: "eq", s: A[i++] }), j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: "del", s: A[i++] });
    else out.push({ t: "add", s: B[j++] });
  }
  while (i < n) out.push({ t: "del", s: A[i++] });
  while (j < m) out.push({ t: "add", s: B[j++] });
  return out;
}
// HTML du diff avant→après pour un update_block, si l'état actuel du bloc a pu être chargé.
function diffHtml(c: IngestionChange): string | null {
  const body = bodies.value[c.id];
  if (c.op !== "update_block" || befores[c.id] == null || !body) return null;
  return wordDiff(befores[c.id], body.md)
    .map((g) => g.t === "eq" ? esc(g.s) : g.t === "add" ? `<ins>${esc(g.s)}</ins>` : `<del>${esc(g.s)}</del>`)
    .join("");
}

// ── Tier 1 : édition en place (l'humain prend le stylo avant l'application) ──
// Champs textuels éditables d'un change → buffer initial (copie profonde).
function editableFields(c: IngestionChange) {
  const p = c.payload as Record<string, any>;
  if (c.op === "add_document") return {
    title: typeof p.title === "string" ? p.title : "",
    blocks: Array.isArray(p.blocks) ? p.blocks.map((b: any) => ({ type: b?.type ?? "PROSE", content: b?.content ?? "" })) : [],
  };
  return { content: typeof p.content === "string" ? p.content : "" };
}
function startEdit(c: IngestionChange) { editBuf[c.id] = JSON.parse(JSON.stringify(editableFields(c))); editing[c.id] = true; }
function cancelEdit(id: string) { editing[id] = false; delete editBuf[id]; }
// Buffer → patch payload (fusionné côté serveur sur le payload d'origine).
function editPatch(c: IngestionChange): Record<string, unknown> {
  const b = editBuf[c.id];
  return c.op === "add_document" ? { title: b.title, blocks: b.blocks } : { content: b.content };
}
const editsPayload = () => (detail.value?.changes ?? [])
  .filter((c) => editing[c.id] && selectable(c) && selected[c.id])
  .map((c) => ({ id: c.id, payload: editPatch(c) }));

// ── Tier 2 : feedback → renvoyer à l'agent (ping-pong) ──
function feedbackItems(): { changeId?: string; body: string }[] {
  const items: { changeId?: string; body: string }[] = [];
  for (const c of detail.value?.changes ?? []) { const body = fbBuf[c.id]?.trim(); if (body) items.push({ changeId: c.id, body }); }
  return items;
}
const hasFeedback = computed(() => note.value.trim().length > 0 || feedbackItems().length > 0);

async function loadAll() {
  loading.value = true; error.value = null;
  try {
    ws.value = route.params.ws as string;
    const [ings, revs] = await Promise.all([api.ingestions(ws.value), api.revisions(ws.value)]);
    list.value = ings.ingestions;
    revisions.value = revs.revisions;
    const wanted = (route.query.ing as string)
      ?? list.value.find((i) => i.status === "PROPOSED" || i.status === "PARTIAL")?.id
      ?? list.value[0]?.id;
    if (wanted) await loadDetail(wanted);
    else detail.value = null;
  } catch (e) { error.value = msg(e); }
  finally { loading.value = false; }
}
async function loadDetail(id: string) {
  detail.value = await api.ingestion(id);
  for (const r of [selected, befores, editing, editBuf, fbOpen, fbBuf]) for (const k of Object.keys(r)) delete (r as any)[k];
  note.value = "";
  for (const c of detail.value.changes) selected[c.id] = selectable(c); // pré-cochés par défaut
  // État actuel des blocs ciblés par update_block → permet le diff avant/après.
  await Promise.all(detail.value.changes
    .filter((c) => c.op === "update_block")
    .map(async (c) => {
      const bid = targetBlockId(c);
      if (!bid) return;
      try { befores[c.id] = (await api.block(bid)).content; } catch { /* bloc inaccessible → pas de diff, fallback nouveau contenu */ }
    }));
}
function selectIngestion(id: string) { router.push({ path: `/w/${ws.value}/loop`, query: { ing: id } }); }

async function apply() {
  if (!detail.value || !acceptIds.value.length) return;
  busy.value = true; error.value = null;
  const n = acceptIds.value.length;
  try { await api.applyIngestion(detail.value.id, acceptIds.value, editsPayload()); toast(`${n} changement(s) appliqué(s)`, "ok"); await refresh(); }
  catch (e) { error.value = msg(e); toast(error.value, "err"); } finally { busy.value = false; }
}
async function rejectAll() {
  if (!detail.value) return;
  busy.value = true; error.value = null;
  try { await api.rejectIngestion(detail.value.id); toast("Ingestion rejetée", "ok"); await refresh(); }
  catch (e) { error.value = msg(e); toast(error.value, "err"); } finally { busy.value = false; }
}
async function sendBack() {
  if (!detail.value || !hasFeedback.value) return;
  busy.value = true; error.value = null;
  try {
    await api.requestChanges(detail.value.id, { note: note.value.trim() || undefined, items: feedbackItems() });
    toast("Renvoyée à l'agent pour révision", "ok");
    await refresh();
  } catch (e) { error.value = msg(e); toast(error.value, "err"); } finally { busy.value = false; }
}
async function refresh() {
  const id = detail.value?.id;
  const [ings, revs] = await Promise.all([api.ingestions(ws.value), api.revisions(ws.value)]);
  list.value = ings.ingestions; revisions.value = revs.revisions;
  if (id) await loadDetail(id);
}
function openGraph(id: string) { router.push(`/w/${ws.value}/graph/${id}`); }
function msg(e: unknown): string {
  const s = String(e instanceof Error ? e.message : e);
  return /403|interdit|forbidden|curator|admin/i.test(s) ? "réservé aux curateurs/admins" : s;
}

watch(() => route.fullPath, loadAll, { immediate: true });
</script>

<template>
  <AppShell page="loop" :ws="ws">
    <template #crumbs>
      <span>boucle<template v-if="detail"> · <b>{{ detail.id.slice(0, 8) }}</b> ({{ statusLabel(detail.status) }})</template></span>
    </template>

    <div class="bd loop">
      <!-- Inbox -->
      <div class="inbox">
        <div class="eb" style="margin-bottom:10px">Ingestions</div>
        <div v-for="i in list" :key="i.id" class="ing"
          :class="{ on: i.id === detail?.id, done: i.status === 'APPLIED' || i.status === 'REJECTED' }"
          @click="selectIngestion(i.id)">
          <span class="stat" :class="i.status === 'PROPOSED' ? 'prop' : i.status === 'CHANGES_REQUESTED' ? 'req' : 'appl'">{{ statusLabel(i.status) }}</span>
          <div class="it">{{ i.title }}</div>
          <div class="by">{{ i.createdBy || "—" }} · {{ i.counts.pending }} en attente</div>
        </div>
        <p v-if="!list.length && !loading" class="muted" style="font-size:12px;margin-top:10px">Aucune ingestion.</p>
        <p class="mono" style="font-size:11px;color:var(--color-mute);margin-top:14px;line-height:1.5">la file de validation est la porte d'entrée, pas un onglet caché.</p>
      </div>

      <!-- Revue -->
      <div class="review">
        <template v-if="detail">
          <div class="eb">Revue propose-valide</div>
          <h2 class="rtitle">{{ detail.title }}</h2>
          <p class="rmeta">{{ detail.summary }} · {{ detail.counts.total }} changement(s) classés. Rien n'est appliqué seul.</p>
          <p v-if="detail.status === 'CHANGES_REQUESTED'" class="reqbanner">
            ↩ Renvoyée à l'agent — en attente d'une nouvelle proposition (même clientKey).
            <template v-if="detail.reviewNote"><br><b>Note de revue :</b> {{ detail.reviewNote }}</template>
          </p>

          <div v-for="c in detail.changes" :key="c.id" class="chg"
            :class="{ flagged: c.class === 'CONTRADICT', sel: selectable(c) && selected[c.id], done: c.applied }">
            <div class="chghead">
              <span class="cls" :class="'cls-' + c.class">{{ c.class }}</span>
              <span class="op">{{ c.op }}</span>
              <span class="tgt">{{ c.target }}</span>
              <span v-if="c.edited" class="editmark">✎ édité</span>
              <button v-if="targetBlockId(c)" class="btn vbtn" style="font-size:11.5px;padding:3px 9px" @click="openGraph(targetBlockId(c)!)">⌖ voir le bloc</button>
            </div>

            <!-- Édition en place (Tier 1) -->
            <div v-if="editing[c.id]" class="editor">
              <template v-if="c.op === 'add_document'">
                <input class="ein" v-model="editBuf[c.id].title" placeholder="titre du document" />
                <div v-for="(b, bi) in editBuf[c.id].blocks" :key="bi" class="eblk">
                  <span class="btype">{{ b.type }}</span>
                  <textarea class="eta" v-model="b.content" rows="3"></textarea>
                </div>
              </template>
              <textarea v-else class="eta" v-model="editBuf[c.id].content" rows="4"></textarea>
              <div class="erow"><button class="btn ghost" @click="cancelEdit(c.id)">annuler l'édition</button><span class="ehint mono">tes modifs seront écrites à l'application</span></div>
            </div>
            <!-- Affichage du contenu effectif -->
            <template v-else>
              <div v-if="bodies[c.id]" class="cbody">
                <span class="btype">{{ diffHtml(c) ? "modification (avant → après)" : bodies[c.id]!.kind }}</span>
                <div v-if="diffHtml(c)" class="btext diff" v-html="diffHtml(c)" />
                <div v-else class="btext" v-html="renderMd(bodies[c.id]!.md)" />
              </div>
              <div v-else-if="payloadPreview(c)" class="cbody mono">{{ payloadPreview(c) }}</div>
            </template>

            <p v-if="c.rationale" class="rat"><span class="ratlbl">pourquoi</span> {{ c.rationale }}</p>

            <!-- Feedback existant (ping-pong) -->
            <div v-if="c.feedback?.length" class="fblist">
              <div v-for="(f, fi) in c.feedback" :key="fi" class="fbitem">
                <span class="fbwho">{{ f.authorKind === 'agent' ? '🤖' : '🧑' }}</span>
                <span class="fbbody">{{ f.body }}</span>
              </div>
            </div>
            <!-- Nouveau retour pour l'agent -->
            <div v-if="fbOpen[c.id] && !c.applied" class="fbbox">
              <textarea class="eta" v-model="fbBuf[c.id]" rows="2" placeholder="retour pour l'agent sur ce changement…"></textarea>
            </div>

            <div v-if="c.applied" class="lock" style="color:var(--color-strong-ink)">✓ appliqué</div>
            <div v-else-if="c.class === 'CONTRADICT'" class="lock">🔒 contradiction — jamais auto-appliquée <span class="mono" style="color:var(--color-faint)">→ remonte à l'expert</span></div>
            <div v-else class="act">
              <button class="btn" :class="selected[c.id] ? 'go' : ''" @click="selected[c.id] = !selected[c.id]">
                {{ selected[c.id] ? "✓ accepté" : "○ accepter" }}
              </button>
              <button v-if="editableOps.has(c.op) && !editing[c.id]" class="btn ghost" @click="startEdit(c)">✎ éditer</button>
              <button class="btn ghost" :class="{ on: fbOpen[c.id] }" @click="fbOpen[c.id] = !fbOpen[c.id]">💬 commenter</button>
            </div>
          </div>

          <div class="applybar" v-if="actionable">
            <button class="btn primary" :disabled="busy || !acceptIds.length" @click="apply">Appliquer la sélection ({{ acceptIds.length }})</button>
            <button class="btn sendback" :disabled="busy || !hasFeedback" @click="sendBack">↩ Renvoyer à l'agent</button>
            <button class="btn no" :disabled="busy" @click="rejectAll">Tout rejeter</button>
            <span class="hint">une MemRevision par op · réversible</span>
          </div>
          <div class="notebox" v-if="actionable">
            <textarea class="eta" v-model="note" rows="2" placeholder="note de revue globale pour l'agent (optionnel) — ex. « garde le verbatim mais sépare le hero en 2 documents »"></textarea>
          </div>
          <p v-if="error" class="warn-card" style="margin-top:10px">{{ error }}</p>
        </template>
        <p v-else-if="loading" class="muted">Chargement…</p>
        <template v-else>
          <h2 class="rtitle">Aucune ingestion</h2>
          <p class="rmeta">La file se remplit quand un agent propose des changements
            (<span class="mono">mem_stage_changes</span>) ; tu les valides ici, op par op.
            Aucune contradiction n'est jamais auto-appliquée.</p>
        </template>
      </div>

      <!-- Journal -->
      <div class="journal">
        <div class="eb" style="margin-bottom:8px">Journal</div>
        <div v-for="r in revisions" :key="r.id" class="jrow">
          <div class="jh"><span class="jop">{{ r.op }}</span><span class="jw">{{ r.actor }}</span></div>
          <div class="jt">{{ r.targetType }}<span v-if="r.targetId"> · {{ r.targetId.slice(0, 8) }}</span></div>
          <div class="jm">{{ r.actorKind === "agent" ? "🤖" : "🧑" }} {{ r.reason || "—" }}</div>
        </div>
        <p v-if="!revisions.length" class="muted" style="font-size:12px">Aucune révision.</p>
      </div>
    </div>
  </AppShell>
</template>
