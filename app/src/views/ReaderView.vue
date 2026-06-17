<script setup lang="ts">
// « Lire » — page d'accueil : épine (sections + doctrine) · colonne de blocs typés ·
// dossier de provenance du bloc focalisé. Tout l'état dérive de l'URL (deep-link).
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { supabase } from "../auth";
import { api, type Doctrine, type DocumentView, type DocMeta, type Revision, type SearchResult } from "../api";
import AppShell from "../components/AppShell.vue";
import SectionSpine from "../components/SectionSpine.vue";
import BlockRow from "../components/BlockRow.vue";
import BlockDossier from "../components/BlockDossier.vue";
import DoctrinePanel from "../components/DoctrinePanel.vue";

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

async function reloadDoctrine() {
  doctrine.value = await api.doctrine(ws.value);
}

/** Journal de révisions : réservé aux lecteurs connectés (un anonyme sur une KB
 *  publique n'a pas à voir l'identité des contributeurs). */
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
      sectionDocs.value = []; activeSectionId.value = null; doc.value = null;
    }

    // Mode recherche
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
      if (sid) await loadSection(sid, true); // navigue vers le 1er doc
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
      <span v-if="searchMode">recherche · <b>« {{ q }} »</b></span>
      <span v-else-if="doc"><b>{{ doc.document.title }}</b><template v-if="focusedBlock"> · bloc {{ focusedBlock.id.slice(0, 8) }}</template></span>
      <span v-else>carte</span>
    </template>

    <div class="bd reader">
      <SectionSpine v-if="doctrine"
        :preamble="doctrine.preamble" :tree="doctrine.tree"
        :active-section-id="activeSectionId" :active-doc-id="doc?.document.id ?? null" :docs="sectionDocs"
        @select="selectSection" @open-doc="openDoc" @open-doctrine="showDoctrine = true" />

      <!-- Recherche -->
      <div v-if="searchMode" class="doc">
        <div class="eb">Recherche</div>
        <h1 class="title">« {{ q }} »</h1>
        <p class="summary">{{ searchResult?.total ?? 0 }} bloc(s) trouvé(s)</p>
        <div v-for="h in searchResult?.hits ?? []" :key="h.blockId" class="block role-mute"
          @click="openHit(h.docPath)">
          <div class="bmeta"><span class="badge">{{ h.type }}</span><span class="gx">{{ h.sectionPath }}</span></div>
          <div class="bbody"><div class="btext" v-html="highlight(h.snippet)" /></div>
        </div>
        <p v-if="searchResult && !searchResult.hits.length" class="muted">Aucun résultat.</p>
      </div>

      <!-- Lecteur -->
      <div v-else class="doc">
        <template v-if="doc">
          <h1 class="title">{{ doc.document.title }}</h1>
          <div v-if="doc.document.summary" class="summary">{{ doc.document.summary }}</div>
          <BlockRow v-for="b in doc.blocks" :key="b.id" :block="b"
            :focused="b.id === focusedBlock?.id" :deprecated="deprecated"
            @select="focusBlock(b.id)" @graph="openGraph" />
          <p v-if="!doc.blocks.length" class="muted">Document sans bloc.</p>
        </template>
        <p v-else-if="loading" class="muted">Chargement…</p>
        <p v-else-if="error" class="muted" style="color:var(--color-weak-ink)">{{ error }}</p>
        <p v-else class="muted">Sélectionne une section.</p>
      </div>

      <!-- Dossier -->
      <BlockDossier v-if="!searchMode && focusedBlock" :block="focusedBlock" :history="focusedHistory"
        @refresh="reloadDoc" @graph="openGraph" />
      <div v-else-if="!searchMode" class="dossier role-mute"><div class="eb">Dossier</div><p class="muted" style="margin-top:8px">Sélectionne un bloc.</p></div>
    </div>

    <DoctrinePanel v-if="showDoctrine && doctrine" :workspace="ws" :doctrine="doctrine"
      @close="showDoctrine = false" @saved="reloadDoctrine" />
  </AppShell>
</template>
