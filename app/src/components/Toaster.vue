<script setup lang="ts">
// Pile de toasts (coin bas-droit). Source : lib/toast.ts.
import { toasts, dismiss } from "../lib/toast";
</script>

<template>
  <div class="toaster">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind" @click="dismiss(t.id)">
      <span class="ic">{{ t.kind === "ok" ? "✓" : t.kind === "err" ? "⚠" : "•" }}</span>
      <span class="msg">{{ t.message }}</span>
    </div>
  </div>
</template>

<style scoped>
.toaster { position: fixed; right: 20px; bottom: 20px; z-index: 1000; display: flex; flex-direction: column; gap: 8px; max-width: min(380px, 90vw); }
.toast { display: flex; align-items: flex-start; gap: 9px; padding: 10px 13px; background: var(--color-surface); border: 1px solid var(--color-ink); box-shadow: 4px 4px 0 var(--color-hair-soft); font-size: 13px; cursor: pointer; }
.toast .ic { font-family: var(--font-mono); font-weight: 700; }
.toast.ok { border-color: var(--color-strong-ink); }
.toast.ok .ic { color: var(--color-strong-ink); }
.toast.err { border-color: var(--color-weak-mid); background: var(--color-weak-bg); color: var(--color-weak-ink); }
.toast.info .ic { color: var(--color-accent); }
.msg { line-height: 1.4; }
</style>
