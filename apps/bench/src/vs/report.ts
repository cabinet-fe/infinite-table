// vs 报告：两库多轮样本聚合 → 逐指标对比（倍数 = 快/慢多少倍），按数据规模分节，
// 同一份 HTML 渲染既注入浏览器页面也落静态报告文件；文本渲染供驱动脚本打控制台。

import type { VsRunResult, VsSample } from './scenarios'
import { BATCH_CELLS, SCROLL_MEASURE_FRAMES, SCROLL_STEP_Y, scaleLabel } from './scenarios'

/** 视角固定为 infinite-table：advantage > 1 表示我们占优 */
export interface VsComparisonRow {
  id: string
  scale: number
  label: string
  group: string
  unit: VsSample['unit']
  better: 'lower' | 'higher'
  ours: number
  theirs: number
  note?: string
  /** ours/theirs 按方向归一后的优势倍数（>1 = infinite-table 更快/更优） */
  advantage: number
  verdict: 'faster' | 'slower' | 'even'
}

export interface VsComparisonReport {
  tool: 'infinite-table-vs-vtable'
  startedAt: string
  env: string
  dataset: string
  protocol: string
  writeCounts: Record<string, number>
  versions: Record<string, string>
  durationMs: number
  rows: VsComparisonRow[]
  scales: number[]
  wins: number
  total: number
}

const EVEN_BAND = 0.05

/** 多轮样本按（规模 + 指标）聚合取均值；Map 插入序即场景输出序 */
function averageById(rounds: VsSample[][]): Map<string, VsSample> {
  const byId = new Map<string, { sample: VsSample; values: number[] }>()
  for (const round of rounds) {
    for (const sample of round) {
      const key = `${sample.scale}:${sample.id}`
      const entry = byId.get(key) ?? { sample, values: [] }
      entry.values.push(sample.value)
      byId.set(key, entry)
    }
  }
  const averaged = new Map<string, VsSample>()
  for (const [key, entry] of byId) {
    averaged.set(key, {
      ...entry.sample,
      value: entry.values.reduce((s, v) => s + v, 0) / entry.values.length,
    })
  }
  return averaged
}

export function buildComparisonReport(run: VsRunResult): VsComparisonReport {
  const ours = averageById(run.rounds['ours'] ?? [])
  const theirs = averageById(run.rounds['vtable'] ?? [])
  const rows: VsComparisonRow[] = []
  // 按 ours 的插入序（= 跑序 = 规模顺序）展开
  for (const [key, a] of ours) {
    const b = theirs.get(key)
    if (!b) continue
    const advantage = a.better === 'lower' ? b.value / a.value : a.value / b.value
    const verdict =
      advantage >= 1 + EVEN_BAND ? 'faster' : advantage <= 1 - EVEN_BAND ? 'slower' : 'even'
    rows.push({
      id: a.id,
      scale: a.scale,
      label: a.label,
      group: a.group,
      unit: a.unit,
      better: a.better,
      ours: a.value,
      theirs: b.value,
      note: a.note,
      advantage,
      verdict,
    })
  }
  return {
    tool: 'infinite-table-vs-vtable',
    startedAt: run.startedAt,
    env: run.env,
    dataset: `10 万 / 100 万行 × 20 列 · 视口 1280×720 · 行高 32 · 列宽 100 · 无冻结 · 默认主题`,
    protocol: `每规模跑序 [infinite-table, VTable, VTable, infinite-table] 各 2 轮取均值；滚动 ${SCROLL_MEASURE_FRAMES} 帧 × ${SCROLL_STEP_Y}px；批量写 ${BATCH_CELLS} 格`,
    writeCounts: Object.fromEntries(Object.entries(run.writeCounts).map(([k, v]) => [k, v])),
    versions: run.versions,
    durationMs: run.durationMs,
    rows,
    scales: [...new Set(rows.map((r) => r.scale))],
    wins: rows.filter((row) => row.verdict === 'faster').length,
    total: rows.length,
  }
}

function formatValue(value: number, unit: VsSample['unit']): string {
  if (unit === 'fps') return value.toFixed(1)
  if (unit === 'ops/ms') return value.toFixed(0)
  return value < 10 ? value.toFixed(2) : value.toFixed(1)
}

function verdictBadge(row: VsComparisonRow): string {
  if (row.verdict === 'faster') {
    return `<span class="badge faster">快 ${row.advantage.toFixed(2)}×</span>`
  }
  if (row.verdict === 'slower') {
    return `<span class="badge slower">慢 ${(1 / row.advantage).toFixed(2)}×</span>`
  }
  return `<span class="badge even">持平</span>`
}

