#!/usr/bin/env node
// vs-vtable 对比驱动（可重复）：vp build → vp preview（固定端口）→ playwright-cli 打开 /vs.html →
// 轮询页内对比结果 window.__VS_REPORT__ → 控制台汇总 + JSON 落档 + 静态 HTML 报告落档（发版可直接分发）。
// 用法：bun run vs（apps/bench 下）；依赖全局 playwright-cli（见 playwright-cli 技能）。

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { gzipSync } from 'node:zlib'

const benchRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(benchRoot, '..', '..')
const vpBin = path.join(repoRoot, 'node_modules', '.bin', 'vp')
const PORT = 54174
const BASE_URL = `http://127.0.0.1:${PORT}`
const SESSION = 'infinite-table-vs-vtable'
const SERVER_TIMEOUT_MS = 30_000
const RUN_TIMEOUT_MS = 15 * 60_000

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...options })
}

/** playwright-cli --raw 对字符串返回值会再包一层引号转义，这里解包后取对象 */
function parseRawResult(text) {
  const value = JSON.parse(text)
  return typeof value === 'string' ? JSON.parse(value) : value
}

/** 最小构建体积：bun build 打「最小渲染面」入口（minify、browser target），量产物字节与 gzip 字节 */
function measureBundleSize() {
  const tmpDir = path.join(benchRoot, '.size-tmp')
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })
  const entries = {
    // 入口放 apps/bench 下保证向上解析到根 node_modules 的 workspace 链接；
    // export 引用防 tree-shake 把实现摇掉
    ours: `import { ListTable } from '@infinite-table/core'\nimport { createRenderHost } from '@infinite-table/render'\nexport const __keep = [ListTable, createRenderHost]\n`,
    vtable: `import { ListTable } from '@visactor/vtable'\nexport const __keep = [ListTable]\n`,
  }
  const sizes = {}
  for (const [name, source] of Object.entries(entries)) {
    const entryFile = path.join(tmpDir, `entry-${name}.js`)
    const outDir = path.join(tmpDir, `dist-${name}`)
    writeFileSync(entryFile, source)
    const res = run(
      'bun',
      ['build', entryFile, '--minify', '--target=browser', `--outdir=${outDir}`],
      {
        cwd: benchRoot,
      },
    )
    if (res.status !== 0) {
      throw new Error(`bun build（${name}）失败：\n${res.stdout ?? ''}${res.stderr ?? ''}`)
    }
    let min = 0
    let gzip = 0
    const walk = (dir) => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, item.name)
        if (item.isDirectory()) {
          walk(full)
          continue
        }
        const buf = readFileSync(full)
        min += buf.length
        gzip += gzipSync(buf).length
      }
    }
    walk(outDir)
    sizes[name] = { min, gzip }
  }
  rmSync(tmpDir, { recursive: true, force: true })
  return sizes
}

/** 体积节 HTML：与页内报告同风格（.vs-report 内联样式已就位），两行 min / gzip */
function bundleSectionHtml(bs) {
  const kb = (n) => (n / 1024).toFixed(1)
  const row = (label, ours, theirs, note) => {
    const advantage = theirs / ours
    const [kind, text] =
      advantage >= 1.05
        ? ['faster', `快 ${advantage.toFixed(2)}×`]
        : advantage <= 1 / 1.05
          ? ['slower', `慢 ${(1 / advantage).toFixed(2)}×`]
          : ['even', '持平']
    const max = Math.max(ours, theirs) || 1
    const oursGood = ours <= theirs
    return `          <tr>
            <td class="metric">${label}${note ? `<div class="note">${note}</div>` : ''}</td>
            <td class="value ours">${kb(ours)}<span class="unit">KB</span>
      <div class="bars"><div class="bar-row"><span class="bar ours ${oursGood ? 'good' : 'bad'}" style="width:${((ours / max) * 100).toFixed(1)}%"></span></div><div class="bar-row"><span class="bar theirs ${oursGood ? 'bad' : 'good'}" style="width:${((theirs / max) * 100).toFixed(1)}%"></span></div></div>
            </td>
            <td class="value">${kb(theirs)}<span class="unit">KB</span></td>
            <td class="verdict"><span class="badge ${kind}">${text}</span></td>
          </tr>`
  }
  const gzipAdvantage = bs.vtable.gzip / bs.ours.gzip
  return `
  <section class="scale">
    <h2>最小构建体积<span class="scale-sub">gzip 比 VTable 小 ${gzipAdvantage.toFixed(0)} 倍</span></h2>
    <div class="group">
      <h3>bundle size（minify 后单包）</h3>
      <table>
        <thead><tr><th class="metric">指标</th><th>infinite-table</th><th>@visactor/vtable</th><th class="verdict">对比</th></tr></thead>
        <tbody>
${row('minified 体积', bs.ours.min, bs.vtable.min, 'bun build --minify --target=browser 产物字节和')}
${row('gzip 体积', bs.ours.gzip, bs.vtable.gzip, '按产物文件分别 gzip 求和；网络传输口径')}
        </tbody>
      </table>
    </div>
  </section>`
}

