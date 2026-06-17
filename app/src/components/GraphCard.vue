<script setup lang="ts">
// Carte d'un bloc voisin dans le Graphe. Clic → recentre le graphe sur ce bloc.
import type { Block } from "../api";
import { roleClass, trustMark, renderMd } from "../lib/blocks";

const props = defineProps<{ block: Block; note?: string | null }>();
const emit = defineEmits<{ (e: "recenter", id: string): void }>();
</script>

<template>
  <div class="gcard" :class="roleClass(block.type)" @click="emit('recenter', block.id)">
    <div class="bhead">
      <span class="badge">{{ block.type }}</span>
      <span class="mono" style="font-size:11px;color:var(--color-faint)">{{ block.id.slice(0, 8) }}</span>
      <span class="vmark" :class="trustMark(block)[0]" style="margin-left:auto">{{ trustMark(block)[1] }}</span>
    </div>
    <div class="btext" style="font-size:13px" v-html="renderMd(block.content)" />
    <div v-if="note" class="gnote">« {{ note }} »</div>
  </div>
</template>
