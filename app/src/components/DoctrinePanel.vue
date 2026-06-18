<script setup lang="ts">
// Doctrine modal: full read (markdown) + editing (api.setDoctrine, curator/admin).
import { ref } from "vue";
import { api, type Doctrine } from "../api";
import { renderMd } from "../lib/blocks";
import { toast } from "../lib/toast";

const props = defineProps<{ workspace: string; doctrine: Doctrine }>();
const emit = defineEmits<{ (e: "close"): void; (e: "saved"): void }>();

const editing = ref(false);
const draft = ref(props.doctrine.preamble ?? "");
const busy = ref(false);

function startEdit() { draft.value = props.doctrine.preamble ?? ""; editing.value = true; }
async function save() {
  busy.value = true;
  try {
    await api.setDoctrine(props.workspace, draft.value);
    toast("Doctrine saved", "ok");
    editing.value = false;
    emit("saved");
  } catch (e) {
    const s = String(e instanceof Error ? e.message : e);
    toast(/403|interdit|forbidden|curator|admin/i.test(s) ? "curators/admins only" : s, "err");
  } finally { busy.value = false; }
}
</script>

<template>
  <div class="dt-overlay" @click.self="emit('close')">
    <div class="dt-modal">
      <div class="dt-head">
        <div>
          <div class="eb">✶ Doctrine · {{ doctrine.workspace.name }}</div>
          <h2 class="dt-title">{{ doctrine.workspace.name }}</h2>
        </div>
        <button class="btn" @click="emit('close')">✕</button>
      </div>

      <div class="dt-body">
        <template v-if="!editing">
          <div v-if="doctrine.preamble" class="btext dt-md" v-html="renderMd(doctrine.preamble)" />
          <p v-else class="muted" style="font-style:italic">No doctrine — this knowledge base's map has no compass.</p>
          <div v-if="doctrine.conventions?.blockTypes?.length" class="dt-conv">
            <div class="eb">Block types</div>
            <p class="mono" style="font-size:12px;color:var(--color-mute)">{{ doctrine.conventions.blockTypes.join(" · ") }}</p>
          </div>
        </template>
        <textarea v-else v-model="draft" rows="18" class="dt-edit"
          placeholder="# Doctrine — …&#10;&#10;Meta-instructions (markdown): what this knowledge base is for, how to explore it, the update protocol."></textarea>
      </div>

      <div class="dt-foot">
        <template v-if="!editing">
          <button class="btn go" @click="startEdit">✎ Edit</button>
          <button class="btn" @click="emit('close')">Close</button>
        </template>
        <template v-else>
          <button class="btn primary" :disabled="busy" @click="save">Save</button>
          <button class="btn" :disabled="busy" @click="editing = false">Cancel</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dt-overlay { position: fixed; inset: 0; z-index: 500; background: rgba(44, 33, 18, 0.32); display: flex; align-items: center; justify-content: center; padding: 24px; }
.dt-modal { width: 100%; max-width: 720px; max-height: 86vh; display: flex; flex-direction: column; background: var(--color-surface); border: 2px solid var(--color-ink); box-shadow: 8px 8px 0 var(--color-hair-soft); }
.dt-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 18px 22px; border-bottom: 1px solid var(--color-hair); background: var(--color-primary-soft); }
.dt-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; letter-spacing: -0.02em; margin: 2px 0 0; color: var(--color-primary-ink); }
.dt-body { padding: 22px; overflow-y: auto; }
.dt-md { font-size: 14px; line-height: 1.6; }
.dt-md :deep(h1), .dt-md :deep(h2), .dt-md :deep(h3) { font-family: var(--font-display); }
.dt-md :deep(code) { font-family: var(--font-mono); font-size: 12.5px; background: var(--color-paper-2); padding: 1px 4px; }
.dt-conv { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--color-hair-soft); }
.dt-edit { width: 100%; box-sizing: border-box; font-family: var(--font-mono); font-size: 13px; line-height: 1.5; padding: 12px; border: 1px solid var(--color-hair); background: var(--color-bg); resize: vertical; }
.dt-edit:focus { outline: 2px solid var(--color-primary); border-color: var(--color-primary); }
.dt-foot { display: flex; gap: 10px; padding: 14px 22px; border-top: 1px solid var(--color-hair); }
.btn { font: inherit; font-size: 12.5px; padding: 6px 13px; border: 1px solid var(--color-hair); background: var(--color-surface); color: var(--color-ink); }
.btn:hover { border-color: var(--color-primary); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn.go { border-color: var(--color-strong-ink); color: var(--color-strong-ink); background: var(--color-strong-bg); font-weight: 600; }
.btn.primary { border-color: var(--color-primary-ink); background: var(--color-primary); color: var(--color-primary-ink); font-weight: 700; }
</style>
