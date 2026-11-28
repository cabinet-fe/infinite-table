#!/usr/bin/env bun
/**
 * 本地发版入口（发版规范 A：公开 npm · CI · changesets）：
 *
 * 检查 → 升版本 → 构建测试 → 提交 → 推送。publish、打 tag、建 GitHub Release 全部由
 * `.github/workflows/release.yml` 在远端完成（push main 触碰 `packages/*\/CHANGELOG.md` 触发）。
 *
 * 版本由 changesets 计算，发布范围即 `.changeset/` 中待消费的 changeset 集合；
 * 可发布包 = 根 `package.json` workspaces 中未声明 `private: true` 的包。
 *
 * 无外部依赖：不需要 gh CLI，不需要 GITHUB_TOKEN 本地环境变量。
 *
 * 用法：
 *   bun run release                 # 正常发版
 *   bun run release -- --dry-run    # 跑完检查、升版本、构建测试后回滚（不 commit/push）
 *   bun run release -- --force      # 跳过非 main 分支检查
 *   bun run release -- --help       # 打印帮助
 */

import { spawnSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findWorkspaceProtocolDeps, type Manifest } from './release/workspace-protocol'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const CHANGESET_DIR = join(REPO_ROOT, '.changeset')
const RELEASE_BRANCH = 'main'
const NPM_REGISTRY = 'https://registry.npmjs.org'
const WORKFLOW_URL = 'https://github.com/cabinet-fe/infinite-table/actions/workflows/release.yml'
/** 与 release.yml 发布 job 相同的检查命令；check:exports 校验 dist，必须排在 build 之后 */
const CI_CHECK_SCRIPTS = ['test', 'build', 'check:exports'] as const

const RECOVERY_HELP = `
若 CI 发布失败：在 GitHub Actions 重跑该次 workflow run（publish 幂等，已发布的版本自动跳过）。
若需撤回已推送的发版提交（先征得维护者同意；禁止 force push ${RELEASE_BRANCH}）：git revert <发版提交>
若演练中途被打断、工作区留有改动：git restore --staged --worktree . && git clean -fd`

type CliArgs = { dryRun: boolean; force: boolean; help: boolean }

interface PublishablePackage {
  name: string
  /** 相对仓库根的目录 */
  dir: string
  version: string
}

interface VersionBump {
  name: string
  dir: string
  from: string
  to: string
}

/** 发版中止，可附带子命令的输出 */
class ReleaseError extends Error {
  constructor(
    message: string,
    readonly detail: string | null = null,
  ) {
    super(message)
  }
}

/** 当前所处的阶段，失败时据此报告停在哪一步 */
let currentStage = '参数解析'

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { dryRun: false, force: false, help: false }
  for (const token of argv) {
    // 部分调用路径会把 `bun run release -- <参数>` 的分隔符透传进来
    if (token === '--') continue
    if (token === '--dry-run') {
      args.dryRun = true
    } else if (token === '--force') {
      args.force = true
    } else if (token === '--help' || token === '-h') {
      args.help = true
    } else {
      throw new ReleaseError(`未知参数: ${token}`)
    }
  }
  return args
}

function printHelp(): void {
  console.log(`用法：bun run release [flags]

flags：
  --dry-run              跑完前置检查、升版本、构建测试后回滚（不 commit/push）
  --force                允许非 ${RELEASE_BRANCH} 分支执行
  -h, --help             打印本帮助

版本由 changesets 计算；发布范围由 .changeset/ 中待消费的 changeset 决定。
${RECOVERY_HELP}`)
}

type RunResult = { code: number; stdout: string; stderr: string }

function run(cmd: string, args: readonly string[]): RunResult {
  const res = spawnSync(cmd, args as string[], { cwd: REPO_ROOT, encoding: 'utf8' })
  return {
    code: res.status ?? -1,
    stdout: typeof res.stdout === 'string' ? res.stdout : '',
    stderr: typeof res.stderr === 'string' ? res.stderr : '',
  }
}

