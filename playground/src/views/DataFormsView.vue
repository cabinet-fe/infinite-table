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
