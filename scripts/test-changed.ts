// 按 git 改动映射受影响的包，只跑相关测试。根级文件（bun.lock、根 package.json、
// vite.config.ts 等）影响面全局，回退全量；纯文档与代理配置改动不需要测试。
// 交叉包回归（如 core 改动影响 sheet/plugins）不在本脚本职责内，由发版前全量兜底。
import { execSync } from 'node:child_process'

function gitLines(cmd: string): string[] {
  return execSync(cmd, { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

const changed = new Set([
  ...gitLines('git diff --name-only HEAD'),
  ...gitLines('git ls-files --others --exclude-standard'),
])

if (changed.size === 0) {
  console.log('无改动，跳过测试')
  process.exit(0)
}

const scopes = new Set<string>()
for (const file of changed) {
  const pkg = file.match(/^packages\/([^/]+)\//)?.[1]
  if (pkg) {
    scopes.add(`packages/${pkg}`)
  } else if (file.startsWith('playground/')) {
    scopes.add('playground')
  } else if (
    /\.(md|mdx)$/.test(file) ||
    file.startsWith('.agents/') ||
    file.startsWith('.zcode/') ||
    file.startsWith('agent-docs/') ||
    file.startsWith('docs/')
  ) {
    // 文档与代理配置不触发测试（docs/ 与 agent-docs/ 只放文档，.md 兜底散落的 README/AGENTS）
  } else {
    scopes.clear()
    scopes.add('ALL')
    break
  }
}

const dryRun = process.argv.includes('--dry-run')
const cmd = `bunx vp test run ${[...scopes].join(' ')} --passWithNoTests`.trim()

if (scopes.has('ALL')) {
  console.log('根级文件有改动，跑全量测试')
  if (!dryRun) execSync(cmd, { stdio: 'inherit' })
} else if (scopes.size === 0) {
  console.log('只有文档改动，跳过测试')
} else {
  console.log(`跑受影响范围：${[...scopes].join(' ')}`)
  if (!dryRun) execSync(cmd, { stdio: 'inherit' })
}
