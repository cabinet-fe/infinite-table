<script setup lang="ts">
import { ref, useSlots } from 'vue'

const slots = useSlots()
const active = ref<'demo' | 'source'>('demo')
</script>

<template>
  <div class="demo-block">
    <div class="demo-block-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        :aria-selected="active === 'demo'"
        :class="{ active: active === 'demo' }"
        @click="active = 'demo'"
      >
        示例
      </button>
      <button
        v-if="slots.source"
        type="button"
        role="tab"
        :aria-selected="active === 'source'"
        :class="{ active: active === 'source' }"
        @click="active = 'source'"
      >
        源码
      </button>
    </div>
    <div v-show="active === 'demo'" class="demo-block-panel" role="tabpanel">
      <slot />
    </div>
    <div v-show="active === 'source'" class="demo-block-panel demo-block-source" role="tabpanel">
      <slot name="source" />
    </div>
  </div>
</template>
