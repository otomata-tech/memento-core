<script setup lang="ts">
// Standalone page for agent mode: full-screen chat on a KB (route /w/:ws/agent).
// Target of agent.otomata.tech (public KB). Allowed anonymous by the guard (/w/...).
import { ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api";
import AgentChat from "../components/AgentChat.vue";

const route = useRoute();
const ws = ref<string>(route.params.ws as string);
const kbName = ref<string>(ws.value);
const ready = ref(false);
const error = ref<string | null>(null);

async function load() {
  ws.value = route.params.ws as string;
  ready.value = false;
  error.value = null;
  try {
    // doctrine = implicit access check (403 if the KB is not readable).
    kbName.value = (await api.doctrine(ws.value)).workspace.name;
    ready.value = true;
  } catch {
    error.value = "Knowledge base not found or inaccessible.";
  }
}
watch(() => route.params.ws, load, { immediate: true });
</script>

<template>
  <AgentChat v-if="ready" :workspace="ws" :kb-name="kbName" variant="page" />
  <div v-else-if="error" class="agent-fallback"><p class="muted">{{ error }}</p></div>
  <div v-else class="agent-fallback"><p class="muted">Loading…</p></div>
</template>

<style scoped>
.agent-fallback { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--color-bg); }
</style>
