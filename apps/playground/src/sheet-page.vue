<!-- 演练场主页面：移植自 ultra-ui playground/src/sheet/index.vue（组件与预置数据原样，
     观察区精简为调试句柄）。USheet 的渲染引擎经 vite alias 替换为 @infinite-table/core。 -->
<template>
  <div class="pg-page">
    <header class="pg-header">
      <h1>ultra-ui sheet × infinite-table 引擎</h1>
      <p>
        USheet（@veltra/sheet，源码直连）+ Sheet 模型（@veltra/sheet-core）， 底层网格由
        <code>@veltra/sheet-core/grid</code> → 本仓 ListTable 适配（veltra-grid）。 控制台可用
        <code>window.__PG__</code> 调试。
      </p>
    </header>
    <u-sheet
      ref="sheetRef"
      :workbook="workbook"
      :resolve-cell-renderer="resolveCellRenderer"
      :rows="30"
      class="pg-sheet"
    />
  </div>
</template>

<script lang="ts" setup>
import { USheet, type SheetExposed } from '@veltra/sheet'
import {
  Workbook,
  coerceToNumber,
  isFormulaError,
  registerFormulaFunction,
} from '@veltra/sheet-core'
import type { CellAddress, CellValue } from '@veltra/sheet-core'
import { onMounted, useTemplateRef } from 'vue'
// CustomLayout / 布局对象类型取自本仓 veltra-grid 适配层：vite alias 下它就是
// '@veltra/sheet-core/grid' 的运行时实现（直连同一模块，类型零跨越）
import { CustomLayout } from './veltra-grid/index'

// 自定义公式函数示例（与 ultra-ui playground 同款；$n.mul 换原生乘法去掉 @cat-kit 依赖）
registerFormulaFunction('DOUBLE', {
  minArgs: 1,
  maxArgs: 1,
  meta: { params: ['number'], description: '返回数字的两倍（自定义函数示例）' },
  impl(args) {
    const value = coerceToNumber(args[0]!)
    if (isFormulaError(value)) return value
    return value * 2
  },
})

// 工作簿：两个 sheet 共享公式依赖图（跨表引用与联动重算的中枢）
const workbook = new Workbook()
const sheet1 = workbook.activeSheet // 默认 Sheet1
const sheet2 = workbook.addSheet('Sheet2')

// 预置 Sheet2 数据源
sheet2.setCellValue({ row: 0, col: 0 }, '项目')
sheet2.setCellValue({ row: 0, col: 1 }, '数量')
sheet2.setCellValue({ row: 1, col: 0 }, '苹果')
sheet2.setCellValue({ row: 1, col: 1 }, 42)
sheet2.setCellValue({ row: 2, col: 0 }, '香蕉')
sheet2.setCellValue({ row: 2, col: 1 }, 35)
sheet2.setCellValue({ row: 3, col: 0 }, '橙子')
sheet2.setCellValue({ row: 3, col: 1 }, 58)

