<script setup lang="ts">
// Dossier de provenance du bloc focalisé : sources, liens, commentaires, historique,
// + barre d'actions curées (✓ vérifier · ＋ source · ⌗ graphe). Écriture live.
import { reactive, ref } from "vue";
import { api, type Block, type Revision } from "../api";
import { roleClass, trustMark, RELLABEL, RELGLYPH, relClass, safeHref } from "../lib/blocks";
import { toast } from "../lib/toast";

const props = defineProps<{ block: Block; history: Revision[] }>();
const emit = defineEmits<{ (e: "refresh"): void; (e: "graph", blockId: string): void }>();

const busy = ref(false);
const err = ref<string | null>(null);
const showSrc = ref(false);
const showCmt = ref(false);
const cmtBody = ref("");
const form = reactive({ kind: "URL", title: "", citation: "", locator: "" });

async function verify() {
  busy.value = true; err.value = null;
  try {
    const next = !props.block.verifiedAt;
    await api.verifyBlock(props.block.id, next);
    toast(next ? "Bloc vérifié" : "Vérification retirée", "ok");
    emit("refresh");
  } catch (e) { err.value = msg(e); toast(err.value, "err"); }
  finally { busy.value = false; }
}
async function addSource() {
  if (!form.title.trim()) { err.value = "titre de source requis"; return; }
  busy.value = true; err.value = null;
  try {
    await api.attachSource({ blockId: props.block.id, kind: form.kind, title: form.title.trim(),
      citation: form.citation.trim() || undefined, locator: form.locator.trim() || undefined });
    form.title = ""; form.citation = ""; form.locator = ""; showSrc.value = false;
    toast("Source attachée", "ok");
    emit("refresh");
  } catch (e) { err.value = msg(e); toast(err.value, "err"); }
  finally { busy.value = false; }
}
async function addCmt() {
  if (!cmtBody.value.trim()) { err.value = "commentaire vide"; return; }
  busy.value = true; err.value = null;
  try {
    await api.addComment({ targetType: "BLOCK", targetId: props.block.id, body: cmtBody.value.trim() });
    cmtBody.value = ""; showCmt.value = false;
    toast("Commentaire ajouté", "ok");
    emit("refresh");
  } catch (e) { err.value = msg(e); toast(err.value, "err"); }
  finally { busy.value = false; }
}
async function resolveCmt(id: string) {
  busy.value = true; err.value = null;
  try {
    await api.resolveComment(id);
    toast("Commentaire résolu", "ok");
    emit("refresh");
  } catch (e) { err.value = msg(e); toast(err.value, "err"); }
  finally { busy.value = false; }
}
function msg(e: unknown): string {
  const s = String(e instanceof Error ? e.message : e);
  return /403|interdit|forbidden|curator|admin/i.test(s) ? "réservé aux curateurs/admins" : s;
}
</script>

<template>
  <div class="dossier" :class="roleClass(block.type)">
    <div class="seg">
      <div class="eb">Dossier du bloc · {{ block.id.slice(0, 8) }}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
        <span class="badge">{{ block.type }}</span>
        <span class="vmark" :class="trustMark(block)[0]">{{ trustMark(block)[1] }}</span>
      </div>
    </div>

    <div class="seg">
      <div class="eb">Sources</div>
      <template v-if="block.sources.length">
        <div v-for="(s, i) in block.sources" :key="i" class="src-card" style="margin-bottom:6px">
          <span class="src">
            <a v-if="safeHref(s.locator)" :href="safeHref(s.locator)" target="_blank" rel="noopener">{{ s.title }}</a>
            <template v-else>{{ s.title }}</template>
            <span v-if="s.citation"> — {{ s.citation }}</span>
          </span>
        </div>
      </template>
      <div v-else class="warn-card">⚠ aucune source attachée</div>
      <div v-if="showSrc" class="srcform">
        <select v-model="form.kind"><option>URL</option><option>FILE</option><option>MANUAL</option></select>
        <input v-model="form.title" placeholder="titre de la source" />
        <input v-model="form.citation" placeholder="citation (ex. p.42)" />
        <input v-model="form.locator" placeholder="lien / locator (optionnel)" />
        <div class="act">
          <button class="btn go" :disabled="busy" @click="addSource">enregistrer</button>
          <button class="btn" :disabled="busy" @click="showSrc = false">annuler</button>
        </div>
      </div>
    </div>

    <div v-if="block.linksFrom.length || block.linksTo.length" class="seg">
      <div class="eb">Liens</div>
      <div class="rels">
        <span v-for="l in block.linksFrom" :key="l.id" class="rel" :class="relClass(l.relation)"
          :title="l.note || ''" @click="emit('graph', l.toBlockId!)">
          {{ RELGLYPH[l.relation] }} {{ RELLABEL[l.relation] }} {{ l.toBlockId?.slice(0, 8) }}
        </span>
        <span v-for="l in block.linksTo" :key="l.id" class="rel" :class="relClass(l.relation)"
          :title="l.note || ''" @click="emit('graph', l.fromBlockId!)">
          {{ l.fromBlockId?.slice(0, 8) }} {{ RELLABEL[l.relation] }} {{ RELGLYPH[l.relation] }}
        </span>
      </div>
    </div>

    <div class="seg">
      <div class="eb">Commentaires</div>
      <template v-if="block.comments.length">
        <div v-for="c in block.comments" :key="c.id" class="warn-card"
          style="margin-bottom:6px;display:flex;gap:8px;align-items:center;justify-content:space-between">
          <span>{{ c.authorKind === "agent" ? "🤖" : "🧑" }} {{ c.body }}<span v-if="c.resolvedAt"> · résolu</span></span>
          <button v-if="!c.resolvedAt" class="btn" :disabled="busy" @click="resolveCmt(c.id)">✓ résoudre</button>
        </div>
      </template>
      <div v-else class="warn-card">aucun commentaire</div>
      <div v-if="showCmt" class="srcform">
        <textarea v-model="cmtBody" placeholder="votre commentaire" rows="3"></textarea>
        <div class="act">
          <button class="btn go" :disabled="busy" @click="addCmt">enregistrer</button>
          <button class="btn" :disabled="busy" @click="showCmt = false">annuler</button>
        </div>
      </div>
    </div>

    <div class="seg">
      <div class="eb">Historique</div>
      <div v-if="history.length" class="hist">
        <div v-for="r in history" :key="r.id">{{ r.actorKind === "agent" ? "🤖" : "🧑" }} {{ r.op }} · {{ r.actor }}<span v-if="r.reason"> — {{ r.reason }}</span></div>
      </div>
      <div v-else class="hist">aucune révision</div>
    </div>

    <p v-if="err" class="warn-card" style="margin-bottom:10px">{{ err }}</p>
    <div class="act">
      <button class="btn go" :disabled="busy" @click="verify">{{ block.verifiedAt ? "↺ dé-vérifier" : "✓ vérifier" }}</button>
      <button class="btn" :disabled="busy" @click="showSrc = !showSrc">＋ source</button>
      <button class="btn" :disabled="busy" @click="showCmt = !showCmt">＋ commenter</button>
      <button class="btn" @click="emit('graph', block.id)">⌗ graphe</button>
    </div>
  </div>
</template>
