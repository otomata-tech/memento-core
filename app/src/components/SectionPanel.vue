<script setup lang="ts">
// Section page — the "map" of a zone: summary, sub-sections, documents (deprecated
// included), plus structural actions (rename · + sub-section · + document ·
// deprecate/restore a document). Live writes; the backend gates (curator/admin).
import { reactive, ref } from "vue";
import { api, type SectionView, type DocMeta } from "../api";
import { toast } from "../lib/toast";
import ConfirmModal from "./ConfirmModal.vue";
import MovePicker from "./MovePicker.vue";

const props = defineProps<{ section: SectionView; ws: string }>();
const emit = defineEmits<{
  (e: "openDoc", id: string): void; (e: "selectSection", id: string): void;
  (e: "changed"): void; (e: "deletedSection"): void;
}>();

const busy = ref(false);
const mode = ref<"" | "rename" | "subsection" | "document">("");
const form = reactive({ title: "", summary: "" });
// Pending destructive action (rendered as a ConfirmModal — never a native dialog).
const confirm = ref<{ kind: "doc" | "section"; id: string; title: string; message: string } | null>(null);
// Pending cross-KB move (rendered as a MovePicker modal).
const mover = ref<{ mode: "doc" | "section"; id: string; title: string } | null>(null);

function onMoved() {
  const wasSection = mover.value?.mode === "section";
  mover.value = null;
  // A moved section left this KB → navigate away; a moved doc → just refresh.
  if (wasSection) emit("deletedSection");
  else emit("changed");
}

function friendly(e: unknown): string {
  const s = String(e instanceof Error ? e.message : e);
  return /403|interdit|forbidden|curator|admin/i.test(s) ? "curators/admins only" : s;
}

function openForm(m: "rename" | "subsection" | "document") {
  mode.value = m;
  form.title = m === "rename" ? props.section.section.title : "";
  form.summary = m === "rename" ? props.section.section.summary : "";
}

async function submit() {
  if (mode.value !== "rename" && !form.title.trim()) { toast("title required", "err"); return; }
  busy.value = true;
  try {
    const title = form.title.trim();
    const summary = form.summary.trim();
    if (mode.value === "rename") {
      await api.renameSection({ id: props.section.section.id, title, summary });
      toast("Section renamed", "ok");
    } else if (mode.value === "subsection") {
      await api.createSection({ workspace: props.ws, parentId: props.section.section.id, title, summary: summary || undefined });
      toast("Sub-section created", "ok");
    } else if (mode.value === "document") {
      await api.createDocument({ sectionId: props.section.section.id, title, summary: summary || undefined });
      toast("Document created", "ok");
    }
    mode.value = "";
    emit("changed");
  } catch (e) { toast(friendly(e), "err"); }
  finally { busy.value = false; }
}

async function toggleStatus(d: DocMeta & { blockCount: number }) {
  busy.value = true;
  try {
    if (d.status === "DEPRECATED") {
      await api.restoreDocument({ id: d.id });
      toast("Document restored", "ok");
    } else {
      await api.deprecateDocument({ id: d.id, reason: "deprecated from the viewer" });
      toast("Document deprecated", "ok");
    }
    emit("changed");
  } catch (e) { toast(friendly(e), "err"); }
  finally { busy.value = false; }
}