// 预置 Sheet1：跨表公式 + 同表联动 + 合并 + 填充序列
sheet1.setCellValue({ row: 0, col: 0 }, '跨表汇总')
sheet1.setCellFormula({ row: 0, col: 1 }, '=SUM(Sheet2!B2:B4)')
sheet1.setCellValue({ row: 1, col: 0 }, 'Sheet2 首项×2')
sheet1.setCellFormula({ row: 1, col: 1 }, '=Sheet2!B2*2')
sheet1.setCellValue({ row: 2, col: 0 }, '本表 B1÷2')
sheet1.setCellFormula({ row: 2, col: 1 }, '=B1/2')
sheet1.setCellValue({ row: 3, col: 0 }, '自定义函数 DOUBLE')
sheet1.setCellFormula({ row: 3, col: 1 }, '=DOUBLE(Sheet2!B2)')
sheet1.mergeCells({ start: { row: 4, col: 1 }, end: { row: 5, col: 2 } })
sheet1.setCellValue({ row: 4, col: 1 }, '合并区(B5:C6)')
sheet1.setCellValue({ row: 0, col: 3 }, '序列')
sheet1.setCellValue({ row: 1, col: 3 }, 1)
sheet1.setCellValue({ row: 2, col: 3 }, 2)
sheet1.setCellValue({ row: 0, col: 4 }, 'tile')
sheet1.setCellValue({ row: 1, col: 4 }, 'a')
sheet1.setCellValue({ row: 2, col: 4 }, 'b')
sheet1.setCellValue({ row: 0, col: 5 }, '示例图→')
sheet1.insertImage({
  data: createDemoPngBytes(),
  type: 'png',
  anchor: { from: { row: 1, col: 5 } },
  width: 64,
  height: 48,
  altText: 'demo',
  title: 'playground demo',
})
// ---- 自定义渲染锚点格（ADR-0004）：布局对象模块级静态构建，分发热路径零分配；
// 仅值非空的锚点格返回布局对象（清空值即回落默认渲染），渲染不写模型、不进快照 ----
/** 文本徽标锚点 B12：居中加粗红字（Text 形态：对齐/字重/字号/颜色字段） */
const TEXT_ANCHOR = { row: 11, col: 1 }
/** 状态条锚点 D12：左缘 4px 绿色竖条（Rect 形态：显式宽 + 缺省坐标/高兜整格） */
const BAR_ANCHOR = { row: 11, col: 3 }
sheet1.setCellValue(TEXT_ANCHOR, '进行中')
sheet1.setCellValue(BAR_ANCHOR, '已接入')

// 预置数据作为初始状态，不进入 undo 历史
sheet1.history.clear()
sheet2.history.clear()

const textBadgeLayout = new CustomLayout({
  type: 'text',
  textAlign: 'center',
  fontWeight: 'bold',
  fontSize: 12,
  fill: '#c50f1f',
})
const barLayout = new CustomLayout({ type: 'rect', width: 4, fill: '#22a06b' })

/** 按格分发：锚点格返回布局对象，其余 undefined 回落默认渲染 */
function resolveCellRenderer(addr: CellAddress, base: CellValue | undefined) {
  if (addr.row === TEXT_ANCHOR.row && addr.col === TEXT_ANCHOR.col) {
    return base ? textBadgeLayout : undefined
  }
  if (addr.row === BAR_ANCHOR.row && addr.col === BAR_ANCHOR.col) {
    return base ? barLayout : undefined
  }
  return undefined
}

/** canvas 导出小尺寸 png 字节，供演示预置（不依赖外部资源） */
function createDemoPngBytes(): Uint8Array {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 48
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#2563eb'
  ctx.fillRect(0, 0, 64, 48)
  ctx.fillStyle = '#93c5fd'
  ctx.fillRect(4, 4, 56, 40)
  ctx.fillStyle = '#1e3a8a'
  ctx.font = 'bold 16px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('IMG', 32, 24)
  const dataUrl = canvas.toDataURL('image/png')
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const sheetRef = useTemplateRef<SheetExposed>('sheetRef')

// 控制台调试句柄
onMounted(() => {
  ;(window as unknown as Record<string, unknown>).__PG__ = {
    workbook,
    sheet: () => sheetRef.value?.getActiveSheet(),
    grid: () => sheetRef.value?.getGrid(),
    // 自定义渲染锚点格信息（pg-spec 断言 renderer 生效/回落用）
    customAnchors: [
      { addr: TEXT_ANCHOR, kind: 'text-badge' },
      { addr: BAR_ANCHOR, kind: 'bar' },
    ],
  }
})
</script>

<style scoped>
.pg-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 12px 16px;
  box-sizing: border-box;
  gap: 8px;
}

.pg-header h1 {
  font-size: 16px;
  margin: 0 0 4px;
}

.pg-header p {
  font-size: 12px;
  color: #606972;
  margin: 0;
}

.pg-sheet {
  flex: 1;
  min-height: 0;
}
</style>
