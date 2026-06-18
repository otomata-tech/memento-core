<script setup lang="ts">
// "Read" — home page: spine (sections + doctrine) · column of typed blocks ·
// provenance card of the focused block. All state derives from the URL (deep-link).
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { supabase } from "../auth";
import { api, type Doctrine, type DocumentView, type DocMeta, type Revision, type SearchResult } from "../api";
import AppShell from "../components/AppShell.vue";
import SectionSpine from "../components/SectionSpine.vue";
import BlockRow from "../components/BlockRow.vue";
import BlockDossier from "../components/BlockDossier.vue";
import DoctrinePanel from "../components/DoctrinePanel.vue";
import AgentChat from "../components/AgentChat.vue";

const route = useRoute();
const router = useRouter();

const ws = ref<string>(route.params.ws as string);
const doctrine = ref<Doctrine | null>(null);
const revisions = ref<Revision[]>([]);
const activeSectionId = ref<string | null>(null);
const sectionDocs = ref<DocMeta[]>([]);
const doc = ref<DocumentView | null>(null);
const focusedId = ref<string | null>(null);
const searchMode = ref(false);
const searchResult = ref<SearchResult | null>(null);
const q = ref("");
const loading = ref(false);
const error = ref<string | null>(null);
const showDoctrine = ref(false);
const showAgent = ref(false);
// Agent mode is offered on a public KB (anonymous) OR to a signed-in user
// (the agent backend checks real access; the viewer only shows what it can read).
const isPublicKb = ref(false);
const isLoggedIn = ref(false);
const agentAvailable = computed(() => isPublicKb.value || isLoggedIn.value);

async function reloadDoctrine() {
  doctrine.value = await api.doctrine(ws.value);
}

/** Revision log: restricted to signed-in readers (an anonymous user on a public
 *  KB has no business seeing contributor identities). */
async function loadRevisions(slug: string): Promise<Revision[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];
  return (await api.revisions(slug)).revisions;
}

const focusedBlock = computed(() =>
  doc.value?.blocks.find((b) => b.id === focusedId.value) ?? doc.value?.blocks[0] ?? null);
const focusedHistory = computed(() =>
  focusedBlock.value ? revisions.value.filter((r) => r.targetId === focusedBlock.value!.id) : []);
const deprecated = computed(() => doc.value?.document.status === "DEPRECATED");

function firstSectionId(): string | null { return doctrine.value?.tree[0]?.id ?? null; }

function selectSection(id: string) {
  if (id === activeSectionId.value && doc.value) return;
  loadSection(id, /*navigate*/ true);
}
async function loadSection(id: string, navigate: boolean) {
  activeSectionId.value = id;
  const s = await api.section(id);
  sectionDocs.value = s.documents;
  if (navigate && s.documents.length) router.push(`/w/${ws.value}/doc/${s.documents[0].id}`);
}
function openDoc(id: string) { router.push(`/w/${ws.value}/doc/${id}`); }
function focusBlock(id: string) {
  router.push({ path: `/w/${ws.value}/doc/${doc.value!.document.id}`, query: { block: id } });
}
function openGraph(blockId: string) { router.push(`/w/${ws.value}/graph/${blockId}`); }
async function reloadDoc() {
  if (!doc.value) return;
  doc.value = await api.document(doc.value.document.id);
  revisions.value = await loadRevisions(ws.value);
}

async function syncFromRoute() {
  loading.value = true; error.value = null;
  try {
    const nextWs = route.params.ws as string;
    if (nextWs !== ws.value || !doctrine.value) {
      ws.value = nextWs;
      [doctrine.value, revisions.value] = await Promise.all([
        api.doctrine(nextWs),
        loadRevisions(nextWs),
      ]);
      isPublicKb.value = await api.public.workspaces()
        .then((list) => list.some((w) => w.slug === nextWs)).catch(() => false);
      isLoggedIn.value = !!(await supabase.auth.getSession()).data.session;
      sectionDocs.value = []; activeSectionId.value = null; doc.value = null;
    }

    // Search mode
    if (route.path.endsWith("/search")) {
      searchMode.value = true;
      q.value = (route.query.q as string) ?? "";
      searchResult.value = q.value ? await api.search(ws.value, q.value) : null;
      return;
    }
    searchMode.value = false;

    const docId = route.params.id as string | undefined;
    const path = route.query.path as string | undefined;
    if (!docId && !path) {
      const sid = firstSectionId();
      if (sid) await loadSection(sid, true); // navigate to the 1st doc
      return;
    }
    if (path || doc.value?.document.id !== docId) {
      doc.value = path ? await api.documentByPath(path) : await api.document(docId!);
      const sid = doc.value.document.sectionId;
      if (sid && sid !== activeSectionId.value) {
        activeSectionId.value = sid;
        sectionDocs.value = (await api.section(sid)).documents;
      }
    }
    if (!doc.value) return;
    focusedId.value = (route.query.block as string) ?? doc.value.blocks[0]?.id ?? null;
  } catch (e) { error.value = String(e instanceof Error ? e.message : e); }
  finally { loading.value = false; }
}

