#!/usr/bin/env node
// 浏览器冒烟驱动（可重复）：vp build → vp preview（固定端口）→ playwright-cli 打开 ?smoke=1 →
// 轮询页内自检结果 window.__SMOKE__ → 汇总退出码。失败时逐项输出失败清单。
// 用法：bun run smoke（apps/demo 下）；依赖全局 playwright-cli（见 playwright-cli 技能）。

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const demoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vpBin = path.join(demoRoot, '..', '..', 'node_modules', '.bin', 'vp');
const PORT = 54173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SESSION = 'infinite-table-demo-smoke';
const SERVER_TIMEOUT_MS = 30_000;
const SMOKE_TIMEOUT_MS = 120_000;

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...options });
}

/** playwright-cli --raw 对字符串返回值会再包一层引号转义，这里解包后取对象 */
function parseSmokeResult(text) {
  const value = JSON.parse(text);
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function main() {
  const cliCheck = run('playwright-cli', ['--version']);
  if (cliCheck.error || cliCheck.status !== 0) {
    throw new Error(
      '未找到 playwright-cli（安装：npm i -g @playwright/cli，用法见 playwright-cli 技能）',
    );
  }

  console.log('[smoke] 构建 apps/demo …');
  const build = run(vpBin, ['build'], { cwd: demoRoot, stdio: 'inherit' });
  if (build.status !== 0) {
    throw new Error('vp build 失败');
  }

  // detached + 进程组终止：vp 是包装进程，只 kill 它会遗留真正的 vite preview 子进程
  const server = spawn(
    vpBin,
    ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: demoRoot, stdio: 'pipe', detached: true },
  );
  let serverLog = '';
  server.stdout.on('data', (chunk) => (serverLog += chunk));
  server.stderr.on('data', (chunk) => (serverLog += chunk));

  try {
    const serverDeadline = Date.now() + SERVER_TIMEOUT_MS;
    for (;;) {
      try {
        const res = await fetch(BASE_URL);
        if (res.ok) {
          break;
        }
      } catch {
        // 服务未起，继续等
      }
      if (Date.now() > serverDeadline) {
        throw new Error(`preview 服务未就绪：\n${serverLog}`);
      }
      await sleep(300);
    }

    const open = run('playwright-cli', [
      `-s=${SESSION}`,
      'open',
      '--browser=chromium',
      `${BASE_URL}/?smoke=1`,
    ]);
    if (open.status !== 0) {
      throw new Error(`playwright-cli open 失败：\n${open.stdout ?? ''}${open.stderr ?? ''}`);
    }
    console.log('[smoke] 页面已打开，等待页内自检 …');

    const smokeDeadline = Date.now() + SMOKE_TIMEOUT_MS;
    for (;;) {
      const poll = run('playwright-cli', [
        `-s=${SESSION}`,
        '--raw',
        'eval',
        'window.__SMOKE__ ? JSON.stringify(window.__SMOKE__) : ""',
      ]);
      const out = (poll.stdout ?? '').trim();
      if (out) {
        try {
          const result = parseSmokeResult(out);
          if (result.done) {
            return result;
          }
        } catch {
          // 结果未就绪，继续轮询
        }
      }
      if (Date.now() > smokeDeadline) {
        throw new Error(
          `页内冒烟超时未完成（window.__SMOKE__ 未就绪）\n` +
            `poll status=${poll.status} stdout=${JSON.stringify(out)} stderr=${JSON.stringify((poll.stderr ?? '').slice(-400))}`,
        );
      }
      await sleep(1000);
    }
  } finally {
    run('playwright-cli', [`-s=${SESSION}`, 'close']);
    if (server.pid) {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        // 进程组已退出
      }
    }
  }
}

let exitCode = 0;
try {
  const result = await main();
  console.log(`[smoke] 页内断言共 ${result.total} 项`);
  if (result.pass) {
    console.log('[smoke] 全部通过');
  } else {
    for (const failure of result.failures) {
      console.error(`[smoke] ✗ ${failure}`);
    }
    console.error(`[smoke] ${result.failures.length} 项失败`);
    exitCode = 1;
  }
} catch (error) {
  console.error(`[smoke] ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
}
process.exit(exitCode);
