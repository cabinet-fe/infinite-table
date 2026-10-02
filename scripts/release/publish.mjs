#!/usr/bin/env node
// 发版共用脚本：按依赖序 npm publish 四包；workspace:* 临时改写为对应包当前版本，发布后还原。
// 同名同版本已存在于 registry 则跳过（tag 重跑幂等，不与已发布版本冲突）。
// 用法：node scripts/release/publish.mjs [--dry-run]
// 鉴权：CI 上 npm >= 11.5.1 自动探测 OIDC trusted publishing；本地首发用 --userconfig 指向含 token 的临时 npmrc。

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// 依赖序：render 无内部依赖；core 依赖 render；formulas 独立；plugins 依赖 core/render
const ORDER = ['render', 'core', 'formulas', 'plugins']
const dryRun = process.argv.includes('--dry-run')

const readPkg = (name) =>
  JSON.parse(readFileSync(path.join(root, 'packages', name, 'package.json'), 'utf8'))
const packages = ORDER.map((name) => ({ name, pkg: readPkg(name) }))
const versions = Object.fromEntries(packages.map(({ pkg }) => [pkg.name, pkg.version]))

function withRealWorkspaceDeps(pkg) {
  const dependencies = { ...pkg.dependencies }
  for (const [dep, range] of Object.entries(dependencies)) {
    if (!range.startsWith('workspace:')) continue
    if (range !== 'workspace:*')
      throw new Error(`不支持的 workspace 范围：${pkg.name} 的 ${dep}@${range}（仅 workspace:*）`)
    dependencies[dep] = versions[dep]
  }
  return { ...pkg, dependencies }
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

let failed = false
for (const { name, pkg } of packages) {
  const dir = path.join(root, 'packages', name)
  const bundle = path.join(dir, 'dist', `${name}.js`)
  const types = path.join(dir, 'dist', 'types', 'index.d.ts')
  if (!existsSync(bundle) || !existsSync(types)) {
    console.error(`✗ ${pkg.name}：缺构建产物（先 bun run build）：${bundle} 或 ${types}`)
    failed = true
    continue
  }
  if (!dryRun && isPublished(pkg.name, pkg.version)) {
    console.log(`↷ ${pkg.name}@${pkg.version} 已在 registry，跳过`)
    continue
  }
  const original = readFileSync(path.join(dir, 'package.json'), 'utf8')
  try {
    writeFileSync(
      path.join(dir, 'package.json'),
      `${JSON.stringify(withRealWorkspaceDeps(pkg), null, 2)}\n`,
    )
    console.log(`▸ ${dryRun ? 'dry-run ' : ''}publish ${pkg.name}@${pkg.version}`)
    execFileSync('npm', ['publish', dir, '--access', 'public', ...(dryRun ? ['--dry-run'] : [])], {
      stdio: 'inherit',
    })
  } catch (error) {
    failed = true
    console.error(`✗ ${pkg.name} 发布失败：${error.message}`)
  } finally {
    writeFileSync(path.join(dir, 'package.json'), original)
  }
}
process.exit(failed ? 1 : 0)
