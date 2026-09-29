<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { mountInteraction, type InteractionDemo } from '../sections/interaction'

const containerRef = ref<HTMLDivElement | null>(null)
const demoInstance = ref<InteractionDemo | null>(null)

onMounted(() => {
  if (!containerRef.value) return
  demoInstance.value = mountInteraction(containerRef.value)
})
</script>

<template>
  <div class="view-container">
    <div class="view-header">
      <div class="title-row">
        <h2>交互能力</h2>
        <div class="tags">
          <span class="tag">框选/拖选</span>
          <span class="tag">整行/整列/全选</span>
          <span class="tag">键盘导航</span>
          <span class="tag">行列调整 Resize</span>
          <span class="tag">右键菜单</span>
          <span class="tag">批量更新</span>
        </div>
      </div>
      <p class="desc">
        完整合成事件与交互管线：鼠标拖选、点击行号选择整行、点击列头选择整列、左上角全选；Shift+方向键区域扩展；Hover
        悬停高亮；行列拖拽调节尺寸（第 0 行/列由 canResize
        规则锁定）；右键快捷菜单响应；以及批量更新（100 格）单帧收敛失效。
      </p>
    </div>

    <div ref="containerRef" class="demo-mount-area"></div>
  </div>
</template>
