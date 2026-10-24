#!/usr/bin/env node
// 空项目消费冒烟：以外部消费者姿态（无 dev 条件 → import → dist）验证各包可消费。
// 校验产物文件齐备 + 无头动态 import dist 产物跑一帧（含 infinitable ./sheet 子路径）
// + 主入口与 ./sheet 的跨入口 instanceof 契约（共享 engine chunk，单副本引擎实现）。
// 用法：node scripts/check-package-exports.mjs（先 bun run build）

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { Window } from 'happy-dom'

// 无头 DOM 垫片（happy-dom，根 devDependency）：SheetGrid 构造需要 document 容器与
// ResizeObserver；画布 2d 上下文为 null，引擎各消费点容忍（与注入式假画布同口径）。
const domWindow = new Window({ url: 'http://localhost/' })
globalThis.window = domWindow
globalThis.document = domWindow.document
globalThis.getComputedStyle = domWindow.getComputedStyle.bind(domWindow)
if (typeof domWindow.ResizeObserver === 'function')
  globalThis.ResizeObserver = domWindow.ResizeObserver

const PACKAGES = [
  { name: '@infinitable/render', dir: 'packages/render', bundle: 'dist/render.js' },
  { name: '@infinitable/grid', dir: 'packages/grid', bundle: 'dist/grid.js' },
  { name: '@infinitable/table', dir: 'packages/table', bundle: 'dist/table.js' },
  { name: '@infinitable/formulas', dir: 'packages/formulas', bundle: 'dist/formulas.js' },
  { name: '@infinitable/plugins', dir: 'packages/plugins', bundle: 'dist/plugins.js' },
  { name: '@infinitable/sheet', dir: 'packages/sheet', bundle: 'dist/sheet.js' },
  { name: 'infinitable', dir: 'packages/infinitable', bundle: 'dist/infinitable.js' },
]

let failed = false
const fail = (message) => {
  failed = true
  console.error(`  ✗ ${message}`)
}
const ok = (message) => console.log(`  ✓ ${message}`)

// 1) 产物文件齐备
console.log('[check-exports] 产物文件')
for (const pkg of PACKAGES) {
  const bundle = new URL(`../${pkg.dir}/${pkg.bundle}`, import.meta.url).pathname
  const types = new URL(`../${pkg.dir}/dist/types/index.d.ts`, import.meta.url).pathname
  if (!existsSync(bundle)) fail(`${pkg.name} 缺 ${pkg.bundle}`)
  else if (!existsSync(types)) fail(`${pkg.name} 缺 dist/types/index.d.ts`)
  else ok(`${pkg.name}: ${pkg.bundle} + d.ts`)
}
if (failed) process.exit(1)

// 2) 外部消费者姿态导入 dist 产物（无 dev 条件；grid/table/render 间依赖经各自
//    node_modules 的 workspace 链接按 exports import 条件解析，与 npm 消费一致）
console.log('[check-exports] dist 消费冒烟（bun 无头）')
const { createRenderHost } = await import(
  new URL('../packages/render/dist/render.js', import.meta.url)
)
const { ListTable } = await import(new URL('../packages/table/dist/table.js', import.meta.url))

/** 无头假画布：2d 上下文返回 null（引擎各消费点均需容忍），尺寸记录 */
function createNoopCanvas() {
  return {
    width: 0,
    height: 0,
    getContext: () => null,
  }
}

const scheduled = []
const host = createRenderHost({
  width: 400,
  height: 200,
  createCanvas: createNoopCanvas,
  scheduleFrame: (callback) => {
    scheduled.push(callback)
    return scheduled.length
  },
  cancelFrame: () => {},
})
const table = new ListTable({
  width: 400,
  height: 200,
  columns: [
    { field: 'name', title: 'Name', editor: 'text' },
    { field: 'qty', title: 'Qty' },
  ],
  records: Array.from({ length: 50 }, (_, i) => ({ name: `r${i}`, qty: i })),
  host,
})
table.host.submitInvalidation('body', { type: 'full' })
for (const task of scheduled.splice(0)) {
  task()
}
const text = table.getCellText(0, 0)
if (text !== 'r0') fail(`dist 产物取值异常：getCellText(0,0) = ${text}`)
else ok('dist 建表 + 取值 + 帧调度 flush 正常')
table.destroy()

