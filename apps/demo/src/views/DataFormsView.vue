<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { mountDataForms, DemoModel, type DataFormsDemo } from '../sections/data-forms'

const containerRef = ref<HTMLDivElement | null>(null)
const demoInstance = ref<DataFormsDemo | null>(null)
const statusText = ref('')
const currentTab = ref<'all' | 'records' | 'hooks' | 'model'>('all')

onMounted(() => {
  if (!containerRef.value) return
  const demo = mountDataForms(containerRef.value)
  demoInstance.value = demo

  statusText.value = `model(1,1) = ${demo.model.getCellValue(1, 1)}；变更次数 ${demo.model.changeCount}`
  demo.model.onCellChange(() => {
    statusText.value = `model(1,1) = ${demo.model.getCellValue(1, 1)}；变更次数 ${demo.model.changeCount}`
  })
})

function updateModelExternal() {
  if (!demoInstance.value) return
  const { model } = demoInstance.value
  model.setCellValue(1, 1, `EXT-${model.changeCount}`)
}

function updateModelTable() {
  if (!demoInstance.value) return
  const { model, modelMount } = demoInstance.value
  modelMount.table.updateCell(1, 1, `WB-${model.changeCount}`)
}
</script>

<template>
  <div class="view-container">
    <div class="view-header">
      <div class="title-row">
        <h2>数据供给三形态</h2>
        <div class="tags">
          <span class="tag">Records 数组</span>
          <span class="tag">格级 Hook</span>
          <span class="tag">Model 事件驱动</span>
          <span class="tag tag-success">防回环机制</span>
        </div>
      </div>
      <p class="desc">
        演示三种核心数据供给方式：静态 records/columns 数组（5000 行）、按格 hook 纯函数同步 O(1)
        计算、 以及响应式模型（TableModel）事件驱动局部刷新与回驱防回环机制。
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
  gap: 6px;
}
.tag {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  background: #f0f4ff;
  color: #3370ff;
}
.tag-success {
  background: #eaf8f1;
  color: #00b42a;
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
  margin-bottom: 16px;
}
.demo-mount-area :deep(h2) {
  display: none; /* header 已经展示 */
}
.demo-mount-area :deep(.desc) {
  display: none;
}
.demo-mount-area :deep(h3) {
  font-size: 14px;
  font-weight: 600;
  margin: 12px 0 8px;
  color: #1f2329;
}
.demo-mount-area :deep(h3:first-of-type) {
  margin-top: 0;
}
</style>
