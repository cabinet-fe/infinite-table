<script setup lang="ts">
import { ref } from 'vue'
import { useDemoTable } from '../demo/use-demo-table'

const ROW_COUNT = 100_000
const HEIGHT = 360

const records = Array.from({ length: ROW_COUNT }, (_, row) => ({
  id: `ID-${row}`,
  name: `商品-${row}`,
  qty: row % 97,
  price: ((row * 13) % 500) + 1,
}))

const { container, table } = useDemoTable((width) => {
  // 名称列吃掉剩余宽度，让四列铺满容器
  const available = Math.max(340, width - 56)
  return {
    columns: [
      { field: 'id', title: '编号', width: 120 },
      { field: 'name', title: '名称', width: Math.max(160, available - 340) },
      { field: 'qty', title: '数量', width: 100 },
      { field: 'price', title: '单价', width: 120 },
    ],
    records,
    frozenColCount: 1,
    theme: {
      header: { background: '#dbeafe', color: '#1d4ed8', fontWeight: 600 },
      body: { borderColor: '#e2e8f0' },
    },
  }
}, HEIGHT)

const targetRow = ref(5000)

function jumpToRow(): void {
  const row = Math.min(ROW_COUNT - 1, Math.max(0, Number(targetRow.value) || 0))
  table.value?.scrollToCell({ col: 0, row })
}
</script>

<template>
  <div class="demo-frame">
    <div class="demo-toolbar">
      <strong>实时示例</strong>
      <span>{{ ROW_COUNT.toLocaleString() }} 行 × 4 列，冻结首列</span>
      <label>
        跳转行
        <input v-model="targetRow" type="number" min="0" :max="ROW_COUNT - 1" />
      </label>
      <button type="button" @click="jumpToRow">滚动到该行</button>
      <span class="demo-hint">滚轮 / 键盘 / 拖拽滚动条均可操作</span>
    </div>
    <div ref="container" class="demo-canvas" :style="{ height: `${HEIGHT}px` }" />
  </div>
</template>
