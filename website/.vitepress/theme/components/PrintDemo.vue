<script setup lang="ts">
import { ref } from 'vue'
import type { CellStyle } from '@infinitable/grid'
import { createPrintPlugin, type PrintSource } from '@infinitable/plugins'
import { useDemoTable } from '../demo/use-demo-table'

const HEIGHT = 300
const DATA_ROWS = 60
const ROW_COUNT = DATA_ROWS + 1
const COLUMNS = [
  { title: '序号', width: 70 },
  { title: '城市', width: 140 },
  { title: '销售额', width: 140 },
]
const CITIES = ['上海', '杭州', '北京', '天津', '广州', '成都']

function cellValue(col: number, row: number): unknown {
  if (row === 0) {
    return ['序号', '城市', '销售额'][col] ?? null
  }
  if (col === 0) {
    return row
  }
  if (col === 1) {
    return CITIES[row % CITIES.length]
  }
  return 180 + ((row * 37) % 220)
}

function cellStyle(col: number, row: number): CellStyle | undefined {
  if (row === 0) {
    return { fontWeight: 700, background: '#eef2f7', textAlign: 'center' }
  }
  return undefined
}

const source: PrintSource = {
  name: '城市销售明细',
  rowCount: ROW_COUNT,
  colCount: COLUMNS.length,
  rowHeight: () => 30,
  colWidth: (col) => COLUMNS[col]?.width ?? 100,
  merges: () => [],
  cellValue,
  cellStyle,
  displayValue: cellValue,
}

const printer = createPrintPlugin({
  source,
  config: {
    paperSize: 'A4',
    orientation: 'portrait',
    paging: 'fitpage',
    headerRepeatRows: 1,
    headerFooter: {
      footer: { center: '第 {page} 页 / 共 {pageCount} 页', right: '{date} {time}' },
    },
  },
})

const { container } = useDemoTable(
  (width) => ({
    columns: [
      { title: '序号', width: 70 },
      { title: '城市', width: Math.max(140, width - 56 - 70 - 140) },
      { title: '销售额', width: 140 },
    ],
    rowCount: ROW_COUNT,
    rowHeight: 30,
    resolveDisplayValue: (col, row) => String(cellValue(col, row) ?? ''),
    resolveCellStyle: (col, row) => cellStyle(col, row) ?? null,
    resolveEditable: () => false,
    canResizeCol: () => false,
    canResizeRow: () => false,
  }),
  HEIGHT,
)

const pageCount = ref(printer.paginate().length)
const message = ref(`当前配置分页为 ${pageCount.value} 页`)

function runPrint(): void {
  message.value = '已调起浏览器打印（打印内容只包含报表页面）'
  void printer.print()
}

function openPreview(): void {
  message.value = '已打开 DOM 预览，可在预览内继续打印'
  printer.openPreview()
}
</script>

<template>
  <div class="demo-frame">
    <div class="demo-toolbar">
      <strong>实时示例</strong>
      <span>同一数据源：屏上表格 + headless 分页 + iframe 打印</span>
      <button type="button" @click="runPrint">打印</button>
      <button type="button" @click="openPreview">DOM 预览</button>
    </div>
    <div class="demo-meta">{{ message }}</div>
    <div ref="container" class="demo-canvas" :style="{ height: `${HEIGHT}px` }" />
  </div>
</template>
