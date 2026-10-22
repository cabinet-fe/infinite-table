<script setup lang="ts">
import { ref, useSlots } from 'vue'

const slots = useSlots()
const active = ref<'demo' | 'source'>('demo')
</script>

<template>
  <div class="demo-block">
    <div class="demo-block-bar">
      <span class="demo-block-label">
        <span class="demo-block-dot" aria-hidden="true" />
        {{ active === 'demo' ? '可交互示例' : '组件源码' }}
      </span>
      <div class="demo-block-switch" role="tablist" aria-label="示例视图">
        <button
          type="button"
          role="tab"
          :aria-selected="active === 'demo'"
          :class="{ active: active === 'demo' }"
          @click="active = 'demo'"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="m9 6-6 6 6 6" />
            <path d="m15 6 6 6-6 6" />
          </svg>
          源码
        </button>
      </div>
    </div>
    <div
      v-show="active === 'demo'"
      class="demo-block-panel"
      :class="{ 'is-visible': active === 'demo' }"
      role="tabpanel"
    >
      <slot />
    </div>
    <div
      v-show="active === 'source'"
      class="demo-block-panel demo-block-source"
      :class="{ 'is-visible': active === 'source' }"
      role="tabpanel"
    >
      <div class="demo-block-scroll">
        <slot name="source" />
      </div>
    </div>
  </div>
</template>