function askDeleteDoc(d: DocMeta & { blockCount: number }) {
  confirm.value = { kind: "doc", id: d.id, title: d.title,
    message: `Permanently delete the document "${d.title}" and its ${d.blockCount} block(s)? This cannot be undone.` };
}
function askDeleteSection() {
  const s = props.section;
  const subs = s.subsections.length, docs = s.documents.length;
  confirm.value = { kind: "section", id: s.section.id, title: s.section.title,
    message: `Permanently delete the section "${s.section.title}"` +
      (subs || docs ? ` and everything under it (${subs} sub-section(s), ${docs} document(s))` : "") +
      `? This cannot be undone.` };
}
async function doDelete() {
  const target = confirm.value;
  if (!target) return;
  busy.value = true;
  try {
    if (target.kind === "doc") {
      await api.deleteDocument({ id: target.id });
      toast("Document deleted", "ok");
      confirm.value = null;
      emit("changed");
    } else {
      await api.deleteSection({ id: target.id });
      toast("Section deleted", "ok");
      confirm.value = null;
      emit("deletedSection");
    }
  } catch (e) { toast(friendly(e), "err"); }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="doc">
    <div class="eb">Section</div>
    <h1 class="title">{{ section.section.title }}</h1>
    <div v-if="section.section.summary" class="summary">{{ section.section.summary }}</div>

    <!-- Structural action bar -->
    <div class="act sect-act">
      <button class="btn" :disabled="busy" @click="openForm('rename')">✎ rename</button>
      <button class="btn" :disabled="busy" @click="openForm('subsection')">＋ sub-section</button>
      <button class="btn go" :disabled="busy" @click="openForm('document')">＋ document</button>
      <button class="btn" :disabled="busy" @click="mover = { mode: 'section', id: section.section.id, title: section.section.title }">⇄ move</button>
      <button class="btn del" :disabled="busy" @click="askDeleteSection">🗑 delete section</button>
    </div>
    <div v-if="mode" class="srcform sect-form">
      <input v-model="form.title" :placeholder="mode === 'rename' ? 'section title' : (mode === 'subsection' ? 'sub-section title' : 'document title')" />
      <textarea v-model="form.summary" rows="2" placeholder="summary (optional)"></textarea>
      <div class="act">
        <button class="btn go" :disabled="busy" @click="submit">save</button>
        <button class="btn" :disabled="busy" @click="mode = ''">cancel</button>
      </div>
    </div>

    <template v-if="section.subsections.length">
      <div class="eb" style="margin-top:18px">Sub-sections</div>
      <div v-for="s in section.subsections" :key="s.id" class="block role-mute" @click="emit('selectSection', s.id)">
        <div class="bmeta"><span class="badge">▸</span><b>{{ s.title }}</b></div>
        <div v-if="s.summary" class="bbody"><div class="btext muted">{{ s.summary }}</div></div>
      </div>
    </template>

    <div class="eb" style="margin-top:18px">Documents</div>
    <div v-for="d in section.documents" :key="d.id" class="block role-mute"
      :class="{ dep: d.status === 'DEPRECATED' }" @click="emit('openDoc', d.id)">
      <div class="bmeta">
        <b>{{ d.title }}</b>
        <span v-if="d.status === 'DEPRECATED'" class="badge depbadge">deprecated</span>
        <span class="gx">{{ d.blockCount }} block(s)</span>
        <button class="btn mini" :disabled="busy" @click.stop="toggleStatus(d)">
          {{ d.status === 'DEPRECATED' ? '↺ restore' : '⊘ deprecate' }}
        </button>
        <button class="btn mini" :disabled="busy" title="Move to another section / KB" @click.stop="mover = { mode: 'doc', id: d.id, title: d.title }">⇄</button>
        <button class="btn mini del" :disabled="busy" title="Delete permanently" @click.stop="askDeleteDoc(d)">🗑</button>
      </div>
      <div v-if="d.summary" class="bbody"><div class="btext muted">{{ d.summary }}</div></div>
    </div>
    <p v-if="!section.documents.length && !section.subsections.length" class="muted">Empty section — no documents yet.</p>

    <ConfirmModal v-if="confirm"
      :title="confirm.kind === 'section' ? 'Delete section' : 'Delete document'"
      :message="confirm.message" :busy="busy" @confirm="doDelete" @cancel="confirm = null" />
    <MovePicker v-if="mover" :mode="mover.mode" :item-id="mover.id" :item-title="mover.title" :current-ws="ws"
      @moved="onMoved" @cancel="mover = null" />
  </div>
</template>

<style scoped>
.sect-act { margin-top: 14px; }
.sect-form { margin-top: 10px; }
.block.role-mute { cursor: pointer; }
.block.dep { opacity: .55; }
.bmeta { display: flex; gap: 8px; align-items: center; }
.badge.depbadge { background: var(--color-weak-ink, #b04); color: var(--color-surface, #fff); }
.btn.mini { font-size: 11px; padding: 3px 8px; }
.btn.mini:first-of-type { margin-left: auto; }
.btn.del { color: var(--color-weak-ink, #b04); border-color: var(--color-weak-ink, #b04); }
</style>
