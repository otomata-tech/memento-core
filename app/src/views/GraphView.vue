<script setup lang="ts">
// « Graphe » — un bloc centré, ses voisins par relation typée. Contradictions/remplacements
// (les cas précieux) à gauche en rouge ; appuis (dépend/référence) à droite en bleu.
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, type Block, type SectionNode } from "../api";
import { neighbours, roleClass, trustMark, renderMd, RELLABEL, RELGLYPH } from "../lib/blocks";
import AppShell from "../components/AppShell.vue";
import GraphCard from "../components/GraphCard.vue";

const route = useRoute();
const router = useRouter();

const ws = ref<string>(route.params.ws as string);
const center = ref<(Block & { documentId?: string }) | null>(null);
const groups = ref<Record<string, { block: Block; note: string | null }[]>>({});
const loading = ref(false);
const error = ref<string | null>(null);

const LEFT = ["CONTRADICTS", "SUPERSEDES"];
const RIGHT = ["DEPENDS_ON", "REFERENCES"];
const has = (rels: string[]) => rels.some((r) => groups.value[r]?.length);
const noNeighbours = computed(() => center.value !== null && Object.keys(groups.value).length === 0);

async function resolveDefault(): Promise<string | null> {
  // Marche l'arbre (les documents vivent souvent dans les sous-sections) ; privilégie
  // un bloc qui a des liens (graphe non vide), sinon retombe sur le premier bloc trouvé.
  const d = await api.doctrine(ws.value);
  const flat: SectionNode[] = [];
  const walk = (ns: SectionNode[]) => ns.forEach((n) => { flat.push(n); if (n.children?.length) walk(n.children); });
  walk(d.tree);
  let fallback: string | null = null;
  let scanned = 0;
  for (const s of flat) {
    if (scanned >= 10) break;
    const docId = (await api.section(s.id)).documents[0]?.id;
    if (!docId) continue;
    scanned++;
    const doc = await api.document(docId);
    const linked = doc.blocks.find((b) => b.linksFrom.length || b.linksTo.length);
    if (linked) return linked.id;
    if (!fallback) fallback = doc.blocks[0]?.id ?? null;
  }
  return fallback;
}

async function load(blockId: string) {
  const c = await api.block(blockId);
  center.value = c;
  const by = neighbours(c);
  const out: Record<string, { block: Block; note: string | null }[]> = {};
  await Promise.all(Object.entries(by).map(async ([rel, list]) => {
    out[rel] = await Promise.all(list.map(async (n) => ({ block: await api.block(n.otherId), note: n.note })));
  }));
  groups.value = out;
}

async function syncFromRoute() {
  loading.value = true; error.value = null; groups.value = {};
  try {
    ws.value = route.params.ws as string;
    let blockId = route.params.blockId as string | undefined;
    if (!blockId) blockId = (await resolveDefault()) ?? undefined;
    if (!blockId) { center.value = null; return; }
    await load(blockId);
  } catch (e) { error.value = String(e instanceof Error ? e.message : e); }
  finally { loading.value = false; }
}

function recenter(id: string) { router.push(`/w/${ws.value}/graph/${id}`); }
function readBlock() {
  if (center.value?.documentId)
    router.push({ path: `/w/${ws.value}/doc/${center.value.documentId}`, query: { block: center.value.id } });
}

watch(() => route.fullPath, syncFromRoute, { immediate: true });
</script>

<template>
  <AppShell page="graph" :ws="ws">
    <template #crumbs>
      <span>graphe · <b v-if="center">centré sur {{ center.id.slice(0, 8) }}</b><b v-else>—</b></span>
    </template>

    <div class="bd">
      <div v-if="center" class="graph" style="width:100%">
        <div class="gtitle">
          <h1>Traverser par le sens</h1>
          <span class="mono" style="font-size:11px;color:var(--color-faint)">mem_links · {{ center.id.slice(0, 8) }}</span>
        </div>
        <p class="gsub">Centré sur un bloc, on suit ses liens typés. Les contradictions et remplacements — les cas précieux — sont signalés en rouge.</p>

        <div class="gcanvas">
          <!-- Gauche : tensions -->
          <div class="gcol">
            <template v-if="has(LEFT)">
              <template v-for="rel in LEFT" :key="rel">
                <template v-if="groups[rel]?.length">
                  <div class="clabel warn">{{ RELGLYPH[rel] }} {{ RELLABEL[rel] }}</div>
                  <GraphCard v-for="n in groups[rel]" :key="n.block.id" :block="n.block" :note="n.note" @recenter="recenter" />
                </template>
              </template>
            </template>
            <div v-else class="clabel">aucune tension</div>
          </div>

          <!-- Centre -->
          <div class="gcol">
            <div class="gconnect">— bloc centré —</div>
            <div class="gcenter" :class="roleClass(center.type)">
              <span class="pin">● centré</span>
              <div class="bhead">
                <span class="badge">{{ center.type }}</span>
                <span class="mono" style="font-size:11px;color:var(--color-faint)">{{ center.id.slice(0, 8) }}</span>
                <span class="vmark" :class="trustMark(center)[0]" style="margin-left:auto">{{ trustMark(center)[1] }}</span>
              </div>
              <div class="btext" v-html="renderMd(center.content)" />
              <div v-if="center.sources.length" class="rels" style="margin-top:9px">
                <span class="src"><span class="kk">{{ center.sources[0].kind ?? 'SRC' }}</span>{{ center.sources[0].title }}</span>
              </div>
              <div class="act" style="margin-top:11px"><button class="btn go" @click="readBlock">⌖ lire ce bloc</button></div>
            </div>
            <div class="gconnect">clic un voisin pour recentrer ↑</div>
          </div>

          <!-- Droite : appuis -->
          <div class="gcol">
            <template v-if="has(RIGHT)">
              <template v-for="rel in RIGHT" :key="rel">
                <template v-if="groups[rel]?.length">
                  <div class="clabel accent">{{ RELGLYPH[rel] }} {{ RELLABEL[rel] }}</div>
                  <GraphCard v-for="n in groups[rel]" :key="n.block.id" :block="n.block" :note="n.note" @recenter="recenter" />
                </template>
              </template>
            </template>
            <div v-else class="clabel">aucun appui</div>
          </div>
        </div>

        <div class="glegend">
          <span class="eb">Types de liens</span>
          <span class="rel warn">⚡ contredit</span>
          <span class="rel warn">⇡ remplace</span>
          <span class="rel accent">⇠ dépend de</span>
          <span class="rel accent">→ référence</span>
        </div>
        <p v-if="noNeighbours" class="gsub" style="margin-top:16px">
          Ce bloc n'a pas encore de liens typés. Les liens (référence, dépend de, contredit, remplace)
          se créent à l'ingestion ou à la curation — voir la <b>Boucle</b>.
        </p>
      </div>
      <p v-else-if="loading" class="pagemsg">Chargement…</p>
      <p v-else-if="error" class="pagemsg err">{{ error }}</p>
      <p v-else class="pagemsg">Aucun bloc à centrer — ouvre un bloc depuis « Lire ».</p>
    </div>
  </AppShell>
</template>
