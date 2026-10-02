#!/usr/bin/env node
// 统一发布包类型装配：把四个内部包的 dist/types 树复制为 dist/types/<pkg>/，
// 跨包 '@infinitable/*' 裸说明符改写为相对路径（指向 <pkg>/index.js，TS 按 .js→.d.ts 解析），
// 最后生成根 index.d.ts re-export 垫片。前置：四内部包与本体 vp build 已完成。

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(pkgRoot, '../..')
const INTERNAL = ['render', 'core', 'formulas', 'plugins']
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

for (const file of walkDts(typesDir)) {
  const source = readFileSync(file, 'utf8')
  const rewritten = source.replace(
    /(['"])@infinitable\/(core|render|plugins|formulas)\1/g,
    (match, quote, name) => {
      let rel = path
        .relative(path.dirname(file), path.join(typesDir, name, 'index.js'))
        .replaceAll('\\', '/')
      if (!rel.startsWith('.')) rel = `./${rel}`
      return `${quote}${rel}${quote}`
    },
  )
  if (rewritten !== source) writeFileSync(file, rewritten)
}

writeFileSync(
  path.join(typesDir, 'index.d.ts'),
  `${INTERNAL.map((name) => `export * from './${name}/index.js'`).join('\n')}\n`,
)
console.log(`✓ 类型装配完成：dist/types（${INTERNAL.join(' + ')} + index 垫片）`)