function openHit(path: string) { router.push({ path: `/w/${path.split("/")[0]}/doc/_`, query: { path } }); }
function highlight(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/«/g, "<mark>").replace(/»/g, "</mark>");
}

watch(() => route.fullPath, syncFromRoute, { immediate: true });
</script>

<template>
  <AppShell page="reader" :ws="ws">
    <template #crumbs>
      <span v-if="searchMode">search · <b>"{{ q }}"</b></span>
      <span v-else-if="doc"><b>{{ doc.document.title }}</b><template v-if="focusedBlock"> · block {{ focusedBlock.id.slice(0, 8) }}</template></span>
      <span v-else>map</span>
    </template>

    <div class="bd reader">
      <SectionSpine v-if="doctrine"
        :preamble="doctrine.preamble" :tree="doctrine.tree"
        :active-section-id="activeSectionId" :active-doc-id="doc?.document.id ?? null" :docs="sectionDocs"
        @select="selectSection" @open-doc="openDoc" @open-doctrine="showDoctrine = true" />

      <!-- Search -->
      <div v-if="searchMode" class="doc">
        <div class="eb">Search</div>
        <h1 class="title">"{{ q }}"</h1>
        <p class="summary">{{ searchResult?.total ?? 0 }} block(s) found</p>
        <div v-for="h in searchResult?.hits ?? []" :key="h.blockId" class="block role-mute"
          @click="openHit(h.docPath)">
          <div class="bmeta"><span class="badge">{{ h.type }}</span><span class="gx">{{ h.sectionPath }}</span></div>
          <div class="bbody"><div class="btext" v-html="highlight(h.snippet)" /></div>
        </div>
        <p v-if="searchResult && !searchResult.hits.length" class="muted">No results.</p>
      </div>

      <!-- Reader -->
      <div v-else class="doc">
        <template v-if="doc">
          <h1 class="title">{{ doc.document.title }}</h1>
          <div v-if="doc.document.summary" class="summary">{{ doc.document.summary }}</div>
          <BlockRow v-for="b in doc.blocks" :key="b.id" :block="b"
            :focused="b.id === focusedBlock?.id" :deprecated="deprecated"
            @select="focusBlock(b.id)" @graph="openGraph" />
          <p v-if="!doc.blocks.length" class="muted">Document has no blocks.</p>
        </template>
        <p v-else-if="loading" class="muted">Loading…</p>
        <p v-else-if="error" class="muted" style="color:var(--color-weak-ink)">{{ error }}</p>
        <p v-else class="muted">Select a section.</p>
      </div>

      <!-- Card -->
      <BlockDossier v-if="!searchMode && focusedBlock" :block="focusedBlock" :history="focusedHistory"
        @refresh="reloadDoc" @graph="openGraph" />
      <div v-else-if="!searchMode" class="dossier role-mute"><div class="eb">Card</div><p class="muted" style="margin-top:8px">Select a block.</p></div>
    </div>

    <DoctrinePanel v-if="showDoctrine && doctrine" :workspace="ws" :doctrine="doctrine"
      @close="showDoctrine = false" @saved="reloadDoctrine" />

    <!-- Agent mode (public KBs only) -->
    <button v-if="agentAvailable && !showAgent" class="agent-fab" @click="showAgent = true">✦ Ask the agent</button>
    <AgentChat v-if="showAgent && doctrine" :workspace="ws" :kb-name="doctrine.workspace.name"
      @close="showAgent = false" />
  </AppShell>
</template>

<style scoped>
.agent-fab {
  position: fixed; right: 22px; bottom: 22px; z-index: 400;
  font: inherit; font-size: 13px; font-weight: 600; padding: 11px 18px;
  background: var(--color-primary); color: var(--color-surface);
  border: 2px solid var(--color-ink); box-shadow: 4px 4px 0 var(--color-hair-soft); cursor: pointer;
}
.agent-fab:hover { transform: translate(-1px, -1px); box-shadow: 5px 5px 0 var(--color-hair-soft); }
</style>
