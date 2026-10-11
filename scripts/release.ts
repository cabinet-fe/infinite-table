#!/usr/bin/env bun
/**
 * 本地发版入口（发版规范 A：公开 npm · CI · changesets）：
 *
 * 只做两件事：跑 `changeset version` 把版本升好，然后 commit + push。
 * 剩下的 test / build / publish / 打 tag 全部由 `.github/workflows/release.yml`
 * 在远端自动完成（由 `packages/*\/CHANGELOG.md` 路径变更触发）。
 *
 * 发布范围由 `.changeset/` 中已存在的 changeset 文件集合决定。
 *
 * 无外部依赖：不需要 gh CLI，不需要 GITHUB_TOKEN 本地环境变量。
 *
 * 用法：
 *   bun run release            # 正常发布
 *   bun run release --dry-run  # 跑到 version 阶段后回滚（不 commit/push）
 *   bun run release --force    # 跳过非 main 分支检查
 *   bun run release --help     # 打印帮助
 */

import { spawnSync, type SpawnSyncOptions } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const CHANGESET_DIR = join(REPO_ROOT, '.changeset')
const RELEASE_BRANCH = 'main'

const ROLLBACK_HELP = `\n若 CI 发布失败：\n  1. 在 GitHub Actions 页面重跑该次 workflow run（同一 commit 继续 publish，无需重跑 version）。\n  2. 若需完全回滚本次本地 commit（CI 尚未 publish）：\n       git reset --hard HEAD~1\n       git push --force-with-lease origin ${RELEASE_BRANCH}\n`

type CliArgs = { dryRun: boolean; force: boolean; help: boolean }

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { dryRun: false, force: false, help: false }
  for (const token of argv) {
    if (token === '--dry-run') {
      args.dryRun = true
    } else if (token === '--force') {
      args.force = true
    } else if (token === '--help' || token === '-h') {
      args.help = true
    } else {
      throw new Error(`未知参数: ${token}`)
    }
  }
  return args
}

function printHelp(): void {
  console.log(`用法：bun run release [flags]

flags：
  --dry-run              跑到 changeset version 后回滚（不 commit/push）
  --force                允许非 ${RELEASE_BRANCH} 分支执行
  -h, --help             打印本帮助

发布范围由 .changeset/ 中已存在的 changeset 决定。
${ROLLBACK_HELP}`)
}

type RunResult = { code: number; stdout: string; stderr: string }

function run(cmd: string, args: readonly string[], opts: SpawnSyncOptions = {}): RunResult {
  const res = spawnSync(cmd, args as string[], { cwd: REPO_ROOT, encoding: 'utf8', ...opts })
  return {
    code: res.status ?? -1,
    stdout: typeof res.stdout === 'string' ? res.stdout : '',
    stderr: typeof res.stderr === 'string' ? res.stderr : ''
  }
}

function runInherit(
  cmd: string,
  args: readonly string[],
  extraEnv: Record<string, string> | null = null
): number {
  const res = spawnSync(cmd, args as string[], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env
  })
  return res.status ?? -1
}

function fatal(msg: string, extra: string | null = null): never {
  console.error(`[release] ✗ ${msg}`)
  if (extra) console.error(extra)
  console.error(ROLLBACK_HELP)
  process.exit(1)
}

