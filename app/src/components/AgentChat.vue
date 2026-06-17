<script setup lang="ts">
// Mode agent : chat sur une KB. Réponses streamées (SSE) depuis la function `agent`.
// Deux présentations (même logique) : `drawer` (overlay latéral, dans le viewer) et
// `page` (plein écran, route /w/:ws/agent). L'agent répond à partir du contenu de la
// base, et de lui seul (cf. supabase/functions/agent).
import { nextTick, ref } from "vue";
import { agentChat, type AgentChatMessage } from "../api";
import { renderMd } from "../lib/blocks";

const props = withDefaults(defineProps<{
  workspace: string;
  kbName: string;
  variant?: "drawer" | "page";
}>(), { variant: "drawer" });
const emit = defineEmits<{ (e: "close"): void }>();

type Msg = { role: "user" | "assistant"; content: string };
const messages = ref<Msg[]>([]);
const input = ref("");
const busy = ref(false);
const status = ref<string | null>(null);
const error = ref<string | null>(null);
const bodyEl = ref<HTMLElement | null>(null);

async function scrollDown() {
  await nextTick();
  if (bodyEl.value) bodyEl.value.scrollTop = bodyEl.value.scrollHeight;
}

async function send() {
  const text = input.value.trim();
  if (!text || busy.value) return;
  input.value = "";
  error.value = null;
  // Historique = échanges précédents (avant d'ajouter le tour courant).
  const history: AgentChatMessage[] = messages.value.map((m) => ({ role: m.role, content: m.content }));
  messages.value.push({ role: "user", content: text });
  messages.value.push({ role: "assistant", content: "" });
  const assistant = messages.value[messages.value.length - 1]; // proxy réactif → mutation suivie
  busy.value = true;
  status.value = "Recherche dans la base…";
  await scrollDown();
  try {
    await agentChat(props.workspace, text, history, (ev) => {
      if (ev.type === "token") { assistant.content += ev.text; status.value = null; scrollDown(); }
      else if (ev.type === "status") { status.value = "Recherche dans la base…"; }
      else if (ev.type === "error") { error.value = ev.message; }
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
    status.value = null;
    if (!assistant.content && !error.value) assistant.content = "_(pas de réponse)_";
    scrollDown();
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
}
</script>

<template>
  <div :class="['ag-root', variant === 'drawer' ? 'ag-overlay' : 'ag-page']"
    @click.self="variant === 'drawer' && emit('close')">
    <div class="ag-panel" :class="`ag-panel--${variant}`">
      <div class="ag-head">
        <div>
          <div class="eb">✦ Agent · {{ kbName }}</div>
          <h2 class="ag-title">Demander à la base</h2>
        </div>
        <button v-if="variant === 'drawer'" class="btn" @click="emit('close')">✕</button>
      </div>

      <div ref="bodyEl" class="ag-body">
        <p v-if="!messages.length" class="muted ag-hint">
          Pose ta question : je réponds à partir du contenu de « {{ kbName }} », et de lui seul.
        </p>
        <div v-for="(m, i) in messages" :key="i" class="ag-msg" :class="m.role">
          <div v-if="m.role === 'assistant'" class="ag-bubble ag-md" v-html="renderMd(m.content || '…')" />
          <div v-else class="ag-bubble ag-user">{{ m.content }}</div>
        </div>
        <p v-if="status" class="muted ag-status">{{ status }}</p>
        <p v-if="error" class="ag-error">{{ error }}</p>
      </div>

      <div class="ag-foot">
        <textarea v-model="input" rows="2" class="ag-input" placeholder="Ta question…"
          :disabled="busy" @keydown="onKey" />
        <button class="btn primary" :disabled="busy || !input.trim()" @click="send">
          {{ busy ? "…" : "Envoyer" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Présentation drawer : overlay latéral droit (dans le viewer) */
.ag-overlay { position: fixed; inset: 0; z-index: 500; background: rgba(44, 33, 18, 0.32); display: flex; justify-content: flex-end; }
.ag-panel--drawer { max-width: 460px; border-left: 2px solid var(--color-ink); box-shadow: -8px 0 0 var(--color-hair-soft); }
/* Présentation page : plein écran, panneau centré lisible */
.ag-page { height: 100%; min-height: 100vh; display: flex; justify-content: center; background: var(--color-bg); }
.ag-panel--page { max-width: 760px; border-left: 1px solid var(--color-hair); border-right: 1px solid var(--color-hair); }

.ag-panel { width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--color-surface); }
.ag-page .ag-panel { height: 100vh; }
.ag-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 18px 22px; border-bottom: 1px solid var(--color-hair); background: var(--color-primary-soft); }
.ag-title { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.02em; margin: 2px 0 0; color: var(--color-primary-ink); }
.ag-body { flex: 1; overflow-y: auto; padding: 18px 22px; display: flex; flex-direction: column; gap: 14px; }
.ag-hint { font-style: italic; }
.ag-msg { display: flex; }
.ag-msg.user { justify-content: flex-end; }
.ag-bubble { max-width: 88%; padding: 9px 13px; font-size: 14px; line-height: 1.5; border: 1px solid var(--color-hair); }
.ag-user { background: var(--color-primary-soft); color: var(--color-primary-ink); }
.ag-md :deep(p) { margin: 0 0 8px; }
.ag-md :deep(p:last-child) { margin-bottom: 0; }
.ag-md :deep(code) { font-family: var(--font-mono); font-size: 12.5px; background: var(--color-paper-2); padding: 1px 4px; }
.ag-md :deep(ul), .ag-md :deep(ol) { margin: 4px 0 8px; padding-left: 20px; }
.ag-status { font-style: italic; }
.ag-error { color: var(--color-weak-ink); font-size: 13px; }
.ag-foot { display: flex; gap: 10px; padding: 14px 22px; border-top: 1px solid var(--color-hair); }
.ag-input { flex: 1; box-sizing: border-box; font: inherit; font-size: 13.5px; line-height: 1.5; padding: 9px 11px; border: 1px solid var(--color-hair); background: var(--color-bg); resize: none; }
.ag-input:focus { outline: 2px solid var(--color-primary); border-color: var(--color-primary); }
.btn { font: inherit; font-size: 12.5px; padding: 6px 13px; border: 1px solid var(--color-hair); background: var(--color-surface); color: var(--color-ink); cursor: pointer; }
.btn.primary { background: var(--color-primary); color: var(--color-surface); border-color: var(--color-primary); }
.btn:disabled { opacity: 0.5; cursor: default; }
</style>