function runInherit(cmd: string, args: readonly string[]): number {
  const res = spawnSync(cmd, args as string[], { cwd: REPO_ROOT, stdio: 'inherit' })
  return res.status ?? -1
}

/** 子命令失败即中止，并带上它的输出 */
function must(code: number, message: string, detail: string | null = null): void {
  if (code !== 0) throw new ReleaseError(message, detail)
}

async function readJson(file: string): Promise<Manifest> {
  return JSON.parse(await readFile(file, 'utf8')) as Manifest
}

function printList(label: string, items: readonly string[]): void {
  if (!items.length) {
    console.log(`  ${label}: (空)`)
    return
  }
  console.log(`  ${label}:`)
  for (const item of items) console.log(`    - ${item}`)
}

async function listChangesetFiles(): Promise<string[]> {
  const entries = await readdir(CHANGESET_DIR, { withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md')
    .map((e) => join(CHANGESET_DIR, e.name))
}

/** 展开 workspaces 条目：`packages/*` 取其一级子目录，其余按字面目录 */
async function expandWorkspaceEntry(entry: string): Promise<string[]> {
  if (!entry.endsWith('/*')) return [entry]
  const parent = entry.slice(0, -2)
  const entries = await readdir(join(REPO_ROOT, parent), { withFileTypes: true })
  return entries.filter((e) => e.isDirectory()).map((e) => join(parent, e.name))
}

/** 根 package.json workspaces 中未声明 private 的包 */
async function listPublishablePackages(): Promise<PublishablePackage[]> {
  const root = await readJson(join(REPO_ROOT, 'package.json'))
  const entries: unknown[] = Array.isArray(root.workspaces) ? root.workspaces : []
  const pkgs: PublishablePackage[] = []
  for (const entry of entries) {
    for (const dir of await expandWorkspaceEntry(String(entry))) {
      const manifest = await readJson(join(REPO_ROOT, dir, 'package.json'))
      if (manifest.private === true) continue
      const { name, version } = manifest
      if (typeof name !== 'string' || typeof version !== 'string') {
        throw new ReleaseError(`${join(dir, 'package.json')} 缺少 name 或 version`)
      }
      pkgs.push({ name, dir, version })
    }
  }
  return pkgs.sort((a, b) => a.name.localeCompare(b.name))
}

/** 重新读取版本，挑出本次升了版的可发布包 */
async function listVersionBumps(pkgs: readonly PublishablePackage[]): Promise<VersionBump[]> {
  const bumps: VersionBump[] = []
  for (const pkg of pkgs) {
    const { version } = await readJson(join(REPO_ROOT, pkg.dir, 'package.json'))
    if (typeof version === 'string' && version !== pkg.version) {
      bumps.push({ name: pkg.name, dir: pkg.dir, from: pkg.version, to: version })
    }
  }
  return bumps
}

async function ensureCleanWorkTree(): Promise<void> {
  const r = run('git', ['status', '--porcelain'])
  must(r.code, `git status 失败（exit ${r.code}）`, r.stderr)
  if (r.stdout.trim()) {
    throw new ReleaseError('工作区非干净，请先提交或暂存变更：', r.stdout)
  }
}

function ensureBranchOk(force: boolean): string {
  const r = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  must(r.code, `git rev-parse 失败（exit ${r.code}）`, r.stderr)
  const branch = r.stdout.trim()
  if (branch !== RELEASE_BRANCH) {
    if (!force) {
      throw new ReleaseError(
        `当前分支为 ${branch}，release 仅允许在 ${RELEASE_BRANCH} 执行；如需继续请加 --force`,
      )
    }
    console.warn(`[release] ! 非 ${RELEASE_BRANCH} 分支（${branch}），已通过 --force 跳过检查`)
  }
  return branch
}

async function ensureUpToDate(): Promise<void> {
  const fetch = run('git', ['fetch', 'origin', RELEASE_BRANCH, '--quiet'])
  must(fetch.code, `git fetch origin ${RELEASE_BRANCH} 失败`, fetch.stderr)
  // 落后即中止，分叉必然落后
  const r = run('git', ['rev-list', '--count', `HEAD..origin/${RELEASE_BRANCH}`])
  must(r.code, 'git rev-list 失败', r.stderr)
  const behind = Number.parseInt(r.stdout.trim(), 10)
  if (Number.isFinite(behind) && behind > 0) {
    throw new ReleaseError(
      `本地落后于 origin/${RELEASE_BRANCH}（${behind} commits），请先 git pull --rebase`,
    )
  }
}

/** 每个可发布包都必须已在 npmjs 上：新包首发不能走本流程 */
function ensurePublishedOnNpm(pkgs: readonly PublishablePackage[]): void {
  for (const pkg of pkgs) {
    const r = run('npm', ['view', pkg.name, 'name', '--registry', NPM_REGISTRY])
    if (r.code !== 0 || r.stdout.trim() !== pkg.name) {
      throw new ReleaseError(`${pkg.name} 在 npmjs 上不存在，请先完成新包首发`, r.stderr)
    }
  }
}

/** 版本号一经发布不可复用 */
function ensureVersionsAvailable(bumps: readonly VersionBump[]): void {
  for (const bump of bumps) {
    const r = run('npm', ['view', `${bump.name}@${bump.to}`, 'version', '--registry', NPM_REGISTRY])
    if (r.code === 0 && r.stdout.trim() === bump.to) {
      throw new ReleaseError(
        `${bump.name}@${bump.to} 已在 npmjs 上存在，版本号不可复用，请重新判定版本`,
      )
    }
    // 网络、鉴权等失败不能当作「未占用」放行，只有 E404 才代表该版本不存在
    if (r.code !== 0 && !r.stderr.includes('E404')) {
      throw new ReleaseError(`查询 ${bump.name}@${bump.to} 是否已发布失败`, r.stderr)
    }
  }
}

/** CI 只剥离 devDependencies；其余依赖字段带协议时会原样发出去（npm publish 不展开） */
async function ensureNoWorkspaceProtocol(bumps: readonly VersionBump[]): Promise<void> {
  for (const bump of bumps) {
    const manifest = await readJson(join(REPO_ROOT, bump.dir, 'package.json'))
    const leftovers = findWorkspaceProtocolDeps(manifest, ['devDependencies'])
    if (leftovers.length > 0) {
      throw new ReleaseError(
        `${bump.name} 的依赖仍使用 workspace: / catalog: 协议：${leftovers.join(', ')}`,
      )
    }
  }
}

/** 起点干净，演练与正式流程都暂存全部改动；返回 name-status 清单 */
function stageAll(): string[] {
  must(runInherit('git', ['add', '-A']), 'git add 失败')
  const r = run('git', ['diff', '--cached', '--name-status'])
  must(r.code, 'git diff --cached 失败', r.stderr)
  return r.stdout.trim() ? r.stdout.trimEnd().split('\n') : []
}

/** 起点干净（前置检查保证），演练产生的未跟踪文件可一并清掉；禁止 -x，会删掉 node_modules 等被忽略文件 */
function restoreWorkTree(): void {
  const restore = runInherit('git', ['restore', '--staged', '--worktree', '.'])
  const clean = runInherit('git', ['clean', '-fd'])
  if (restore !== 0 || clean !== 0) {
    console.warn(
      '[release] ! 工作区恢复失败，请手动执行：git restore --staged --worktree . && git clean -fd',
    )
  }
}

function commitMessage(bumps: readonly VersionBump[]): { title: string; body: string[] } {
  const list = bumps.map((bump) => `${bump.name}@${bump.to}`)
  if (new Set(bumps.map((bump) => bump.to)).size === 1) {
    return { title: `chore(release): 发布 v${bumps[0]?.to}`, body: [] }
  }
  if (bumps.length > 3) return { title: `chore(release): 发布 ${bumps.length} 个包`, body: list }
  return { title: `chore(release): 发布 ${list.join(', ')}`, body: [] }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  console.log('[release] 阶段 1/5：前置检查')
  currentStage = '前置检查'
  await ensureCleanWorkTree()
  const branch = ensureBranchOk(args.force)
  await ensureUpToDate()

  const changesetFiles = await listChangesetFiles()
  if (!changesetFiles.length) {
    throw new ReleaseError('没有待发布的改动：.changeset/ 下没有待消费的 changeset，请先写一个')
  }
  const pkgs = await listPublishablePackages()
  if (!pkgs.length) {
    throw new ReleaseError('未发现可发布包：workspaces 中没有非 private 的包')
  }
  printList(
    '可发布包',
    pkgs.map((pkg) => `${pkg.name}@${pkg.version}`),
  )
  ensurePublishedOnNpm(pkgs)

  const prepare = async (): Promise<VersionBump[]> => {
    console.log('[release] 阶段 2/5：升版本（changeset version + bun install）')
    currentStage = '升版本'
    must(runInherit('bunx', ['changeset', 'version']), '`changeset version` 失败')
    must(runInherit('bun', ['install']), '`bun install` 失败')

    const bumps = await listVersionBumps(pkgs)
    if (!bumps.length) {
      throw new ReleaseError('没有待发布的改动：changeset version 未升任何可发布包的版本')
    }
    printList(
      '版本变化',
      bumps.map((bump) => `${bump.name}: ${bump.from} → ${bump.to}`),
    )
    ensureVersionsAvailable(bumps)

    console.log('[release] 阶段 3/5：构建与测试（与 CI 发布 job 相同的命令）')
    currentStage = '构建与测试'
    await ensureNoWorkspaceProtocol(bumps)
    for (const script of CI_CHECK_SCRIPTS) {
      must(runInherit('bun', ['run', script]), `\`bun run ${script}\` 失败`)
    }

    console.log('[release] 阶段 4/5：暂存改动')
    currentStage = '暂存改动'
    const staged = stageAll()
    if (!staged.length) {
      throw new ReleaseError('暂存区无变更，changeset version 可能未产生差异')
    }
    printList(args.dryRun ? '将提交的文件' : '已暂存文件', staged)
    return bumps
  }

  if (args.dryRun) {
    try {
      await prepare()
    } finally {
      restoreWorkTree()
    }
    console.log('[release] (dry-run) 结束：未提交、未推送，工作区已恢复')
    return
  }

  const bumps = await prepare()

  console.log('[release] 阶段 5/5：提交并推送')
  currentStage = '提交并推送'
  const { title, body } = commitMessage(bumps)
  must(
    runInherit('git', ['commit', '-m', title, ...body.flatMap((line) => ['-m', line])]),
    'git commit 失败',
  )

  // --force 时推当前分支，由 PR 合入发版分支后触发 CI
  const pushTarget = branch === RELEASE_BRANCH ? `HEAD:${RELEASE_BRANCH}` : 'HEAD'
  must(runInherit('git', ['push', 'origin', pushTarget]), 'git push 失败')

  const head = run('git', ['rev-parse', '--short', 'HEAD'])
  console.log(`\n✓ 已推送发版提交，远端 release workflow 将由 packages/*/CHANGELOG.md 变更自动触发`)
  console.log(`  分支:   ${branch}`)
  console.log(`  提交:   ${head.stdout.trim()}`)
  console.log(`  查看:   ${WORKFLOW_URL}`)
}

main().catch((err: unknown) => {
  if (err instanceof ReleaseError) {
    console.error(`[release] ✗ ${err.message}`)
    if (err.detail) console.error(err.detail)
  } else if (err instanceof Error) {
    console.error(`[release] ✗ 未知错误：${err.message}`)
  } else {
    console.error('[release] ✗ 未知错误', err)
  }
  console.error(`[release] 在「${currentStage}」阶段中止`)
  console.error(RECOVERY_HELP)
  process.exit(1)
})
