<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { mountDisplay, type DisplayDemo } from '../sections/display'

const containerRef = ref<HTMLDivElement | null>(null)
const demoInstance = ref<DisplayDemo | null>(null)

onMounted(() => {
  if (!containerRef.value) return
  demoInstance.value = mountDisplay(containerRef.value)
})
</script>

<template>
  <div class="view-container">
    <div class="view-header">
      <div class="title-row">
        <h2>显示能力（10 万行极限渲染）</h2>
        <div class="tags">
          <span class="tag">100,000 行</span>
          <span class="tag">虚拟滚动</span>
          <span class="tag">冻结行列</span>
          <span class="tag">单元格合并</span>
          <span class="tag">逐边边框</span>
          <span class="tag">自定义渲染</span>
        </div>
      </div>
      <p class="desc">
        多层 canvas 分层渲染 + 四向滚动窗口：首行首列冻结、(2,2)~(3,3) 区域合并展示、(2,4)
        逐边差异化边框、Rating 列独立自定义 Canvas 绘制、Checkbox 状态切换及自定义主题配色。
      </p>
    </div>

    <div ref="containerRef" class="demo-mount-area"></div>
  </div>
</template>
