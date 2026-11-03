#!/usr/bin/env bun
// 端到端打印验收驱动（P11，可重复手动直跑，不占 npm script 入口）：
// vp build → Bun 后端（8787，独立临时注册库）+ vp preview（54174）→ playwright-cli
// 打开真实应用 → 页内脚本仅通过 UI 完成「加载/微调模板 → 打印弹框预览 → 打印」两张
// 单据（列表样 + 中式单据），在打印预览 DOM 上断言绑定展开与 fixrows 分页，并捕获
// 打印输出隐藏 iframe 断言与预览同产物；驱动侧另经 REST 断言模板 JSON 不含打印配置。
// 用法：bun scripts/e2e-print.mjs（应用根目录）；依赖全局 playwright-cli。
// 端口占用处置与 playground smoke 同策略：仅回收本脚本泄漏的同签名进程，异物报错退出。

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(appRoot, '..', '..')
const vpBin = path.join(repoRoot, 'node_modules', '.bin', 'vp')
// API 端口固定 8787：vite.config.ts 的 /api 代理目标写死 8787
const API_PORT = 8787
const PREVIEW_PORT = 54174
const BASE_URL = `http://127.0.0.1:${PREVIEW_PORT}`
const SESSION = 'print-form-designer-e2e'
const SERVER_TIMEOUT_MS = 30_000
const E2E_TIMEOUT_MS = 180_000
const PORT_RELEASE_TIMEOUT_MS = 5_000
const SEED_TEMPLATE_IDS = ['seed-template-sales-list', 'seed-template-cn-receipt']

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...options })
}

/** 占用端口的进程清单（pid + 完整命令行）；空数组即端口空闲 */
function portOccupiers(port) {
  const probe = run('lsof', ['-nP', '-t', '-iTCP:' + port, '-sTCP:LISTEN'])
  const pids = (probe.stdout ?? '').trim().split(/\s+/).filter(Boolean)
  return pids.map((pid) => ({
    pid: Number(pid),
    command: run('ps', ['-p', pid, '-o', 'command=']).stdout?.trim() ?? '',
  }))
}

/** 回收本脚本泄漏的进程（preview / 后端同签名），异物占用则报错退出 */
async function reclaimPort(port, isOwnLeak) {
  const occupiers = portOccupiers(port)
  if (occupiers.length === 0) {
    return
  }
  const foreign = occupiers.find(({ command }) => command !== '' && !isOwnLeak(command))
  if (foreign) {
    throw new Error(
      `端口 ${port} 被无关进程占用：PID ${foreign.pid}（${foreign.command}）。` +
        '请释放该端口（应用 dev 服务默认占 8787/5174）后重试。',
    )
  }
  for (const { pid } of occupiers) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // 已退出
    }
  }
  const deadline = Date.now() + PORT_RELEASE_TIMEOUT_MS
  while (portOccupiers(port).length > 0) {
    if (Date.now() > deadline) {
      throw new Error(`泄漏进程未在 ${PORT_RELEASE_TIMEOUT_MS}ms 内退出，请手动清理后重试`)
    }
    await sleep(200)
  }
}

/** playwright-cli --raw 对字符串返回值会再包一层引号转义，这里解包后取对象 */
function parseCliJson(text) {
  const value = JSON.parse(text)
  return typeof value === 'string' ? JSON.parse(value) : value
}

/** 驱动侧 REST 断言：seed 模板可经 REST 取回，且模板 JSON 不含打印配置/参考线字段 */
async function assertTemplatesViaRest(failures) {
  const body = await (await fetch(`${BASE_URL}/api/templates`)).json()
  const names = body.map((row) => row.name).join('、')
  if (body.length < SEED_TEMPLATE_IDS.length) {
    failures.push(`REST：seed 模板清单不全（${names}）`)
    return
  }
  for (const id of SEED_TEMPLATE_IDS) {
    const record = await (await fetch(`${BASE_URL}/api/templates/${id}`)).json()
    const text = JSON.stringify(record)
    for (const forbidden of [
      'paperSize',
      'paper',
      'orientation',
      'margin',
      'scale',
      'paging',
      'fixRows',
      'headerRepeatRows',
      'groupBreakBy',
      'guides',
    ]) {
      if (text.includes(`"${forbidden}"`))
        failures.push(`REST：模板 ${id} 含打印配置字段 ${forbidden}`)
    }
  }
}

