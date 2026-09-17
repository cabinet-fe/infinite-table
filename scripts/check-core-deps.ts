// 依赖扫描：packages/core 禁止 import 任何 @visactor/*（DEV-STANDARDS「明确禁止」），
// 同时校验 core 的 package.json 依赖声明，双向保证对旧引擎零依赖。
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const CORE_DIR = new URL('../packages/core', import.meta.url).pathname
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

for (const file of await collectTsFiles(join(CORE_DIR, 'src'))) {
  const source = await readFile(file, 'utf8')
  for (const match of source.matchAll(FORBIDDEN_IMPORT)) {
    offenders.push(`${file}: import ${match[1]}`)
  }
}

const pkg = JSON.parse(await readFile(join(CORE_DIR, 'package.json'), 'utf8'))
for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
  for (const name of Object.keys(pkg[field] ?? {})) {
    if (name.startsWith('@visactor/')) {
      offenders.push(`packages/core/package.json: ${field} 声明了 ${name}`)
    }
  }
}

if (offenders.length > 0) {
  console.error(`packages/core 存在 @visactor/* 依赖：\n${offenders.join('\n')}`)
  process.exit(1)
}

console.log('check:deps 通过：packages/core 对 @visactor/* 零依赖')
