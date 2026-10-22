<script setup lang="ts">
import { ref } from 'vue'
import {
  createChartPlugin,
  createWatermarkPlugin,
  type ChartCellDeclaration,
} from '@infinitable/plugins'
import { useDemoTable } from '../demo/use-demo-table'

const HEIGHT = 280
const LABELS = ['一月', '二月', '三月', '四月']

function declaration(col: number, row: number): ChartCellDeclaration | null {
  const shift = row * 8
  switch (col) {
    case 1:
      return {
        type: 'bar',
        labels: LABELS,
        datasets: [
          { label: '本年', data: [12 + shift, 26 + shift, 18 + shift, 32 + shift] },
          { label: '上年', data: [18 + shift, 14 + shift, 24 + shift, 20 + shift] },
        ],
      }
    case 2:
      return {
        type: 'line',
        labels: LABELS,
        datasets: [{ label: '趋势', data: [8 + shift, null, 22 + shift, 30 + shift] }],
      }
    case 3:
      return {
        type: 'area',
        labels: LABELS,
        datasets: [{ label: '累计', data: [6 + shift, 16 + shift, 12 + shift, 24 + shift] }],
      }
    case 4:
      return { type: 'pie', labels: LABELS, datasets: [{ label: '占比', data: [35, 25, 22, 18] }] }
    default:
      return null
  }
}

const chartPlugin = createChartPlugin({ resolveCellChart: (col, row) => declaration(col, row) })
const watermark = createWatermarkPlugin({ enabled: false, text: 'infinitable demo' })

const { container } = useDemoTable((width) => {
  const chartWidth = Math.max(110, Math.floor((width - 56 - 110) / 4))
  return {
    columns: [
      { title: '指标', width: 110 },
      { title: '柱状', width: chartWidth },
      { title: '折线', width: chartWidth },
      { title: '面积', width: chartWidth },
      { title: '饼图', width: chartWidth },
    ],
    rowCount: 2,
    rowHeight: 110,
    resolveDisplayValue: (col, row) => (col === 0 ? (row === 0 ? '营收' : '利润') : ''),
    plugins: [chartPlugin, watermark],
  }
}, HEIGHT)

const watermarkOn = ref(false)
const loading = ref(false)

function toggleWatermark(): void {
  watermarkOn.value = !watermarkOn.value
  watermark.updateConfig({ enabled: watermarkOn.value })
}

async function loadChart() {
  loading.value = true
  try {
    await chartPlugin.loadLibrary()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="demo-frame">
    <div class="demo-toolbar">
      <strong>实时示例</strong>
      <span>四类图表按格声明，Chart.js 首次出图时动态加载</span>
      <button type="button" @click="toggleWatermark">
        {{ watermarkOn ? '关闭水印' : '开启水印' }}
      </button>
      <button type="button" :disabled="loading" @click="loadChart">
        {{ loading ? '加载中…' : '预加载 Chart.js' }}
      </button>
    </div>
    <div ref="container" class="demo-canvas" :style="{ height: `${HEIGHT}px` }" />
  </div>
</template>
