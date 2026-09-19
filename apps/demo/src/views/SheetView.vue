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
          <span class="tag">对标 ultra-ui playground sheet</span>
          <span class="tag">图标工具栏</span>
          <span class="tag">公式栏/函数建议</span>
          <span class="tag">底部 tabs</span>
          <span class="tag">三套右键菜单</span>
          <span class="tag">查找替换</span>
          <span class="tag">CSV 导入导出</span>
          <span class="tag">插入浮动图片</span>
          <span class="tag">数据结构观察区</span>
        </div>
      </div>
      <p class="desc">
        对标 ultra-ui playground 的 u-sheet 组件形态：工具栏（图标分组）→ 公式栏（名称框/fx/建议）→
        网格（#F5F5F5 表头 / #E1E4E8 网格线 / #2170E7 选区）→ 底部 sheet
        tabs；右键菜单三套（行号/列头/正文， 含插入数量与冻结）、查找替换弹层、CSV
        导入导出、插入浮动图片、数据结构观察区（快照 JSON + 复制/放大）；消息走顶部 toast。数据面为
        sheet 插件族（SheetStore 单一事实源/填充生成/选区同步/ 公式显示/键位预设/实例池/撤销栈）。
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
/* sheet 区自带组件卡片，section 标题/描述隐藏；铺满宽度 */
.demo-mount-area :deep(section) {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
}
.demo-mount-area :deep(h2),
.demo-mount-area :deep(.desc) {
  display: none;
}
</style>