/** 双向比例条：按指标方向取相对长度，优者长（满格侧 = 更优一方） */
function bars(row: VsComparisonRow): string {
  const { ours, theirs, better } = row
  const max = Math.max(ours, theirs) || 1
  const oursRatio = ours / max
  const theirsRatio = theirs / max
  const oursGood = better === 'lower' ? ours <= theirs : ours >= theirs
  return `
      <div class="bars">
        <div class="bar-row"><span class="bar ours ${oursGood ? 'good' : 'bad'}" style="width:${(oursRatio * 100).toFixed(1)}%"></span></div>
        <div class="bar-row"><span class="bar theirs ${oursGood ? 'bad' : 'good'}" style="width:${(theirsRatio * 100).toFixed(1)}%"></span></div>
      </div>`
}

function groupTable(rowsOfGroup: readonly VsComparisonRow[]): string {
  return `
      <table>
        <thead><tr><th class="metric">指标</th><th>infinite-table</th><th>@visactor/vtable</th><th class="verdict">对比</th></tr></thead>
        <tbody>
${rowsOfGroup
  .map(
    (r) => `          <tr>
            <td class="metric">${r.label}${r.note ? `<div class="note">${r.note}</div>` : ''}</td>
            <td class="value ours">${formatValue(r.ours, r.unit)}<span class="unit">${r.unit}</span>${bars(r)}
            </td>
            <td class="value">${formatValue(r.theirs, r.unit)}<span class="unit">${r.unit}</span></td>
            <td class="verdict">${verdictBadge(r)}</td>
          </tr>`,
  )
  .join('\n')}
        </tbody>
      </table>`
}

/** 单规模一节：节标题含该规模小计，节内按场景分组 */
function scaleSection(
  scale: number,
  rowsOfScale: readonly VsComparisonRow[],
  writeCount: number,
): string {
  const wins = rowsOfScale.filter((r) => r.verdict === 'faster').length
  const groups: string[] = []
  const seen = new Set<string>()
  for (const row of rowsOfScale) {
    if (seen.has(row.group)) continue
    seen.add(row.group)
    groups.push(`
    <div class="group">
      <h3>${row.group}</h3>
${groupTable(rowsOfScale.filter((r) => r.group === row.group))}
    </div>`)
  }
  return `
  <section class="scale">
    <h2>${scaleLabel(scale)} × 20 列<span class="scale-sub">领先 ${wins} / ${rowsOfScale.length} 项 · 逐格写 ${writeCount} 次/轮</span></h2>
${groups.join('\n')}
  </section>`
}

/** 自包含 HTML 片段（含内联样式）：浏览器页面注入与静态报告文件共用 */
export function renderReportHtml(report: VsComparisonReport): string {
  const sections = report.scales
    .map((scale) =>
      scaleSection(
        scale,
        report.rows.filter((r) => r.scale === scale),
        report.writeCounts[String(scale)] ?? 0,
      ),
    )
    .join('\n')
  return `
<div class="vs-report">
  <style>${REPORT_STYLES}</style>
  <header>
    <h1>infinite-table <span class="vs">vs</span> @visactor/vtable 性能对比</h1>
    <p class="meta">${report.dataset}</p>
    <p class="meta">${report.protocol}</p>
    <p class="meta">infinite-table：${report.versions['infinite-table']} · @visactor/vtable：${report.versions['@visactor/vtable']}</p>
    <div class="summary">
      <div class="summary-item"><span class="summary-num">${report.wins}</span><span class="summary-label">领先项</span></div>
      <div class="summary-item"><span class="summary-num">${report.rows.filter((r) => r.verdict === 'slower').length}</span><span class="summary-label">落后项</span></div>
      <div class="summary-item"><span class="summary-num">${report.rows.filter((r) => r.verdict === 'even').length}</span><span class="summary-label">持平项</span></div>
      <div class="summary-item"><span class="summary-num">${report.total}</span><span class="summary-label">对比指标</span></div>
    </div>
  </header>
${sections}
  <footer>
    <p>口径：TTFF = 构造 + 首帧 flush；FPS 由 rAF 帧间隔换算；写入落在可视区产生真实失效；倍数 = 慢方耗时 / 快方耗时（吞吐类 = 高 / 低）。「快 N×」即 infinite-table 领先 N 倍，「慢 N×」即落后 N 倍，±5% 内记持平。</p>
    <p>环境：${report.env}</p>
    <p>采样：${report.startedAt} · 总耗时 ${(report.durationMs / 1000).toFixed(0)}s · 工具 ${report.tool}</p>
  </footer>
</div>`
}

