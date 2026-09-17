<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { mountSheet, type SheetDemo, type SheetDemoHandle } from '../sections/sheet'

const containerRef = ref<HTMLDivElement | null>(null)
const demoInstance = ref<SheetDemo | null>(null)

onMounted(() => {
  if (!containerRef.value) return
  const demo = mountSheet(containerRef.value)
  demoInstance.value = demo
  // 调试句柄：控制台 / 自动化读取断言（表格实例 + 关键查询 API 快照）
  window.__SHEET_DEMO__ = {
    getTable: () => demo.table,
    model: demo.model,
    queries: () => {
      const table = demo.table
      return {
        frozen: { cols: table.getFrozenColCount(), rows: table.getFrozenRowCount() },
        selection: table.getSelectedCellRanges(),
        bodyVisible: table.getBodyVisibleCellRange(),
        drawRange: table.getDrawRange(),
        scroll: { left: table.getScrollLeft(), top: table.getScrollTop() },
        headerLevels: table.getHeaderLevelCount(),
        editing: table.isEditing(),
      }
    },
  }
})

onBeforeUnmount(() => {
  delete window.__SHEET_DEMO__
})
</script>

<template>
  <div class="view-container">
    <div class="view-header">
      <div class="title-row">
        <h2>sheet 电子表格</h2>
        <div class="tags">
          <span class="tag">结构化样式矩阵</span>
          <span class="tag">主题→列级→按格覆盖链</span>
          <span class="tag">\n 多行</span>
          <span class="tag">合并区</span>
          <span class="tag">填充柄</span>
          <span class="tag">运行时冻结/合并</span>
          <span class="tag">editCellOnEnter</span>
        </div>
      </div>
      <p class="desc">
        对齐 ultra-ui sheet 示例演示意图：样式矩阵按「主题分区 token → 列级 → 按格
        hook」三级覆盖链呈现对齐、加粗斜体、
        下划线删除线、字号、边框线型、省略号与内边距；合并区主格含 \n 多行文本；F1 为格内示例图；
        预置选区 B16:C18 含数字序列与文本值，可拖右下角填充柄（内核只抛按下/结束事件，不写值）；
        控件区演示运行时冻结数切换、合并区整体替换与跨冻结边界拒绝；editCellOnEnter 开关切换 Enter
        进编辑。
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
