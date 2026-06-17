<script setup lang="ts">
// Galerie publique : annuaire + recherche plein-texte des KB publiques. Aucune
// authentification — surface de découverte ouverte (cf. mem_set_visibility public).
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, type PublicWorkspace, type PublicSearchHit } from "../api";
import { supabase } from "../auth";

const router = useRouter();
const list = ref<PublicWorkspace[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const authed = ref(false);
const pinnedSlugs = ref<Set<string>>(new Set()); // KB épinglées (pour l'état du bouton 📌)

const q = ref("");
const searching = ref(false);
const hits = ref<PublicSearchHit[] | null>(null);
const total = ref(0);

onMounted(async () => {
  authed.value = !!(await supabase.auth.getSession()).data.session;
  try {
    const tasks: Promise<unknown>[] = [api.public.workspaces().then((w) => { list.value = w; })];
    // Loggé : on connaît l'état d'épinglage pour afficher 📌 plein/vide.
    if (authed.value) tasks.push(api.pinned().then((p) => { pinnedSlugs.value = new Set(p.map((x) => x.slug)); }));
    await Promise.all(tasks);
  } catch (e) { error.value = String(e instanceof Error ? e.message : e); }
  finally { loading.value = false; }
});

async function togglePin(slug: string) {
  if (pinnedSlugs.value.has(slug)) { await api.unpinWorkspace(slug); pinnedSlugs.value.delete(slug); }
  else { await api.pinWorkspace(slug); pinnedSlugs.value.add(slug); }
  pinnedSlugs.value = new Set(pinnedSlugs.value); // nouvelle réf → réactivité
}

async function runSearch() {
  const query = q.value.trim();
  if (!query) { hits.value = null; return; }
  searching.value = true; error.value = null;
  try {
    const r = await api.public.search(query);
    hits.value = r.hits; total.value = r.total;
  } catch (e) { error.value = String(e instanceof Error ? e.message : e); }
  finally { searching.value = false; }
}

function openWs(slug: string) { router.push(`/w/${slug}`); }
function openHit(h: PublicSearchHit) {
  if (h.workspace) router.push({ path: `/w/${h.workspace}/doc/_`, query: { path: h.docPath } });
}
function highlight(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/«/g, "<mark>").replace(/»/g, "</mark>");
}
</script>

