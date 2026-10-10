#!/usr/bin/env node
// 统一发布包类型装配：把五个内部包的 dist/types 树复制为 dist/types/<pkg>/，
// 跨包 '@infinitable/*' 裸说明符改写为相对路径（指向 <pkg>/index.js，TS 按 .js→.d.ts 解析），
// 最后由 src/index.ts / src/sheet.ts 源文本同口径生成根 index.d.ts 与 sheet.d.ts 垫片
// （两入口均为纯 re-export，垫片 = 源文本 + 裸说明符改写，dist 类型面与 src 显式导出面恒一致）。
// 前置：五内部包与本体 vp build 已完成。

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(pkgRoot, '../..')
const INTERNAL = ['render', 'core', 'formulas', 'plugins', 'sheet']
const typesDir = path.join(pkgRoot, 'dist', 'types')

function walkDts(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkDts(full))
    else if (entry.name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

for (const name of INTERNAL) {
  const src = path.join(repoRoot, 'packages', name, 'dist', 'types')
  if (!existsSync(path.join(src, 'index.d.ts'))) {
    console.error(`✗ 缺 ${name} 类型产物（先 bun run build）`)
    process.exit(1)
  }
  const dst = path.join(typesDir, name)
  rmSync(dst, { recursive: true, force: true })
  cpSync(src, dst, { recursive: true })
  rmSync(path.join(dst, '.tsbuildinfo'), { force: true })
}

/**
 * 把源文本里的 @infinitable/* 裸说明符改写为 dist/types 内相对路径。
 * 只匹配 from/import 语句上下文（注释文字提及不算），目标按 .js 写出、TS 按 .d.ts 解析。
 */
function rewriteBareSpecifiers(source, fromFile) {
  return source.replace(
    /((?:\bfrom|\bimport)\s*\(?\s*)(['"])@infinitable\/(core|render|plugins|formulas|sheet)\2/g,
    (match, prefix, quote, name) => {
      let rel = path
        .relative(path.dirname(fromFile), path.join(typesDir, name, 'index.js'))
        .replaceAll('\\', '/')
      if (!rel.startsWith('.')) rel = `./${rel}`
      return `${prefix}${quote}${rel}${quote}`
    },
  )
}

for (const file of walkDts(typesDir)) {
  const source = readFileSync(file, 'utf8')
  const rewritten = rewriteBareSpecifiers(source, file)
  if (rewritten !== source) writeFileSync(file, rewritten)
}

// 根垫片与 src 同口径：直接取 src/index.ts / src/sheet.ts 源文本改写裸说明符——
// 两个入口都是纯 re-export（无本地声明），作为 .d.ts 合法；如此 dist 类型面与
// src 显式导出面恒一致（外部 TS 用户类型可见面 == 运行时面，不再星号放大）。
for (const entry of ['index', 'sheet']) {
  const entrySource = readFileSync(path.join(pkgRoot, 'src', `${entry}.ts`), 'utf8')
  const target = path.join(typesDir, `${entry}.d.ts`)
  writeFileSync(target, rewriteBareSpecifiers(entrySource, target))
}
console.log(`✓ 类型装配完成：dist/types（${INTERNAL.join(' + ')} + index/sheet 垫片）`)
