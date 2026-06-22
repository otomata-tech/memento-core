<script setup lang="ts">
// Cross-KB / cross-org move picker: choose a destination KB, then a target section
// (required for a document; optional parent for a section — empty = root of the KB).
import { computed, ref, watch, onMounted } from "vue";
import { api, type Workspace, type SectionNode } from "../api";
import { toast } from "../lib/toast";

const props = defineProps<{ mode: "doc" | "section"; itemId: string; itemTitle: string; currentWs: string }>();
const emit = defineEmits<{ (e: "moved"): void; (e: "cancel"): void }>();

const kbs = ref<Workspace[]>([]);
const selectedWs = ref(props.currentWs);
const tree = ref<SectionNode[]>([]);
const selectedSection = ref<string>("");
const busy = ref(false);
const loadingTree = ref(false);

const flat = computed(() => {
  const out: { id: string; label: string }[] = [];
  const walk = (nodes: SectionNode[], depth: number) => {
    for (const n of nodes) {
      out.push({ id: n.id, label: `${"— ".repeat(depth)}${n.title}` });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  };
  walk(tree.value, 0);
  return out;
});

function friendly(e: unknown): string {
  const s = String(e instanceof Error ? e.message : e);
  return /403|interdit|forbidden|curator|admin/i.test(s) ? "curators/admins only" : s;
}

async function loadTree() {
  loadingTree.value = true; selectedSection.value = "";
  try { tree.value = (await api.doctrine(selectedWs.value)).tree; }
  catch (e) { toast(friendly(e), "err"); tree.value = []; }
  finally { loadingTree.value = false; }
}
watch(selectedWs, loadTree);
onMounted(async () => {
  try { kbs.value = await api.workspaces(); } catch (e) { toast(friendly(e), "err"); }
  await loadTree();
});

const canConfirm = computed(() => props.mode === "section" || !!selectedSection.value);

async function confirmMove() {
  if (!canConfirm.value) { toast("pick a target section", "err"); return; }
  busy.value = true;
  try {
    if (props.mode === "doc") {
      await api.moveDocumentsCross({ documentIds: [props.itemId], targetSectionId: selectedSection.value });
    } else {
      await api.moveSectionCross({ sectionId: props.itemId, targetWorkspace: selectedWs.value, targetParentId: selectedSection.value || undefined });
    }
    toast("Moved", "ok");
    emit("moved");
  } catch (e) { toast(friendly(e), "err"); }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="mp-overlay" @click.self="emit('cancel')">
    <div class="mp-modal">
      <div class="mp-head">
        <div class="eb">⇄ Move {{ mode === "section" ? "section" : "document" }}</div>
        <h3 class="mp-title">{{ itemTitle }}</h3>
      </div>
      <div class="mp-body">
        <label class="eb">Destination knowledge base</label>
        <select v-model="selectedWs" class="mp-sel">
          <option v-for="w in kbs" :key="w.slug" :value="w.slug">{{ w.name }}</option>
        </select>

        <label class="eb" style="margin-top:14px">
          {{ mode === "section" ? "Parent section (optional)" : "Target section" }}
        </label>
        <select v-model="selectedSection" class="mp-sel" :disabled="loadingTree">
          <option value="">{{ mode === "section" ? "— root of the KB —" : "— choose a section —" }}</option>
          <option v-for="s in flat" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
        <p v-if="loadingTree" class="muted" style="margin-top:8px">Loading sections…</p>
      </div>
      <div class="mp-foot">
        <button class="btn go" :disabled="busy || !canConfirm" @click="confirmMove">Move here</button>
        <button class="btn" :disabled="busy" @click="emit('cancel')">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mp-overlay { position: fixed; inset: 0; z-index: 600; background: rgba(44, 33, 18, 0.32); display: flex; align-items: center; justify-content: center; padding: 24px; }
.mp-modal { width: 100%; max-width: 480px; background: var(--color-surface); border: 2px solid var(--color-ink); box-shadow: 8px 8px 0 var(--color-hair-soft); }
.mp-head { padding: 16px 20px; border-bottom: 1px solid var(--color-hair); background: var(--color-primary-soft); }
.mp-title { font-family: var(--font-display); font-size: 18px; font-weight: 700; margin: 4px 0 0; }
.mp-body { padding: 20px; display: flex; flex-direction: column; }
.mp-sel { font: inherit; font-size: 13px; padding: 7px 10px; margin-top: 6px; border: 1px solid var(--color-hair); background: var(--color-bg); }
.mp-sel:focus { outline: 2px solid var(--color-primary); border-color: var(--color-primary); }
.mp-foot { display: flex; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--color-hair); }
.btn { font: inherit; font-size: 12.5px; padding: 6px 13px; border: 1px solid var(--color-hair); background: var(--color-surface); color: var(--color-ink); cursor: pointer; }
.btn:hover { border-color: var(--color-primary); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn.go { border-color: var(--color-strong-ink); color: var(--color-strong-ink); background: var(--color-strong-bg); font-weight: 600; }
</style>
