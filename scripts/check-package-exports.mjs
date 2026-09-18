#!/usr/bin/env node
// 空项目消费冒烟：以外部消费者姿态（无 dev 条件 → import → dist）验证四包可消费。
// 校验三条件产物文件齐备 + bun 动态 import core/render dist 产物无头建表跑一帧。
// 用法：node scripts/check-package-exports.mjs（先 bun run build）

import { existsSync } from 'node:fs'

const PACKAGES = [
  { name: '@infinite-table/render', dir: 'packages/render', bundle: 'dist/render.js' },
  { name: '@infinite-table/core', dir: 'packages/core', bundle: 'dist/core.js' },
  { name: '@infinite-table/plugins', dir: 'packages/plugins', bundle: 'dist/plugins.js' },
  { name: '@infinite-table/utils', dir: 'packages/utils', bundle: 'dist/utils.js' },
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
console.log(failed ? '[check-exports] FAIL' : '[check-exports] PASS')
process.exit(failed ? 1 : 0)