/** 页内端到端脚本：仅通过 UI 操作完成两张单据的设计与打印，结果写 window.__E2E__ */
const PAGE_SCRIPT = `
;(function () {
  const results = []
  function check(name, ok, detail) {
    results.push({ name: name, ok: !!ok, detail: detail === undefined ? '' : String(detail) })
  }
  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }
  async function waitFor(fn, what, timeout) {
    const deadline = Date.now() + (timeout || 20000)
    for (;;) {
      let value = null
      try { value = fn() } catch (e) { value = null }
      if (value) return value
      if (Date.now() > deadline) throw new Error('等待超时：' + what)
      await sleep(100)
    }
  }
  // React 受控表单：原生 setter 赋值再派发 change/input，绕开 React 值拦截
  function setSelect(el, value) {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  function setInput(el, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  function buttons(scope, text) {
    return Array.from(scope.querySelectorAll('button')).filter((b) => b.textContent.trim() === text)
  }
  function clickButton(scope, text) {
    const first = buttons(scope, text)[0]
    if (!first) throw new Error('未找到按钮：' + text)
    if (first.disabled) throw new Error('按钮不可用：' + text)
    first.click()
    return first
  }
  function labelControl(prefix, tag) {
    for (const label of document.querySelectorAll('.print-dialog-config label')) {
      if (label.textContent.replace(/\\s+/g, '').indexOf(prefix) === 0) {
        const el = label.querySelector(tag)
        if (el) return el
      }
    }
    return null
  }
  const templatePanel = () => document.querySelector('.template-panel')
  const regionPanel = () => document.querySelector('.region-panel')
  // 格样式工具栏（模板面板同有 toolbar class，排除之）
  const styleToolbar = () =>
    Array.from(document.querySelectorAll('section.toolbar')).find((s) => !s.classList.contains('template-panel'))
  const dialog = () => document.querySelector('.print-dialog')
  const previewFrame = () => {
    const dlg = dialog()
    return dlg ? dlg.querySelector('iframe[title="打印预览"]') : null
  }
  const pages = () => {
    const frame = previewFrame()
    if (!frame || !frame.contentDocument) return []
    return Array.from(frame.contentDocument.querySelectorAll('.print-page')).map((p) => p.textContent)
  }
  const dialogMetas = () => Array.from(document.querySelectorAll('.print-dialog .meta')).map((m) => m.textContent)
  const countOf = (text, needle) => text.split(needle).length - 1
  const srcdocPageCount = (frame) => (frame.srcdoc.match(/class="print-page"/g) || []).length

  /**
   * 等预览 iframe 活动文档收敛到期望页数。Chromium 对连续快速的 srcdoc 属性变更
   * 偶发不发起重载（属性已是新文档、活动文档停在旧页）：检测到 srcdoc 已到位而
   * 活动文档滞后时，每 2s 经「移除 + 重设」真实属性变更踢醒一次重载。
   */
  async function waitPreviewPages(expected, what, timeout) {
    const deadline = Date.now() + (timeout || 20000)
    let nextNudge = 0
    for (;;) {
      const frame = previewFrame()
      const live = frame && frame.contentDocument ? frame.contentDocument.querySelectorAll('.print-page').length : -1
      const attr = frame ? srcdocPageCount(frame) : -1
      if (live === expected && attr === expected) return
      if (Date.now() > deadline) {
        throw new Error('等待超时：' + what + '（live=' + live + '，srcdoc=' + attr + '）')
      }
      if (attr === expected && live !== expected && Date.now() >= nextNudge) {
        const html = frame.getAttribute('srcdoc')
        frame.removeAttribute('srcdoc')
        frame.setAttribute('srcdoc', html)
        nextNudge = Date.now() + 2000
      }
      await sleep(150)
    }
  }

  async function openTemplate(id, expectedName) {
    const panel = templatePanel()
    const select = panel.querySelector('select')
    await waitFor(() => Array.from(select.options).some((o) => o.value === id), '模板清单出现 ' + id)
    setSelect(select, id)
    clickButton(panel, '打开')
    const nameInput = panel.querySelector('input[type="text"]')
    await waitFor(() => nameInput.value === expectedName, '加载模板 ' + expectedName, 30000)
  }

  async function openPrintDialog() {
    clickButton(styleToolbar(), '打印')
    await waitFor(() => dialog() !== null, '打印弹框出现')
    await waitFor(() => pages().length > 0, '打印预览渲染出页面', 30000)
  }

  async function setFixRows(fixRows) {
    const paging = labelControl('分页模式', 'select')
    if (!paging) throw new Error('未找到分页模式选择')
    setSelect(paging, 'fixrows')
    const input = await waitFor(() => labelControl('每页行数', 'input'), '每页行数输入出现')
    // 先让 fixrows 中间态完成一次完整的 srcdoc 重载，再改行数——连续两次快速
    // srcdoc 变更会被 Chromium 偶发吞掉重载（见 waitPreviewPages 注释）
    await sleep(800)
    setInput(input, fixRows)
  }

  async function tweakAndUndo() {
    const base = regionPanel().querySelectorAll('.region-item').length
    clickButton(regionPanel(), '添加区域')
    await waitFor(() => regionPanel().querySelectorAll('.region-item').length === base + 1, '添加区域生效')
    const undo = await waitFor(
      () => buttons(styleToolbar(), '撤销').find((b) => !b.disabled) || null,
      '撤销按钮可用',
    )
    undo.click()
    await waitFor(() => regionPanel().querySelectorAll('.region-item').length === base, '撤销回到原区域结构')
    return base
  }

  /**
   * 点击打印并捕获隐藏打印输出 iframe（aria-hidden 离屏装载，与预览同产物）。
   * headless 无系统打印对话框：临时包一层 contentWindow getter 给同源 iframe 的
   * print 装无操作桩（点击路径照常执行到调起打印，只是不弹对话框），事后还原。
   */
  async function clickPrintCapture() {
    window.__PRINT_FRAMES__ = []
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.tagName === 'IFRAME' && node.getAttribute('aria-hidden') === 'true') {
            window.__PRINT_FRAMES__.push(node)
          }
        }
      }
    })
    observer.observe(document.body, { childList: true })
    const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      get: function () {
        const win = descriptor.get.call(this)
        if (win && !win.__printStubbed) {
          try {
            win.__printStubbed = true
            win.print = () => {}
          } catch (e) {
            // 跨 realm 赋值失败则放弃打桩（真实 print 在 headless 多为 no-op）
          }
        }
        return win
      },
      configurable: true,
    })
    try {
      clickButton(document.querySelector('.print-dialog-foot'), '打印')
      await waitFor(() => window.__PRINT_FRAMES__.length > 0, '打印输出隐藏 iframe 出现', 15000)
    } finally {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', descriptor)
      observer.disconnect()
    }
    return window.__PRINT_FRAMES__[0]
  }

  async function closeDialog() {
    clickButton(document.querySelector('.print-dialog-bar'), '关闭')
    await waitFor(() => dialog() === null, '打印弹框关闭')
  }

  function assertMergedTitle(label, colspan) {
    const td = previewFrame().contentDocument.querySelector('td[colspan="' + colspan + '"]')
    check(label + '：标题合并区跨 ' + colspan + ' 列', !!td && td.textContent.includes(label === '列表样' ? '销售明细清单' : '销售出库单'))
  }

  async function run() {
    await waitFor(() => document.querySelector('.template-panel') !== null, '应用渲染')

    // ─── 列表样：销售明细清单 ───
    await openTemplate('seed-template-sales-list', '销售明细清单（列表样）')
    check('列表样：模板加载后模板名回填', templatePanel().querySelector('input[type="text"]').value === '销售明细清单（列表样）')
    await tweakAndUndo()
    await openPrintDialog()
    await waitPreviewPages(1, 'A4 缺省预览（单页）')
    check('列表样：A4 缺省单页', dialogMetas().some((m) => m === '共 1 页'))
    const listOne = pages()[0] || ''
    for (const text of ['销售明细清单', 'SO-2026-001', 'SO-2026-002', '全棉精梳府绸', '涤纶四面弹面料', '涤纶缝纫线', '铜版纸', '哑粉纸', '合计', '3925', '33130.00', '8.50', '制表人']) {
      check('列表样：单页含「' + text + '」', listOne.includes(text))
    }
    check('列表样：明细绑定展开 3+2 行', countOf(listOne, 'SO-2026-001') === 3 && countOf(listOne, 'SO-2026-002') === 2)
    check('列表样：打印输出无占位符残留', !listOne.includes('{{'))
    assertMergedTitle('列表样', 9)
    await setFixRows(5)
    await waitPreviewPages(3, 'fixrows=5 分页 3 页')
    check('列表样：弹框页数显示共 3 页', dialogMetas().some((m) => m === '共 3 页'))
    const listPages = pages()
    listPages.forEach((page, i) => {
      check('列表样：第 ' + (i + 1) + ' 页重复表头', page.includes('销售明细清单') && page.includes('单号'))
    })
    check('列表样：页1 = 明细 1-3（首单）', listPages[0].includes('全棉精梳府绸') && listPages[0].includes('涤纶缝纫线') && !listPages[0].includes('铜版纸'))
    check('列表样：页2 = 明细 4-5 + 合计', listPages[1].includes('铜版纸') && listPages[1].includes('哑粉纸') && listPages[1].includes('合计') && listPages[1].includes('33130.00'))
    check('列表样：页3 = 签字行', listPages[2].includes('制表人'))
    const listAll = listPages.join('|')
    check('列表样：明细无丢失无重复', ['全棉精梳府绸', '涤纶四面弹面料', '涤纶缝纫线', '铜版纸', '哑粉纸'].every((name) => countOf(listAll, name) === 1))
    check('列表样：跨页单号分布 3+2', countOf(listAll, 'SO-2026-001') === 3 && countOf(listAll, 'SO-2026-002') === 2)
    const listPrint = await clickPrintCapture()
    check('列表样：打印输出与预览同产物', listPrint.srcdoc === previewFrame().srcdoc)
    await closeDialog()

    // ─── 中式单据：销售出库单 ───
    await openTemplate('seed-template-cn-receipt', '销售出库单（中式单据）')
    check('中式单据：模板加载后模板名回填', templatePanel().querySelector('input[type="text"]').value === '销售出库单（中式单据）')
    await tweakAndUndo()
    await openPrintDialog()
    await waitPreviewPages(1, 'A4 缺省预览（单页）')
    check('中式单据：A4 缺省单页', dialogMetas().some((m) => m === '共 1 页'))
    const cnOne = pages()[0] || ''
    for (const text of ['销售出库单', 'SO-2026-001', '2026-11-01', '杭州锦绣纺织有限公司', '杭州市萧山区金城路 77 号', '全棉精梳府绸', '40×40 133×72 幅宽 150cm', '涤纶四面弹面料', '涤纶缝纫线', '合计', '壹万贰仟伍佰捌拾元整', '3820', '12580.00', '陈明', '王志强', '李小红', '赵伟']) {
      check('中式单据：单页含「' + text + '」', cnOne.includes(text))
    }
    check('中式单据：嵌套归组只取首单', !cnOne.includes('SO-2026-002') && !cnOne.includes('铜版纸') && !cnOne.includes('哑粉纸'))
    check('中式单据：明细行循环展开 3 行', countOf(cnOne, '40×40 133×72 幅宽 150cm') === 1 && countOf(cnOne, '75D 幅宽 160cm') === 1 && countOf(cnOne, '402 支 5000m') === 1)
    check('中式单据：打印输出无占位符残留', !cnOne.includes('{{'))
    assertMergedTitle('中式单据', 8)
    await setFixRows(4)
    await waitPreviewPages(5, 'fixrows=4 分页 5 页')
    check('中式单据：弹框页数显示共 5 页', dialogMetas().some((m) => m === '共 5 页'))
    const cnPages = pages()
    cnPages.forEach((page, i) => {
      check('中式单据：第 ' + (i + 1) + ' 页重复表头（单据头）', page.includes('销售出库单') && page.includes('SO-2026-001'))
    })
    check('中式单据：页1 = 客户/地址', cnPages[0].includes('杭州锦绣纺织有限公司') && cnPages[0].includes('杭州市萧山区金城路 77 号') && !cnPages[0].includes('品名'))
    check('中式单据：页2 = 列头 + 明细 1', cnPages[1].includes('品名') && cnPages[1].includes('全棉精梳府绸') && !cnPages[1].includes('涤纶四面弹面料'))
    check('中式单据：页3 = 明细 2-3', cnPages[2].includes('涤纶四面弹面料') && cnPages[2].includes('涤纶缝纫线') && !cnPages[2].includes('合计'))
    check('中式单据：页4 = 合计 + 经手/审核', cnPages[3].includes('合计') && cnPages[3].includes('壹万贰仟伍佰捌拾元整') && cnPages[3].includes('3820') && cnPages[3].includes('12580.00') && cnPages[3].includes('陈明') && cnPages[3].includes('王志强'))
    check('中式单据：页5 = 制单/签收', cnPages[4].includes('李小红') && cnPages[4].includes('赵伟'))
    const cnAll = cnPages.join('|')
    check('中式单据：明细无丢失无重复', ['全棉精梳府绸', '涤纶四面弹面料', '涤纶缝纫线'].every((name) => countOf(cnAll, name) === 1))
    check('中式单据：单据头每页重复（5 页 5 次）', countOf(cnAll, 'SO-2026-001') === 5)
    const cnPrint = await clickPrintCapture()
    check('中式单据：打印输出与预览同产物', cnPrint.srcdoc === previewFrame().srcdoc)
    await closeDialog()
  }

  run()
    .catch((error) => check('页内执行异常', false, error && error.stack ? error.stack : String(error)))
    .then(() => {
      window.__E2E__ = {
        total: results.length,
        pass: results.every((r) => r.ok),
        failures: results.filter((r) => !r.ok).map((r) => r.name + (r.detail ? '｜' + r.detail : '')),
      }
    })
})()
`