<template>
  <div class="pg">
    <header class="pg-top">
      <div class="brand">Memento<small>public</small></div>
      <a class="signin" href="/login">Se connecter</a>
    </header>

    <div class="pg-body">
      <h1>Bases de connaissances publiques</h1>
      <p class="lede">Du savoir structuré, sourcé et cherchable, partagé ouvertement. Sans compte.</p>

      <form class="srch" @submit.prevent="runSearch">
        <input v-model="q" placeholder="Rechercher dans toutes les bases publiques…" />
        <button type="submit">Rechercher</button>
        <button v-if="hits" type="button" class="ghost" @click="q = ''; hits = null">Effacer</button>
      </form>

      <p v-if="error" class="err">{{ error }}</p>

      <!-- Résultats de recherche -->
      <section v-if="hits">
        <p class="count">{{ total }} bloc(s) trouvé(s){{ hits.length < total ? ` — ${hits.length} affichés` : "" }}</p>
        <p v-if="searching" class="muted">Recherche…</p>
        <div v-for="h in hits" :key="h.blockId" class="hit" @click="openHit(h)">
          <div class="hmeta">
            <span class="badge">{{ h.type }}</span>
            <span class="src">{{ h.org ? h.org + " · " : "" }}{{ h.workspace }} / {{ h.docTitle }}</span>
          </div>
          <div class="snippet" v-html="highlight(h.snippet)" />
        </div>
        <p v-if="!searching && !hits.length" class="muted">Aucun résultat.</p>
      </section>

      <!-- Annuaire -->
      <section v-else>
        <p v-if="loading" class="muted">Chargement…</p>
        <p v-else-if="!list.length" class="muted">Aucune base publique pour l'instant.</p>
        <div v-else class="grid">
          <div v-for="w in list" :key="w.slug" class="card" @click="openWs(w.slug)">
            <button v-if="authed" class="pin" :class="{ on: pinnedSlugs.has(w.slug) }" @click.stop="togglePin(w.slug)"
              :title="pinnedSlugs.has(w.slug) ? 'Désépingler de mon univers' : 'Épingler dans mon univers'">📌</button>
            <div class="cname">{{ w.name }}</div>
            <div v-if="w.orgName" class="corg">{{ w.orgName }}</div>
            <p v-if="w.summary" class="csum">{{ w.summary }}</p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.pg { min-height: 100vh; background: var(--color-bg, #fbf8f1); color: var(--color-ink, #1c1a17); font-family: inherit; }
.pg-top { display: flex; align-items: center; justify-content: space-between; padding: 14px 24px; border-bottom: 1px solid var(--color-hair, #e5ded0); }
.brand { font-weight: 700; font-size: 18px; }
.brand small { margin-left: 6px; font-weight: 400; font-size: 12px; color: var(--color-mute, #8a857a); text-transform: uppercase; letter-spacing: 0.08em; }
.signin { border: 1px solid var(--color-ink, #1c1a17); background: var(--color-ink, #1c1a17); color: var(--color-bg, #fbf8f1); padding: 5px 12px; font-size: 13px; font-weight: 600; text-decoration: none; }
.pg-body { max-width: 880px; margin: 0 auto; padding: 36px 24px 80px; }
h1 { font-size: 28px; margin: 0 0 6px; }
.lede { color: var(--color-mute, #6f6a60); margin: 0 0 28px; font-size: 15px; }
.srch { display: flex; gap: 8px; margin-bottom: 28px; }
.srch input { flex: 1; min-width: 0; padding: 10px 12px; border: 1px solid var(--color-hair, #e5ded0); background: #fff; font: inherit; font-size: 14px; }
.srch button { border: 1px solid var(--color-ink, #1c1a17); background: var(--color-ink, #1c1a17); color: var(--color-bg, #fbf8f1); padding: 10px 16px; font-weight: 600; cursor: pointer; }
.srch button.ghost { background: none; color: var(--color-ink, #1c1a17); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
.card { position: relative; text-align: left; border: 1px solid var(--color-hair, #e5ded0); background: #fff; padding: 16px; cursor: pointer; font: inherit; transition: border-color 0.15s; }
.card:hover { border-color: var(--color-ink, #1c1a17); }
.card .pin { position: absolute; top: 8px; right: 8px; border: none; background: none; cursor: pointer; font-size: 15px; line-height: 1; padding: 2px; opacity: 0.28; filter: grayscale(1); transition: opacity 0.15s; }
.card .pin:hover { opacity: 0.85; filter: none; }
.card .pin.on { opacity: 1; filter: none; }
.cname { font-weight: 600; font-size: 16px; }
.corg { font-size: 12px; color: var(--color-mute, #8a857a); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 2px; }
.csum { font-size: 13px; color: var(--color-mute, #6f6a60); margin: 8px 0 0; line-height: 1.5; }
.count { font-size: 13px; color: var(--color-mute, #6f6a60); margin-bottom: 14px; }
.hit { border-bottom: 1px solid var(--color-hair, #e5ded0); padding: 12px 0; cursor: pointer; }
.hit:hover { background: var(--color-hair-soft, #f4f1ea); }
.hmeta { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.badge { font-family: var(--font-mono, monospace); font-size: 10px; text-transform: uppercase; border: 1px solid var(--color-hair, #e5ded0); padding: 1px 6px; }
.src { font-size: 12px; color: var(--color-mute, #8a857a); }
.snippet { font-size: 14px; line-height: 1.55; }
.snippet :deep(mark) { background: var(--color-accent-soft, #ffe9a8); padding: 0 1px; }
.muted { color: var(--color-mute, #8a857a); }
.err { color: var(--color-danger, #b00); font-size: 13px; }
</style>
