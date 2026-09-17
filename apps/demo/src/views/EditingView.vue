<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { mountEditing, type EditingDemo } from '../sections/editing'

const containerRef = ref<HTMLDivElement | null>(null)
const demoInstance = ref<EditingDemo | null>(null)

onMounted(() => {
  if (!containerRef.value) return
  demoInstance.value = mountEditing(containerRef.value)
})
</script>

<template>
  <div class="view-container">
    <div class="view-header">
      <div class="title-row">
        <h2>单元格编辑</h2>
        <div class="tags">
          <span class="tag">SheetModel 内存模型</span>
          <span class="tag">双击编辑</span>
          <span class="tag">键盘流（Enter/Tab/Esc）</span>
          <span class="tag">滚动浮层跟随</span>
          <span class="tag">格级禁编规则</span>
          <span class="tag">编程式 API</span>
        </div>
      </div>
      <p class="desc">
        单元格编辑完整闭环：双击任意单元格呼出原生浮层编辑器；支持 Enter 提交并下移、Tab
        提交并右移、Esc
        取消；编辑过程中滚动表格，浮层动态精准跟随锚定单元格，滚出视口自动提交；对照展示：格 (0,2)
        细粒度禁编，纯展示列不响应编辑。
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
</style>
