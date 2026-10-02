#!/usr/bin/env node
// 浏览器冒烟驱动（可重复，手动按需直跑，不占 npm script 入口）：vp build → vp preview（固定端口）→
// playwright-cli 打开 ?smoke=1 → 轮询页内自检结果 window.__SMOKE__ → 汇总退出码。失败时逐项输出失败清单。
// 用法：node scripts/smoke.mjs（playground 下）；依赖全局 playwright-cli（见 playwright-cli 技能）。
// 端口占用处置：启动前探测 PORT——本脚本泄漏的 vp preview（Ctrl+C 时 finally 不执行遗留）就地回收；
// 异物进程立即报错点名 PID，绝不静默借用占用者（其内容可能是旧构建/空 cwd，断言结果不可信）。

import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vpBin = path.join(appRoot, '..', 'node_modules', '.bin', 'vp')
const PORT = 54173
const BASE_URL = `http://127.0.0.1:${PORT}`
const SESSION = 'infinitable-demo-smoke'
const SERVER_TIMEOUT_MS = 30_000
const SMOKE_TIMEOUT_MS = 120_000
const PORT_RELEASE_TIMEOUT_MS = 5_000

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...options })
}

/** 占用 PORT 的进程清单（pid + 完整命令行）；空数组即端口空闲 */
function portOccupiers() {
  const probe = run('lsof', ['-nP', '-t', '-iTCP:' + PORT, '-sTCP:LISTEN'])
  const pids = (probe.stdout ?? '').trim().split(/\s+/).filter(Boolean)
  return pids.map((pid) => ({
    pid: Number(pid),
    command: run('ps', ['-p', pid, '-o', 'command=']).stdout?.trim() ?? '',
  }))
}

/** 回收上次运行泄漏的 vp preview（detached 进程组，Ctrl+C 时 finally 不执行遗留），异物则报错退出 */
async function reclaimPort() {
  const occupiers = portOccupiers()
  if (occupiers.length === 0) {
    return
  }
  const isOwnLeak = (command) => command.includes('preview') && command.includes(`--port ${PORT}`)
  // command 为空 = 探测与取样间进程已退出，按待释放处理即可
  const foreign = occupiers.find(({ command }) => command !== '' && !isOwnLeak(command))
  if (foreign) {
    throw new Error(
      `端口 ${PORT} 被无关进程占用：PID ${foreign.pid}（${foreign.command}）。` +
        '换掉该进程或改 smoke.mjs 的 PORT 后重试。',
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
  while (portOccupiers().length > 0) {
    if (Date.now() > deadline) {
      throw new Error(
        `泄漏的 preview 进程未在 ${PORT_RELEASE_TIMEOUT_MS}ms 内退出，请手动清理后重试`,
      )
    }
    await sleep(200)
  }
}

/** playwright-cli --raw 对字符串返回值会再包一层引号转义，这里解包后取对象 */
function parseSmokeResult(text) {
  const value = JSON.parse(text)
  return typeof value === 'string' ? JSON.parse(value) : value
}

async function main() {
  const cliCheck = run('playwright-cli', ['--version'])
  if (cliCheck.error || cliCheck.status !== 0) {
    throw new Error(
      '未找到 playwright-cli（安装：npm i -g @playwright/cli，用法见 playwright-cli 技能）',
    )
  }

  console.log('[smoke] 构建 playground …')
  const build = run(vpBin, ['build'], { cwd: appRoot, stdio: 'inherit' })
  if (build.status !== 0) {
    throw new Error('vp build 失败')
  }

  await reclaimPort()

  // detached + 进程组终止：vp 是包装进程，只 kill 它会遗留真正的 vite preview 子进程
  const server = spawn(
    vpBin,
    ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: appRoot, stdio: 'pipe', detached: true },
  )
  let serverLog = ''
  let serverExited = false
  server.stdout.on('data', (chunk) => (serverLog += chunk))
  server.stderr.on('data', (chunk) => (serverLog += chunk))
  server.on('exit', () => {
    serverExited = true
  })

  // 中断兜底：Ctrl+C/SIGTERM 直接终止 node 不走 finally，会遗留 detached preview（下次跑端口冲突的根源）
  const onSignal = (signal) => {
    run('playwright-cli', [`-s=${SESSION}`, 'close'])
    if (server.pid) {
      try {
        process.kill(-server.pid, 'SIGTERM')
      } catch {
        // 进程组已退出
      }
    }
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }
  process.on('SIGINT', () => onSignal('SIGINT'))
  process.on('SIGTERM', () => onSignal('SIGTERM'))

  try {
    const serverDeadline = Date.now() + SERVER_TIMEOUT_MS
    for (;;) {
      // preview 秒退（端口冲突等）即刻报错，不做 30 秒无日志空等
      if (serverExited) {
        throw new Error(`preview 服务启动即退出：\n${serverLog}`)
      }
      try {
        const res = await fetch(BASE_URL)
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
      `${BASE_URL}/?smoke=1`,
    ])
    if (open.status !== 0) {
      throw new Error(`playwright-cli open 失败：\n${open.stdout ?? ''}${open.stderr ?? ''}`)
    }
    console.log('[smoke] 页面已打开，等待页内自检 …')

    const smokeDeadline = Date.now() + SMOKE_TIMEOUT_MS
    for (;;) {
      const poll = run('playwright-cli', [
        `-s=${SESSION}`,
        '--raw',
        'eval',
        'window.__SMOKE__ ? JSON.stringify(window.__SMOKE__) : ""',
      ])
      const out = (poll.stdout ?? '').trim()
      if (out) {
        try {
          const result = parseSmokeResult(out)
          if (result.done) {
            return result
          }
        } catch {
          // 结果未就绪，继续轮询
        }
      }
      if (Date.now() > smokeDeadline) {
        throw new Error(
          `页内冒烟超时未完成（window.__SMOKE__ 未就绪）\n` +
            `poll status=${poll.status} stdout=${JSON.stringify(out)} stderr=${JSON.stringify((poll.stderr ?? '').slice(-400))}`,
        )
      }
      await sleep(1000)
    }
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
  const result = await main()
  console.log(`[smoke] 页内断言共 ${result.total} 项`)
  if (result.pass) {
    console.log('[smoke] 全部通过')
  } else {
    for (const failure of result.failures) {
      console.error(`[smoke] ✗ ${failure}`)
    }
    console.error(`[smoke] ${result.failures.length} 项失败`)
    exitCode = 1
  }
} catch (error) {
  console.error(`[smoke] ${error instanceof Error ? error.message : String(error)}`)
  exitCode = 1
}
process.exit(exitCode)
