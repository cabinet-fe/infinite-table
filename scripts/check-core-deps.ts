// 依赖扫描：packages/grid 与 packages/table（自 core 拆出的引擎内核）禁止 import 任何 @visactor/*
// （DEV-STANDARDS「明确禁止」），同时校验各包的 package.json 依赖声明，双向保证对旧引擎零依赖。
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const SCAN_DIRS = ['grid', 'table'].map((name) => ({
  name,
  dir: new URL(`../packages/${name}`, import.meta.url).pathname,
}))
const FORBIDDEN_IMPORT = /(?:from|import)\s*\(?\s*['"](@visactor\/[^'"]+)['"]/g

async function collectTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(path)))
    } else if (entry.name.endsWith('.ts')) {
      files.push(path)
    }
  }
  return files
}

const offenders: string[] = []

for (const { name, dir } of SCAN_DIRS) {
  for (const file of await collectTsFiles(join(dir, 'src'))) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(FORBIDDEN_IMPORT)) {
      offenders.push(`${file}: import ${match[1]}`)
    }
  }

  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const depName of Object.keys(pkg[field] ?? {})) {
      if (depName.startsWith('@visactor/')) {
        offenders.push(`packages/${name}/package.json: ${field} 声明了 ${depName}`)
      }
    }
  }
}

if (offenders.length > 0) {
  console.error(`扫描范围存在 @visactor/* 依赖：\n${offenders.join('\n')}`)
  process.exit(1)
}

console.log('check:deps 通过：packages/grid 与 packages/table 对 @visactor/* 零依赖')
