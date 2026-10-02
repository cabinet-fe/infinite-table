#!/usr/bin/env node
// 空项目消费冒烟：以外部消费者姿态（无 dev 条件 → import → dist）验证各包可消费。
// 校验三条件产物文件齐备 + bun 动态 import core/render dist 产物无头建表跑一帧。
// 用法：node scripts/check-package-exports.mjs（先 bun run build）

import { existsSync, readFileSync, readdirSync } from 'node:fs'

const PACKAGES = [
  { name: '@infinitable/render', dir: 'packages/render', bundle: 'dist/render.js' },
  { name: '@infinitable/core', dir: 'packages/core', bundle: 'dist/core.js' },
  { name: '@infinitable/formulas', dir: 'packages/formulas', bundle: 'dist/formulas.js' },
  { name: '@infinitable/plugins', dir: 'packages/plugins', bundle: 'dist/plugins.js' },
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

// 2) 外部消费者姿态导入 dist 产物（无 dev 条件；core/render 间依赖经各自
//    node_modules 的 workspace 链接按 exports import 条件解析，与 npm 消费一致）
console.log('[check-exports] dist 消费冒烟（bun 无头）')
const { createRenderHost } = await import(
  new URL('../packages/render/dist/render.js', import.meta.url)
)
const { ListTable } = await import(new URL('../packages/core/dist/core.js', import.meta.url))

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

// 3) plugins dist 可导入（SheetStore）
const pluginsModule = await import(new URL('../packages/plugins/dist/plugins.js', import.meta.url))
if (typeof pluginsModule.SheetStore !== 'function') fail('plugins dist 缺 SheetStore')
else ok('plugins dist SheetStore 可导入')

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
// 5) 统一发布包 dist 可导入（四层 re-export 单包）且 JS/类型产物均无 @infinitable 裸依赖残留
console.log('[check-exports] 统一发布包 dist 冒烟')
const unifiedModule = await import(
  new URL('../packages/infinitable/dist/infinitable.js', import.meta.url)
)
for (const key of ['ListTable', 'createRenderHost', 'SheetStore', 'evaluate']) {
  if (typeof unifiedModule[key] !== 'function') fail(`infinitable dist 缺 ${key}`)
}
const unifiedJs = readFileSync(
  new URL('../packages/infinitable/dist/infinitable.js', import.meta.url),
  'utf8',
)
if (/@infinitable\//.test(unifiedJs))
  fail('infinitable dist JS 残留 @infinitable/* 裸导入（未整体打包）')
const typesDir = new URL('../packages/infinitable/dist/types/', import.meta.url)
const leakedTypes = readdirSync(typesDir, { recursive: true })
  .filter((entry) => String(entry).endsWith('.d.ts'))
  .filter((entry) => readFileSync(new URL(`${entry}`, typesDir), 'utf8').includes('@infinitable/'))
if (leakedTypes.length) fail(`infinitable 类型残留裸导入：${leakedTypes.join('、')}`)
if (!failed) ok('infinitable dist 四层 re-export 齐备且自包含（JS + 类型）')
console.log(failed ? '[check-exports] FAIL' : '[check-exports] PASS')
process.exit(failed ? 1 : 0)