async function main() {
  const cliCheck = run('playwright-cli', ['--version'])
  if (cliCheck.error || cliCheck.status !== 0) {
    throw new Error(
      '未找到 playwright-cli（安装：npm i -g @playwright/cli，用法见 playwright-cli 技能）',
    )
  }

  console.log('[vs] 构建根 workspace（体积测量需最新 dist）…')
  const rootBuild = run('bun', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  if (rootBuild.status !== 0) {
    throw new Error('根 bun run build 失败')
  }
  const bundleSize = measureBundleSize()
  console.log(
    `[vs] 最小构建体积：infinite-table ${(bundleSize.ours.min / 1024).toFixed(1)}KB min / ${(bundleSize.ours.gzip / 1024).toFixed(1)}KB gzip，` +
      `vtable ${(bundleSize.vtable.min / 1024).toFixed(1)}KB min / ${(bundleSize.vtable.gzip / 1024).toFixed(1)}KB gzip`,
  )

  console.log('[vs] 构建 apps/bench（含 vs.html 入口）…')
  const build = run(vpBin, ['build'], { cwd: benchRoot, stdio: 'inherit' })
  if (build.status !== 0) {
    throw new Error('vp build 失败')
  }

  // detached + 进程组终止：vp 是包装进程，只 kill 它会遗留真正的 vite preview 子进程
  const server = spawn(
    vpBin,
    ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: benchRoot, stdio: 'pipe', detached: true },
  )
  let serverLog = ''
  server.stdout.on('data', (chunk) => (serverLog += chunk))
  server.stderr.on('data', (chunk) => (serverLog += chunk))

  try {
    const serverDeadline = Date.now() + SERVER_TIMEOUT_MS
    for (;;) {
      try {
        const res = await fetch(`${BASE_URL}/vs.html`)
        if (res.ok) {
          break
        }
      } catch {
        // 服务未起，继续等
      }
      if (Date.now() > serverDeadline) {
        throw new Error(`preview 服务未就绪：\n${serverLog}`)
      }
      await sleep(300)
    }

    const open = run('playwright-cli', [
      `-s=${SESSION}`,
      'open',
      '--browser=chromium',
      `${BASE_URL}/vs.html`,
    ])
    if (open.status !== 0) {
      throw new Error(`playwright-cli open 失败：\n${open.stdout ?? ''}${open.stderr ?? ''}`)
    }
    console.log('[vs] 对比页已打开，等待两库对称跑序完成（最长 15 分钟）…')

    const runDeadline = Date.now() + RUN_TIMEOUT_MS
    let report = null
    for (;;) {
      const poll = run('playwright-cli', [
        `-s=${SESSION}`,
        '--raw',
        'eval',
        'window.__VS_REPORT__ ? JSON.stringify(window.__VS_REPORT__) : ""',
      ])
      const out = (poll.stdout ?? '').trim()
      if (out) {
        try {
          const value = parseRawResult(out)
          if (value && value.tool === 'infinite-table-vs-vtable') {
            report = value
            break
          }
        } catch {
          // 结果未就绪，继续轮询
        }
      }
      if (Date.now() > runDeadline) {
        throw new Error(
          `对比运行超时（window.__VS_REPORT__ 未就绪）\n` +
            `poll status=${poll.status} stdout=${JSON.stringify(out.slice(0, 200))} stderr=${JSON.stringify((poll.stderr ?? '').slice(-400))}`,
        )
      }
      await sleep(3000)
    }

    // 取页内渲染好的报告 HTML 落静态文件（与页面同一渲染源，样式内联自包含）。
    // --raw 对字符串返回值会包一层 JSON 引号：解一次包得到原字符串，失败则按原文使用
    const htmlPoll = run('playwright-cli', [
      `-s=${SESSION}`,
      '--raw',
      'eval',
      'document.getElementById("report").innerHTML',
    ])
    const htmlRaw = (htmlPoll.stdout ?? '').trim()
    let reportInnerHtml = htmlRaw
    try {
      const parsed = JSON.parse(htmlRaw)
      if (typeof parsed === 'string') {
        reportInnerHtml = parsed
      }
    } catch {
      // 非引号包裹格式，保留原文
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    // 体积节插到首个规模节之前（页面跑不了分库打包，体积由驱动侧 bun build 实测注入）
    const bundleHtml = bundleSectionHtml(bundleSize)
    const anchor = reportInnerHtml.indexOf('<section class="scale"')
    reportInnerHtml =
      anchor >= 0
        ? reportInnerHtml.slice(0, anchor) + bundleHtml + reportInnerHtml.slice(anchor)
        : reportInnerHtml + bundleHtml
    const gitCommit =
      run('git', ['rev-parse', '--short', 'HEAD'], { cwd: benchRoot }).stdout?.trim() ?? ''
    const resultsDir = path.join(benchRoot, 'results')
    mkdirSync(resultsDir, { recursive: true })
    const jsonPath = path.join(resultsDir, `vs-vtable-${stamp}.json`)
    const htmlPath = path.join(resultsDir, `vs-vtable-${stamp}.html`)
    report.gitCommit = gitCommit || undefined
    report.bundleSize = {
      note: '最小渲染面入口（infinite-table = ListTable + createRenderHost；vtable = 主入口 ListTable），bun build --minify --target=browser，gzip 按产物文件分别压缩求和',
      ours: { minBytes: bundleSize.ours.min, gzipBytes: bundleSize.ours.gzip },
      vtable: { minBytes: bundleSize.vtable.min, gzipBytes: bundleSize.vtable.gzip },
    }
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
    writeFileSync(
      htmlPath,
      `<!doctype html>\n<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>infinite-table vs VTable 性能对比</title><style>body{margin:0;background:#f8fafc}</style></head><body><div style="padding:24px 16px">${reportInnerHtml}</div></body></html>\n`,
    )
    return { report, jsonPath, htmlPath }
  } finally {
    run('playwright-cli', [`-s=${SESSION}`, 'close'])
    if (server.pid) {
      try {
        process.kill(-server.pid, 'SIGTERM')
      } catch {
        // 进程组已退出
      }
    }
  }
}

let exitCode = 0
try {
  const { report, jsonPath, htmlPath } = await main()
  const lines = [
    `infinite-table vs @visactor/vtable（${report.dataset}）`,
    `git ${report.gitCommit ?? 'n/a'} · 采样 ${report.startedAt}`,
    '',
  ]
  for (const scale of report.scales) {
    const rowsOfScale = report.rows.filter((r) => r.scale === scale)
    const wins = rowsOfScale.filter((r) => r.verdict === 'faster').length
    lines.push(`—— ${scale / 10_000} 万行（领先 ${wins} / ${rowsOfScale.length} 项）——`)
    for (const row of rowsOfScale) {
      const badge =
        row.verdict === 'faster'
          ? `快 ${Number(row.advantage).toFixed(2)}x`
          : row.verdict === 'slower'
            ? `慢 ${(1 / row.advantage).toFixed(2)}x`
            : '持平'
      lines.push(
        `${badge.padStart(8)}  ${row.label}: infinite-table ${row.ours.toFixed(2)}${row.unit} vs vtable ${row.theirs.toFixed(2)}${row.unit}`,
      )
    }
    lines.push('')
  }
  if (report.bundleSize) {
    const kb = (n) => (n / 1024).toFixed(1)
    const bs = report.bundleSize
    const minAdv = bs.vtable.minBytes / bs.ours.minBytes
    const gzipAdv = bs.vtable.gzipBytes / bs.ours.gzipBytes
    lines.push(`—— 构建体积 ——`)
    lines.push(
      `${(minAdv >= 1.05 ? `快 ${minAdv.toFixed(2)}x` : minAdv <= 1 / 1.05 ? `慢 ${(1 / minAdv).toFixed(2)}x` : '持平').padStart(8)}  minified: infinite-table ${kb(bs.ours.minBytes)}KB vs vtable ${kb(bs.vtable.minBytes)}KB`,
    )
    lines.push(
      `${(gzipAdv >= 1.05 ? `快 ${gzipAdv.toFixed(2)}x` : gzipAdv <= 1 / 1.05 ? `慢 ${(1 / gzipAdv).toFixed(2)}x` : '持平').padStart(8)}  gzip: infinite-table ${kb(bs.ours.gzipBytes)}KB vs vtable ${kb(bs.vtable.gzipBytes)}KB`,
    )
    lines.push('')
  }
  lines.push(`全部规模合计：领先 ${report.wins} / ${report.total} 项`)
  console.log(lines.join('\n'))
  console.log(`\n[vs] JSON 报告：${jsonPath}`)
  console.log(`[vs] HTML 报告：${htmlPath}`)
} catch (error) {
  console.error(`[vs] ${error instanceof Error ? error.message : String(error)}`)
  exitCode = 1
}
process.exit(exitCode)
