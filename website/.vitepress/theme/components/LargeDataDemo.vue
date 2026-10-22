<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useDemoTable } from '../demo/use-demo-table'

const ROW_COUNT = 1_000_000
const COL_COUNT = 8
const HEIGHT = 360

const { container, table } = useDemoTable(
  (width) => ({
    columns: Array.from({ length: COL_COUNT }, (_, col) => ({
      title: `列 ${col + 1}`,
      width: Math.max(90, Math.floor((width - 56) / COL_COUNT)),
    })),
    rowCount: ROW_COUNT,
    resolveDisplayValue: (col, row) => `${row.toLocaleString()} · ${col + 1}`,
    overscanRows: 3,
    overscanCols: 1,
  }),
  HEIGHT,
)

const rangeText = ref('尚未滚动')

function refreshRange(): void {
  const current = table.value
  if (!current) {
    return
  }
  const { rows } = current.getVisibleRange()
  rangeText.value = `当前可视行 ${rows.start.toLocaleString()} – ${rows.end.toLocaleString()}（共 ${ROW_COUNT.toLocaleString()} 行）`
}

onMounted(() => {
  const current = table.value
  if (!current) {
    return
  }
  current.onScrollFrame(() => refreshRange())
  refreshRange()
})

function jump(row: number): void {
  table.value?.scrollToCell({ col: 0, row })
}

function jumpRandom(): void {
  jump(Math.floor(Math.random() * ROW_COUNT))
}
</script>

<template>
  <div class="demo-frame">
    <div class="demo-toolbar">
      <strong>实时示例</strong>
      <span>1,000,000 行 × 8 列，rowCount + resolveDisplayValue</span>
      <button type="button" @click="jump(0)">第一行</button>
      <button type="button" @click="jump(500_000)">中间</button>
      <button type="button" @click="jump(ROW_COUNT - 1)">最后一行</button>
      <button type="button" @click="jumpRandom">随机跳转</button>
    </div>
    <div class="demo-meta">{{ rangeText }}</div>
    <div ref="container" class="demo-canvas" :style="{ height: `${HEIGHT}px` }" />
  </div>
</template>