/** 报告内联样式：随片段一起输出，浏览器页面与落档静态文件共用同一渲染源 */
const REPORT_STYLES = `
  .vs-report { max-width: 980px; margin: 0 auto; font-family: ui-sans-serif, system-ui, "PingFang SC", sans-serif; color: #1f2430; }
  .vs-report header h1 { font-size: 22px; margin: 8px 0 4px; }
  .vs-report .vs { color: #6b7280; font-weight: 400; font-size: 16px; margin: 0 6px; }
  .vs-report .meta { color: #6b7280; font-size: 12px; margin: 2px 0; }
  .vs-report .summary { display: flex; gap: 12px; margin: 14px 0 6px; flex-wrap: wrap; }
  .vs-report .summary-item { border: 1px solid #e5e7eb; border-radius: 10px; padding: 8px 16px; min-width: 88px; background: #fff; }
  .vs-report .summary-num { display: block; font-size: 26px; font-weight: 700; }
  .vs-report .summary-item:first-child .summary-num { color: #15803d; }
  .vs-report .summary-item:nth-child(2) .summary-num { color: #b91c1c; }
  .vs-report .summary-label { color: #6b7280; font-size: 12px; }
  .vs-report .scale h2 { font-size: 18px; margin: 26px 0 6px; color: #111827; }
  .vs-report .scale-sub { color: #6b7280; font-weight: 400; font-size: 12px; margin-left: 10px; }
  .vs-report .group { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 4px 12px 10px; margin: 12px 0; }
  .vs-report .group h3 { font-size: 14px; margin: 10px 0 6px; color: #374151; }
  .vs-report table { border-collapse: collapse; width: 100%; font-size: 13px; }
  .vs-report th, .vs-report td { border-bottom: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; vertical-align: top; }
  .vs-report thead th { color: #6b7280; font-weight: 500; font-size: 12px; }
  .vs-report td.metric { width: 34%; }
  .vs-report td.value { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .vs-report td.value.ours { font-weight: 600; }
  .vs-report .unit { color: #9ca3af; margin-left: 4px; font-size: 11px; }
  .vs-report .note { color: #9ca3af; font-size: 11px; margin-top: 2px; }
  .vs-report .badge { display: inline-block; border-radius: 999px; padding: 2px 10px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .vs-report .badge.faster { background: #dcfce7; color: #15803d; }
  .vs-report .badge.slower { background: #fee2e2; color: #b91c1c; }
  .vs-report .badge.even { background: #f3f4f6; color: #6b7280; }
  .vs-report .bars { margin-top: 4px; width: 180px; }
  .vs-report .bar-row { height: 5px; margin: 2px 0; }
  .vs-report .bar { display: block; height: 5px; border-radius: 3px; }
  .vs-report .bar.ours { background: #2563eb; }
  .vs-report .bar.theirs { background: #d1d5db; }
  .vs-report .bar.good { opacity: 1; }
  .vs-report .bar.bad { opacity: 0.45; }
  .vs-report footer { margin: 24px 0 40px; color: #9ca3af; font-size: 12px; line-height: 1.7; }
`

/** 控制台文本（驱动脚本汇总输出用） */
export function formatComparisonText(report: VsComparisonReport): string {
  const lines: string[] = [
    `infinite-table vs @visactor/vtable（${report.dataset}）`,
    `领先 ${report.wins} / ${report.total} 项指标`,
    '',
  ]
  for (const scale of report.scales) {
    lines.push(`—— ${scaleLabel(scale)} ——`)
    for (const row of report.rows.filter((r) => r.scale === scale)) {
      const badge =
        row.verdict === 'faster'
          ? `快 ${row.advantage.toFixed(2)}x`
          : row.verdict === 'slower'
            ? `慢 ${(1 / row.advantage).toFixed(2)}x`
            : '持平'
      lines.push(
        `${badge.padStart(8)}  ${row.label}: infinite-table ${formatValue(row.ours, row.unit)}${row.unit} vs vtable ${formatValue(row.theirs, row.unit)}${row.unit}`,
      )
    }
    lines.push('')
  }
  return lines.join('\n')
}