async function listChangesetFiles(): Promise<string[]> {
  const entries = await readdir(CHANGESET_DIR, { withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md')
    .map((e) => join(CHANGESET_DIR, e.name))
}

async function collectChangesetPkgs(files: readonly string[]): Promise<string[]> {
  const pkgs = new Set<string>()
  for (const f of files) {
    const raw = await readFile(f, 'utf8')
    const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
    if (!match) continue
    for (const line of (match[1] ?? '').split(/\r?\n/)) {
      const m = line
        .trim()
        .match(/^['"]?(@[^'":\s]+\/[^'":\s]+|[^'":\s@][^'":\s]*)['"]?\s*:\s*(patch|minor|major)\s*$/)
      if (m && m[1]) pkgs.add(m[1])
    }
  }
  return [...pkgs].sort()
}

async function ensureCleanWorkTree(): Promise<void> {
  const r = run('git', ['status', '--porcelain'])
  if (r.code !== 0) fatal(`git status 失败（exit ${r.code}）`, r.stderr)
  if (r.stdout.trim()) {
    fatal('工作区非干净，请先提交或暂存变更：', r.stdout)
  }
}

async function ensureBranchOk(force: boolean): Promise<void> {
  const r = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (r.code !== 0) fatal(`git rev-parse 失败（exit ${r.code}）`, r.stderr)
  const branch = r.stdout.trim()
  if (branch !== RELEASE_BRANCH) {
    if (!force) {
      fatal(`当前分支为 ${branch}，release 仅允许在 ${RELEASE_BRANCH} 执行；如需继续请加 --force`)
    }
    console.warn(`[release] ! 非 ${RELEASE_BRANCH} 分支（${branch}），已通过 --force 跳过检查`)
  }
}

async function ensureUpToDate(): Promise<void> {
  const fetch = run('git', ['fetch', `origin`, RELEASE_BRANCH, '--quiet'])
  if (fetch.code !== 0) fatal(`git fetch origin ${RELEASE_BRANCH} 失败`, fetch.stderr)
  const r = run('git', ['rev-list', '--count', `HEAD..origin/${RELEASE_BRANCH}`])
  if (r.code !== 0) fatal('git rev-list 失败', r.stderr)
  const behind = Number.parseInt(r.stdout.trim(), 10)
  if (Number.isFinite(behind) && behind > 0) {
    fatal(`本地落后于 origin/${RELEASE_BRANCH}（${behind} commits），请先 git pull --rebase`)
  }
}

function printList(label: string, items: readonly string[]): void {
  if (!items.length) {
    console.log(`  ${label}: (空)`)
    return
  }
  console.log(`  ${label}:`)
  for (const p of items) console.log(`    - ${p}`)
}

function commitTitleFor(pkgs: readonly string[]): string {
  if (!pkgs.length) return 'chore(release): publish packages'
  const shortNames = pkgs.map((p) => p.replace(/^@[^/]+\//, ''))
  return `chore(release): publish ${shortNames.join(', ')}`
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  console.log('[release] 阶段 1/4：前置检查')
  await ensureCleanWorkTree()
  await ensureBranchOk(args.force)
  await ensureUpToDate()

  const changesetFiles = await listChangesetFiles()
  if (!changesetFiles.length) {
    fatal('未发现待消费的 changeset（.changeset/*.md）；请先写一个 changeset 文件')
  }

  const pkgs = await collectChangesetPkgs(changesetFiles)
  if (!pkgs.length) {
    fatal('解析 changeset 未得到任何包，请检查文件 frontmatter')
  }
  printList('待发布 changeset 涉及的包', pkgs)

  console.log('[release] 阶段 2/4：执行 changeset version + bun install')
  const versionCode = runInherit('bunx', ['changeset', 'version'])
  if (versionCode !== 0) fatal('`changeset version` 失败')

  const installCode = runInherit('bun', ['install'])
  if (installCode !== 0) fatal('`bun install` 失败')

  if (args.dryRun) {
    console.log('[release] (dry-run) 阶段 3-4 跳过，回滚本地变更')
    const restore = runInherit('git', ['restore', '--', '.'])
    if (restore !== 0) {
      console.warn('[release] ! git restore 失败，请手动检查工作区')
    }
    return
  }

  console.log('[release] 阶段 3/4：提交产物')
  const title = commitTitleFor(pkgs)
  const addCode = runInherit('git', ['add', '.changeset', 'packages', 'package.json', 'bun.lock'])
  if (addCode !== 0) fatal('git add 失败')

  const diff = run('git', ['diff', '--cached', '--quiet'])
  if (diff.code === 0) {
    fatal('暂存区无变更，changeset version 可能未产生差异')
  }

  const commit = runInherit('git', ['commit', '-m', title])
  if (commit !== 0) fatal('git commit 失败')

  console.log('[release] 阶段 4/4：推送（push 后远端 Actions 自动触发）')
  const push = runInherit('git', ['push', 'origin', 'HEAD'])
  if (push !== 0) fatal('git push 失败')

  const head = run('git', ['rev-parse', '--short', 'HEAD'])
  const sha = head.stdout.trim()
  console.log(
    `\n✓ 已推送发布 commit，远端 release workflow 将由 packages/*/CHANGELOG.md 变更自动触发`
  )
  console.log(`  分支:   ${RELEASE_BRANCH}`)
  console.log(`  提交:   ${sha}`)
  console.log(`  查看:   https://github.com/cabinet-fe/infinite-table/actions/workflows/release.yml`)
}

main().catch((err: unknown) => {
  if (err instanceof Error) {
    console.error(`[release] ✗ ${err.message}`)
  } else {
    console.error('[release] ✗ 未知错误', err)
  }
  console.error(ROLLBACK_HELP)
  process.exit(1)
})
