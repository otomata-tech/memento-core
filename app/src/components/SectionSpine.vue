<script setup lang="ts">
// Left spine of the Reader: doctrine card + section tree, whose documents
// of the active section are listed as sub-rows. Presentation (dumb) component.
import { computed } from "vue";
import type { SectionNode, DocMeta } from "../api";

const props = defineProps<{
  preamble: string;
  tree: SectionNode[];
  activeSectionId: string | null;
  activeDocId: string | null;
  docs: DocMeta[];
}>();
const emit = defineEmits<{ (e: "select", id: string): void; (e: "openDoc", id: string): void; (e: "openDoctrine"): void }>();

// Flattens the tree (≤ 3 levels) into a list with depth, for rendering without component recursion.
const flat = computed(() => {
  const out: { node: SectionNode; depth: number }[] = [];
  const walk = (nodes: SectionNode[], depth: number) => {
    for (const n of nodes) { out.push({ node: n, depth }); if (n.children?.length) walk(n.children, depth + 1); }
  };
  walk(props.tree, 0);
  return out;
});
</script>

<template>
  <div class="side">
    <div class="doctrine" role="button" title="View / edit the doctrine" @click="emit('openDoctrine')">
      <div class="eb">✶ Doctrine <span class="dt-more">read ›</span></div>
      <p v-if="preamble">{{ preamble }}</p>
      <p v-else style="font-style:italic;opacity:.8">No doctrine — the map has no compass.</p>
    </div>
    <div class="eb">Spine — sections</div>
    <template v-for="{ node, depth } in flat" :key="node.id">
      <div class="row" :class="{ on: node.id === activeSectionId }"
        :style="{ paddingLeft: 18 + depth * 14 + 'px' }" @click="emit('select', node.id)">
        {{ node.title }}
        <span class="ct">{{ node.blockCount }}</span>
      </div>
      <template v-if="node.id === activeSectionId">
        <div v-for="d in docs" :key="d.id" class="row doc" :class="{ on: d.id === activeDocId }"
          @click="emit('openDoc', d.id)">{{ d.title }}</div>
      </template>
    </template>
  </div>
</template>
