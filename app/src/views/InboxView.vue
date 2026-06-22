<script setup lang="ts">
// Global inbox — every still-actionable ingestion across ALL the user's orgs/KBs.
// Expand a row to review it in place with the SAME card as the per-KB Loop
// (<IngestionReview>): full detail, per-change selection, edits, contradictions.
import { computed, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api, type InboxItem } from "../api";
import AppShell from "../components/AppShell.vue";
import IngestionReview from "../components/IngestionReview.vue";
import { refreshLoop, shell } from "../stores/shell";

const router = useRouter();
const items = ref<InboxItem[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const open = reactive<Record<string, boolean>>({});

const STATUS_LABEL: Record<string, string> = { PROPOSED: "proposed", PARTIAL: "partial", CHANGES_REQUESTED: "sent back" };
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s.toLowerCase();
const contradictions = (it: InboxItem) => it.counts.byClass?.CONTRADICT ?? 0;

const groups = computed(() => {
  const m = new Map<string, { org: string; items: InboxItem[] }>();
  for (const it of items.value) {
    const key = it.org ?? "—";
    if (!m.has(key)) m.set(key, { org: it.orgName ?? it.org ?? "—", items: [] });
    m.get(key)!.items.push(it);
  }
  return [...m.values()];
});

async function load() {
  loading.value = true; error.value = null;
  try { items.value = (await api.inbox()).ingestions; }
  catch (e) { error.value = String(e instanceof Error ? e.message : e); }
  finally { loading.value = false; }
}
function toggle(it: InboxItem) { open[it.id] = !open[it.id]; }
async function onChanged(it: InboxItem) { await load(); await refreshLoop(it.workspace); }
function review(it: InboxItem) { router.push({ path: `/w/${it.workspace}/loop`, query: { ing: it.id } }); }
// Live: a realtime "inbox changed" ping refetches the list.
watch(() => shell.realtimeTick, load);
load();
</script>

<template>
  <AppShell page="inbox" ws="">
    <template #crumbs><span>inbox<template v-if="items.length"> · <b>{{ items.length }} pending</b></template></span></template>

    <div class="scroll">
    <div class="inbox-page">
      <div class="eb">Pending across all your knowledge bases</div>
      <p class="ipmeta">Everything an agent proposed and that still awaits your decision — every org, every KB. Expand to review and apply right here.</p>

      <p v-if="loading" class="muted">Loading…</p>
      <p v-else-if="error" class="warn-card">{{ error }}</p>
      <p v-else-if="!items.length" class="muted caught">✓ Nothing pending — you're all caught up.</p>

      <div v-for="g in groups" :key="g.org" class="grp">
        <div class="grp-h">{{ g.org }}</div>
        <div v-for="it in g.items" :key="it.id" class="irow" :class="{ open: open[it.id] }">
          <div class="ihead" @click="toggle(it)">
            <span class="stat" :class="it.status === 'PROPOSED' ? 'prop' : it.status === 'CHANGES_REQUESTED' ? 'req' : 'appl'">{{ statusLabel(it.status) }}</span>
            <div class="imain">
              <div class="ititle">{{ it.title }}</div>
              <div class="imeta">
                {{ it.workspaceName }} · {{ it.counts.pending }} pending<span v-if="contradictions(it)" class="cwarn-inline"> · ⚠ {{ contradictions(it) }} contradiction(s)</span><span v-if="it.createdBy"> · {{ it.createdBy }}</span>
              </div>
            </div>
            <span class="exp">{{ open[it.id] ? "▾" : "▸" }}</span>
          </div>

          <div v-if="open[it.id]" class="ibody" @click.stop>
            <IngestionReview :id="it.id" :ws="it.workspace" @changed="onChanged(it)" />
            <p class="reviewlink"><a @click="review(it)">⌅ Open in the {{ it.workspaceName }} loop (journal, full queue)</a></p>
          </div>
        </div>
      </div>
    </div>
    </div>
  </AppShell>
</template>

<style scoped>
.inbox-page { max-width: 820px; margin-inline: auto; padding: 28px 34px; }
.ipmeta { color: var(--color-ink-soft); margin: 4px 0 22px; font-size: 13px; }
.caught { font-size: 15px; color: var(--color-strong-ink); margin-top: 18px; }
.grp { margin-bottom: 22px; }
.grp-h { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--color-faint); margin: 0 0 8px; }
.irow { border: 1px solid var(--color-hair); background: var(--color-surface); margin-bottom: 8px; }
.irow.open { border-color: var(--color-primary); }
.ihead { display: flex; align-items: center; gap: 12px; padding: 12px 14px; cursor: pointer; }
.ihead:hover { background: var(--color-paper-2); }
.stat { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: .04em; padding: 3px 7px; white-space: nowrap; }
.stat.prop { background: var(--color-primary-soft); color: var(--color-primary-ink); }
.stat.req { background: var(--color-accent-soft); color: #173a5e; }
.stat.appl { background: var(--color-paper-2); color: var(--color-mute); }
.imain { min-width: 0; flex: 1; }
.ititle { font-weight: 600; font-size: 14px; line-height: 1.35; overflow-wrap: anywhere; }
.imeta { font-size: 12px; color: var(--color-mute); margin-top: 3px; }
.cwarn-inline { color: var(--color-weak-ink); }
.exp { font-size: 12px; color: var(--color-faint); }
.ibody { border-top: 1px solid var(--color-hair); padding: 14px 16px; }
.reviewlink { margin: 12px 0 0; font-size: 12.5px; }
.reviewlink a { color: var(--color-mute); cursor: pointer; }
.reviewlink a:hover { color: var(--color-ink); }
</style>
