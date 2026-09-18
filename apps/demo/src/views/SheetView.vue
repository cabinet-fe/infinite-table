<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { createSheetHandle, mountSheet, type SheetDemo } from '../sections/sheet'

const containerRef = ref<HTMLDivElement | null>(null)
let demoInstance: SheetDemo | null = null

onMounted(() => {
  if (!containerRef.value) return
  // 调试句柄：控制台 / 自动化读取断言（活跃实例 + Store + UI 驱动面）
  const demo = mountSheet(containerRef.value)
  demoInstance = demo
  window.__SHEET_DEMO__ = createSheetHandle(demo)
})

onBeforeUnmount(() => {
  demoInstance?.destroy()
  demoInstance = null
  delete window.__SHEET_DEMO__
})
</script>

<template>
  <div class="view-container">
    <div class="view-header">
      <div class="title-row">
        <h2>sheet 电子表格</h2>
        <div class="tags">
          <span class="tag">SheetStore 单一事实源</span>
          <span class="tag">公式栏/公式显示</span>
          <span class="tag">样式工具栏</span>
          <span class="tag">右键菜单</span>
          <span class="tag">查找替换</span>
          <span class="tag">多 sheet tabs</span>
          <span class="tag">填充真实写值</span>
          <span class="tag">CSV 导入导出</span>
          <span class="tag">撤销重做</span>
        </div>
      </div>
      <p class="desc">
        对标 ultra-ui playground sheet：sheet
        插件（SheetStore/填充生成/选区同步/公式显示/键位预设/实例池/撤销栈） 之上搭建
        UI——样式矩阵按「主题分区 token → 列级 → Store 按格样式」覆盖链呈现；合并区主格含 \n
        多行文本； F1 为格内示例图；B16:C18 预置序列可拖填充柄真实生成；工具栏/菜单/查找替换/CSV
        经公式栏与 tabs 协同操作。
      </p>
    </div>

    <div ref="containerRef" class="demo-mount-area"></div>
  </div>
</template>

<style scoped>
.view-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.view-header {
  background: #ffffff;
  border: 1px solid #e5e8eb;
  border-radius: 8px;
  padding: 16px 20px;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.title-row h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: #1f2329;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tag {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  background: #f0f4ff;
  color: #3370ff;
}
.desc {
  font-size: 13px;
  color: #646a73;
  margin: 0;
  line-height: 1.5;
}
.demo-mount-area :deep(section) {
  background: #ffffff;
  border: 1px solid #e5e8eb;
  border-radius: 8px;
  padding: 16px 20px;
}
.demo-mount-area :deep(h2),
.demo-mount-area :deep(.desc) {
  display: none;
}
.demo-mount-area :deep(.checkbox) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #1f2329;
  user-select: none;
  cursor: pointer;
}
</style>
