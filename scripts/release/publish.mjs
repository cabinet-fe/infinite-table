#!/usr/bin/env node
// 发版脚本：发布统一包 packages/infinitable（仓内四层 workspace 依赖仅供开发，
// 已整体打进 dist，发布前临时剥离 devDependencies，发布后还原）。
// 同名同版本已存在于 registry 则跳过（tag 重跑幂等，不与已发布版本冲突）。
// 用法：node scripts/release/publish.mjs [--dry-run]
// 鉴权：CI 上 npm >= 11.5.1 自动探测 OIDC trusted publishing；本地首发用 --userconfig 指向含 token 的临时 npmrc。

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dryRun = process.argv.includes('--dry-run')

const pkg = JSON.parse(readFileSync(path.join(root, 'packages/infinitable/package.json'), 'utf8'))

const bundle = path.join(root, 'packages/infinitable/dist/infinitable.js')
const types = path.join(root, 'packages/infinitable/dist/types/index.d.ts')
if (!existsSync(bundle) || !existsSync(types)) {
  console.error(`✗ 缺构建产物（先 bun run build）：${bundle} 或 ${types}`)
  process.exit(1)
}

function isPublished(pkgName, version) {
  try {
    return (
      execFileSync('npm', ['view', `${pkgName}@${version}`, 'version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() === version
    )
  } catch {
    return false
  }
}

if (!dryRun && isPublished(pkg.name, pkg.version)) {
  console.log(`↷ ${pkg.name}@${pkg.version} 已在 registry，跳过`)
  process.exit(0)
}

const dir = path.join(root, 'packages/infinitable')
const original = readFileSync(path.join(dir, 'package.json'), 'utf8')
try {
  const { devDependencies, ...publishable } = pkg
  writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(publishable, null, 2)}\n`)
  console.log(`▸ ${dryRun ? 'dry-run ' : ''}publish ${pkg.name}@${pkg.version}`)
  execFileSync('npm', ['publish', dir, '--access', 'public', ...(dryRun ? ['--dry-run'] : [])], {
    stdio: 'inherit',
  })
} catch (error) {
  console.error(`✗ ${pkg.name} 发布失败：${error.message}`)
  process.exitCode = 1
} finally {
  writeFileSync(path.join(dir, 'package.json'), original)
}
