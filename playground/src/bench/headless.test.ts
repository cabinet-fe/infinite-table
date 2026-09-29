// 量化基准回归（并入 vp test run 的统一测试入口，无独立 bench 命令）：
// headless 假画布跑全部场景 → 阈值断言 + 可读报告 + JSON 落档 results/（防回归基线）。
// 性能测量须独占 CPU：根 vitest 配置 fileParallelism 已关，勿在本文件外再引入并行负载。

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

import { formatTextReport } from './report'
import { runAllScenarios } from './scenarios'
import { createHeadlessEnv } from './headless'

it(
  '量化基准回归：全部场景达标（TTFF/滚动稳态/失效面积/写吞吐）',
  // 10 万行建表 + 多场景采样，CI 低配机留足余量
  { timeout: 120_000 },
  async () => {
    const report = await runAllScenarios(createHeadlessEnv())
    console.log(formatTextReport(report))

    const resultsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'results')
    mkdirSync(resultsDir, { recursive: true })
    const file = join(resultsDir, `bench-${report.startedAt.replaceAll(/[:.]/g, '-')}.json`)
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`报告已落档：${file}`)

    expect
      .soft(
        report.passed,
        report.scenarios
          .flatMap((s) => s.checks.filter((c) => !c.passed).map((c) => `${s.title}：${c.label}`))
          .join('\n'),
      )
      .toBe(true)
  },
)
