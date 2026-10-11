#!/usr/bin/env bun
/**
 * CI 专用：changeset publish 前剥离待发布包的 devDependencies。
 *
 * infinitable 的 devDependencies 全部是 workspace 内部开发包（@infinitable/*，
 * private、不发布、版本 0.0.0），dist 已整体打包，运行时不需要它们；workspace:
 * 协议无法发布，重写为 0.0.0 又会产生坏元数据，因此整体剥离。
 *
 * 只在 CI 的临时工作区运行，改动不落库；本地误跑后用 `git restore` 恢复。
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PACKAGES_DIR = resolve(__dirname, '..', '..', 'packages')

interface PackageJson {
  name?: string
  private?: boolean
  devDependencies?: Record<string, string>
  [key: string]: unknown
}

function main(): void {
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const file = join(PACKAGES_DIR, entry.name, 'package.json')
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as PackageJson
    if (pkg.private === true || !pkg.devDependencies) continue

    delete pkg.devDependencies
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
    console.log(`[normalize-manifest] 已剥离 ${pkg.name ?? file} 的 devDependencies`)
  }
}

main()
