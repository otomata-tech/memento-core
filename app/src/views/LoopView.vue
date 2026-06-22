<script setup lang="ts">
// “Loop” — the validation queue as the entry point: inbox of ingestions ·
// propose-validate review (shared <IngestionReview>) · revisions journal.
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, type IngestionSummary, type Revision } from "../api";
import AppShell from "../components/AppShell.vue";
import IngestionReview from "../components/IngestionReview.vue";
import { refreshLoop, shell } from "../stores/shell";

const route = useRoute();
const router = useRouter();

const ws = ref<string>(route.params.ws as string);
const list = ref<IngestionSummary[]>([]);
const revisions = ref<Revision[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const STATUS_LABEL: Record<string, string> = {
  PROPOSED: "proposed", APPLIED: "applied", REJECTED: "rejected",
  PARTIAL: "partial", CHANGES_REQUESTED: "sent back to agent",
};
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s.toLowerCase();

// Selected ingestion: explicit ?ing= → first actionable → first.
const selectedId = computed<string | null>(() =>
  (route.query.ing as string)
  ?? list.value.find((i) => i.status === "PROPOSED" || i.status === "PARTIAL")?.id
  ?? list.value[0]?.id
  ?? null);

async function loadAll() {
  loading.value = true; error.value = null;
  try {
    ws.value = route.params.ws as string;
    const [ings, revs] = await Promise.all([api.ingestions(ws.value), api.revisions(ws.value)]);
    list.value = ings.ingestions;
    revisions.value = revs.revisions;
  } catch (e) { error.value = msg(e); }
  finally { loading.value = false; }
}
function selectIngestion(id: string) { router.push({ path: `/w/${ws.value}/loop`, query: { ing: id } }); }
async function onChanged() {
  const [ings, revs] = await Promise.all([api.ingestions(ws.value), api.revisions(ws.value)]);
  list.value = ings.ingestions; revisions.value = revs.revisions;
  await refreshLoop(ws.value); // keep the header badges (📥 inbox + Loop) in sync
}
function msg(e: unknown): string {
  const s = String(e instanceof Error ? e.message : e);
  return /403|interdit|forbidden|curator|admin/i.test(s) ? "curators/admins only" : s;
}

watch(() => route.fullPath, loadAll, { immediate: true });
// Live: a realtime "inbox changed" ping refreshes the queue.
watch(() => shell.realtimeTick, () => { if (ws.value) onChanged(); });
</script>

<template>
  <AppShell page="loop" :ws="ws">
    <template #crumbs>
      <span>loop<template v-if="selectedId"> · <b>{{ selectedId.slice(0, 8) }}</b></template></span>
    </template>

    <div class="bd loop">
      <!-- Inbox -->
      <div class="inbox">
        <div class="eb" style="margin-bottom:10px">Ingestions</div>
        <div v-for="i in list" :key="i.id" class="ing"
          :class="{ on: i.id === selectedId, done: i.status === 'APPLIED' || i.status === 'REJECTED' }"
          @click="selectIngestion(i.id)">
          <span class="stat" :class="i.status === 'PROPOSED' ? 'prop' : i.status === 'CHANGES_REQUESTED' ? 'req' : 'appl'">{{ statusLabel(i.status) }}</span>
          <div class="it">{{ i.title }}</div>
          <div class="by">{{ i.createdBy || "—" }} · {{ i.counts.pending }} pending</div>
        </div>
        <p v-if="!list.length && !loading" class="muted" style="font-size:12px;margin-top:10px">No ingestion.</p>
        <p class="mono" style="font-size:11px;color:var(--color-mute);margin-top:14px;line-height:1.5">the validation queue is the entry point, not a hidden tab.</p>
      </div>

      <!-- Review -->
      <div class="review">
        <template v-if="selectedId">
          <div class="eb">Propose-validate review</div>
          <IngestionReview :id="selectedId" :ws="ws" @changed="onChanged" />
        </template>
        <p v-else-if="loading" class="muted">Loading…</p>
        <template v-else>
          <h2 class="rtitle">No ingestion</h2>
          <p class="rmeta">The queue fills up when an agent proposes changes
            (<span class="mono">mem_stage_changes</span>); you validate them here, op by op.
            No contradiction is ever auto-applied.</p>
        </template>
        <p v-if="error" class="warn-card" style="margin-top:10px">{{ error }}</p>
      </div>

      <!-- Journal -->
      <div class="journal">
        <div class="eb" style="margin-bottom:8px">Journal</div>
        <div v-for="r in revisions" :key="r.id" class="jrow">
          <div class="jh"><span class="jop">{{ r.op }}</span><span class="jw">{{ r.actor }}</span></div>
          <div class="jt">{{ r.targetType }}<span v-if="r.targetId"> · {{ r.targetId.slice(0, 8) }}</span></div>
          <div class="jm">{{ r.actorKind === "agent" ? "🤖" : "🧑" }} {{ r.reason || "—" }}</div>
        </div>
        <p v-if="!revisions.length" class="muted" style="font-size:12px">No revision.</p>
      </div>
    </div>
  </AppShell>
</template>