/** 启动一个 detached 子进程（进程组），返回句柄；stdio 收日志供失败诊断 */
function startDetached(label, cmd, args, options = {}) {
  const child = spawn(cmd, args, { stdio: 'pipe', detached: true, ...options })
  let log = ''
  child.stdout.on('data', (chunk) => (log += chunk))
  child.stderr.on('data', (chunk) => (log += chunk))
  child.on('exit', () => {
    if (!exiting) {
      console.error(`[e2e] ${label} 进程意外退出：\n${log}`)
    }
  })
  return { child, log: () => log }
}

let exiting = false

function shutdown(backend, preview) {
  exiting = true
  run('playwright-cli', [`-s=${SESSION}`, 'close'])
  for (const server of [backend, preview]) {
    if (server?.child.pid) {
      try {
        process.kill(-server.child.pid, 'SIGTERM')
      } catch {
        // 进程组已退出
      }
    }
  }
}

async function waitServerReady(label, probe, log) {
  const deadline = Date.now() + SERVER_TIMEOUT_MS
  for (;;) {
    try {
      if (await probe()) return
    } catch {
      // 未就绪，继续等
    }
    if (Date.now() > deadline) {
      throw new Error(`${label} 未就绪：\n${log()}`)
    }
    await sleep(300)
  }
}

