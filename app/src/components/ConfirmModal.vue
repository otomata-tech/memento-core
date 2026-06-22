<script setup lang="ts">
// Generic confirmation modal for destructive actions — no native dialog.
defineProps<{ title: string; message: string; confirmLabel?: string; busy?: boolean }>();
const emit = defineEmits<{ (e: "confirm"): void; (e: "cancel"): void }>();
</script>

<template>
  <div class="cm-overlay" @click.self="emit('cancel')">
    <div class="cm-modal">
      <div class="cm-head">
        <div class="eb">⚠ {{ title }}</div>
      </div>
      <div class="cm-body">
        <p>{{ message }}</p>
      </div>
      <div class="cm-foot">
        <button class="btn danger" :disabled="busy" @click="emit('confirm')">{{ confirmLabel ?? "Delete" }}</button>
        <button class="btn" :disabled="busy" @click="emit('cancel')">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cm-overlay { position: fixed; inset: 0; z-index: 600; background: rgba(44, 33, 18, 0.32); display: flex; align-items: center; justify-content: center; padding: 24px; }
.cm-modal { width: 100%; max-width: 460px; background: var(--color-surface); border: 2px solid var(--color-ink); box-shadow: 8px 8px 0 var(--color-hair-soft); }
.cm-head { padding: 16px 20px; border-bottom: 1px solid var(--color-hair); background: var(--color-primary-soft); }
.cm-body { padding: 20px; font-size: 14px; line-height: 1.55; }
.cm-foot { display: flex; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--color-hair); }
.btn { font: inherit; font-size: 12.5px; padding: 6px 13px; border: 1px solid var(--color-hair); background: var(--color-surface); color: var(--color-ink); cursor: pointer; }
.btn:hover { border-color: var(--color-primary); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn.danger { border-color: var(--color-weak-ink, #b04); color: var(--color-surface); background: var(--color-weak-ink, #b04); font-weight: 700; }
</style>