// 3) plugins dist 可导入（插件对象形态：chart/print/watermark 三插件工厂；
//    sheet 能力已整体迁入 @infinitable/sheet，createSheetPlugin 不再存在）
const pluginsModule = await import(new URL('../packages/plugins/dist/plugins.js', import.meta.url))
const pluginFactories = ['createChartPlugin', 'createWatermarkPlugin', 'createPrintPlugin']
for (const key of pluginFactories) {
  if (typeof pluginsModule[key] !== 'function') fail(`plugins dist 缺 ${key}`)
}
if (typeof pluginsModule.createSheetPlugin === 'function')
  fail('plugins dist 不应再有 createSheetPlugin')
if (!failed) ok('plugins dist 插件工厂可导入')

// 4) formulas dist 可导入并无头求值（含 @cat-kit/core 精确计算）
const formulasModule = await import(
  new URL('../packages/formulas/dist/formulas.js', import.meta.url)
)
if (typeof formulasModule.evaluate !== 'function') {
  fail('formulas dist 缺 evaluate')
} else {
  const resolver = { cell: () => null, range: () => [] }
  const precise = formulasModule.evaluate('0.1+0.2', resolver)
  if (precise !== 0.3) fail(`formulas 精确计算异常：0.1+0.2 = ${precise}`)
  else if (formulasModule.listFormulaFunctions().length < 47) fail('formulas 内置函数缺失')
  else ok('formulas dist 求值正常（0.1+0.2=0.3）')
}
// 5) 统一发布包 dist 可导入（五层 re-export 单包 + ./sheet 子路径）且 JS/类型产物
//    均无 @infinitable 裸依赖残留（口径：真实模块说明符，JSDoc 注释提及不算）
console.log('[check-exports] 统一发布包 dist 冒烟')
const unifiedModule = await import(
  new URL('../packages/infinitable/dist/infinitable.js', import.meta.url)
)
for (const key of ['ListTable', 'createRenderHost', 'evaluate']) {
  if (typeof unifiedModule[key] !== 'function') fail(`infinitable dist 缺 ${key}`)
}
const unifiedJs = readFileSync(
  new URL('../packages/infinitable/dist/infinitable.js', import.meta.url),
  'utf8',
)
if (/@infinitable\//.test(unifiedJs))
  fail('infinitable dist JS 残留 @infinitable/* 裸导入（未整体打包）')
const typesDir = new URL('../packages/infinitable/dist/types/', import.meta.url)
// 裸导入口径：from/import 后跟 '@infinitable/...' 的说明符；注释文字命中不算
const BARE_SPECIFIER = /(?:from|import)\s*\(?\s*['"]@infinitable\//
const leakedTypes = readdirSync(typesDir, { recursive: true })
  .filter((entry) => String(entry).endsWith('.d.ts'))
  .filter((entry) => BARE_SPECIFIER.test(readFileSync(new URL(`${entry}`, typesDir), 'utf8')))
if (leakedTypes.length) fail(`infinitable 类型残留裸导入：${leakedTypes.join('、')}`)
if (!failed) ok('infinitable dist 五层 re-export 齐备且自包含（JS + 类型）')

// 6) ./sheet 子路径：dist/sheet.js 无头建簿设值求值（捆绑的 table/grid/formulas 一并过电）
const sheetDts = new URL('../packages/infinitable/dist/types/sheet.d.ts', import.meta.url)
if (!existsSync(sheetDts)) fail('infinitable 缺 ./sheet 子路径类型垫片 dist/types/sheet.d.ts')
const sheetModule = await import(new URL('../packages/infinitable/dist/sheet.js', import.meta.url))
const workbook = new sheetModule.Workbook()
const active = workbook.activeSheet
active.setCellValue({ row: 0, col: 0 }, 21)
active.setCellFormula({ row: 0, col: 1 }, '=A1*2')
const cell = active.getCellData({ row: 0, col: 1 })
if (cell?.v !== 42) fail(`infinitable/sheet 求值异常：=A1*2 → ${JSON.stringify(cell)}`)
else ok('infinitable/sheet 子路径可导入且无头求值正常（=A1*2=42）')

// 7) 跨入口 instanceof 契约：主入口与 ./sheet 产物必须共享同一份引擎实现
//    （构建层由 packages/infinitable/vite.config.ts 的 'engine' 共享 chunk 钉死）。
//    结构面断言两 entry 消费同一 engine chunk；运行面经 sheet 侧构造的 SheetGrid
//    引擎实例对主入口导出的 ListTable / MergeCellMap / MergeOverlapError 做 instanceof。
console.log('[check-exports] 跨入口 instanceof 契约')
const distDir = new URL('../packages/infinitable/dist/', import.meta.url)
const engineChunks = readdirSync(distDir).filter(
  (file) => file.startsWith('engine-') && file.endsWith('.js'),
)
if (engineChunks.length !== 1)
  fail(`engine 共享 chunk 应恰有 1 份，实际 ${engineChunks.length} 份：${engineChunks.join('、')}`)
else {
  for (const entry of ['infinitable.js', 'sheet.js']) {
    const source = readFileSync(new URL(entry, distDir), 'utf8')
    if (!source.includes(`"./${engineChunks[0]}"`))
      fail(`${entry} 未消费共享 engine chunk ${engineChunks[0]}（引擎副本分裂）`)
  }
  if (!failed) ok(`主入口与 ./sheet 消费同一 engine chunk（${engineChunks[0]}）`)
}
const contractWorkbook = new sheetModule.Workbook()
const contractContainer = document.createElement('div')
document.body.appendChild(contractContainer)
const sheetGrid = new sheetModule.SheetGrid({
  sheet: contractWorkbook.activeSheet,
  container: contractContainer,
  width: 400,
  height: 300,
})
const engine = sheetGrid.getTable()
if (!(engine instanceof unifiedModule.ListTable))
  fail('sheet 侧引擎实例不是主入口 ListTable（引擎类身份分裂）')
else ok('sheet 侧 SheetGrid 引擎 instanceof 主入口 ListTable')
if (!(engine.mergeCells instanceof unifiedModule.MergeCellMap))
  fail('sheet 侧引擎合并区集合不是主入口 MergeCellMap（引擎类身份分裂）')
else ok('sheet 侧引擎 mergeCells instanceof 主入口 MergeCellMap')
engine.setMergeCells([{ startCol: 0, startRow: 0, endCol: 2, endRow: 2 }])
let overlapError = null
try {
  engine.addMergeCell({ startCol: 1, startRow: 1, endCol: 3, endRow: 3 })
  fail('重叠合并未 fail-fast 抛错（addMergeCell 应抛 MergeOverlapError）')
} catch (error) {
  overlapError = error
}
if (overlapError !== null) {
  if (overlapError.name !== 'MergeOverlapError')
    fail(`重叠合并抛错类型异常：${overlapError.name}`)
  else if (!(overlapError instanceof unifiedModule.MergeOverlapError))
    fail('sheet 侧抛出的重叠合并错误不是主入口 MergeOverlapError（引擎类身份分裂）')
  else ok('sheet 侧 fail-fast 抛错 instanceof 主入口 MergeOverlapError')
}
sheetGrid.release()
console.log(failed ? '[check-exports] FAIL' : '[check-exports] PASS')
process.exit(failed ? 1 : 0)