async function main() {
  if (!path.basename(process.execPath).includes('bun')) {
    throw new Error('请用 bun 运行本脚本（后端依赖 bun:sqlite）：bun scripts/e2e-print.mjs')
  }
  const cliCheck = run('playwright-cli', ['--version'])
  if (cliCheck.error || cliCheck.status !== 0) {
    throw new Error('未找到 playwright-cli（安装：npm i -g @playwright/cli）')
  }

  console.log('[e2e] 构建前端 …')
  const build = run(vpBin, ['build'], { cwd: appRoot, stdio: 'inherit' })
  if (build.status !== 0) {
    throw new Error('vp build 失败')
  }

  await reclaimPort(API_PORT, (command) => command.includes('src/server/index.ts'))
  await reclaimPort(
    PREVIEW_PORT,
    (command) => command.includes('preview') && command.includes(`--port ${PREVIEW_PORT}`),
  )

  // 注册库落独立临时目录（幂等 seed 照常执行，不污染应用 data/ 注册库）
  const dbDir = mkdtempSync(path.join(tmpdir(), 'pfd-e2e-'))
  const backend = startDetached('后端', process.execPath, ['src/server/index.ts'], {
    cwd: appRoot,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      PRINT_FORM_DB: path.join(dbDir, 'registry.sqlite'),
    },
  })
  const preview = startDetached(
    'preview',
    vpBin,
    ['preview', '--host', '127.0.0.1', '--port', String(PREVIEW_PORT), '--strictPort'],
    { cwd: appRoot },
  )

  const onSignal = (signal) => {
    shutdown(backend, preview)
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }
  process.on('SIGINT', () => onSignal('SIGINT'))
  process.on('SIGTERM', () => onSignal('SIGTERM'))

  try {
    await waitServerReady('preview 服务', async () => (await fetch(BASE_URL)).ok, preview.log)
    // 经前端代理探测后端（同源 /api 转发 8787）
    await waitServerReady(
      '后端服务（经 /api 代理）',
      async () => (await fetch(`${BASE_URL}/api/templates`)).ok,
      () => backend.log() + '\n' + preview.log(),
    )

    const failures = []
    await assertTemplatesViaRest(failures)

    const open = run('playwright-cli', ['-s=' + SESSION, 'open', '--browser=chromium', BASE_URL])
    if (open.status !== 0) {
      throw new Error(`playwright-cli open 失败：\n${open.stdout ?? ''}${open.stderr ?? ''}`)
    }
    console.log('[e2e] 页面已打开，页内端到端流程执行中 …')

    // 页内脚本 fire-and-forget（eval 按表达式求值，包 IIFE；结果经 window.__E2E__ 轮询）
    run('playwright-cli', [
      '-s=' + SESSION,
      '--raw',
      'eval',
      `(() => { setTimeout(() => { ${PAGE_SCRIPT} }, 0); return 'started' })()`,
    ])
    const deadline = Date.now() + E2E_TIMEOUT_MS
    let inPage = null
    for (;;) {
      const poll = run('playwright-cli', [
        '-s=' + SESSION,
        '--raw',
        'eval',
        'window.__E2E__ ? JSON.stringify(window.__E2E__) : ""',
      ])
      const out = (poll.stdout ?? '').trim()
      if (out) {
        try {
          const value = parseCliJson(out)
          if (value && value.total > 0) {
            inPage = value
            break
          }
        } catch {
          // 结果未就绪，继续轮询
        }
      }
      if (Date.now() > deadline) {
        throw new Error(
          `页内端到端超时未完成（window.__E2E__ 未就绪）\n` +
            `poll status=${poll.status} stdout=${JSON.stringify(out)} stderr=${JSON.stringify((poll.stderr ?? '').slice(-400))}`,
        )
      }
      await sleep(1000)
    }

    const restTotal = SEED_TEMPLATE_IDS.length
    const allFailures = [...failures, ...inPage.failures]
    console.log(`[e2e] REST 断言 ${restTotal} 项、页内断言 ${inPage.total} 项`)
    if (allFailures.length === 0) {
      console.log('[e2e] 全部通过（列表样与中式单据各完成加载/微调/打印一张）')
      return
    }
    for (const failure of allFailures) {
      console.error(`[e2e] ✗ ${failure}`)
    }
    console.error(`[e2e] ${allFailures.length} 项失败`)
    process.exitCode = 1
  } finally {
    shutdown(backend, preview)
  }
}

try {
  await main()
} catch (error) {
  console.error(`[e2e] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
