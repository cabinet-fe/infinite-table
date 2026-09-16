// 基准报告：场景结果结构与可读文本输出（JSON 序列化由运行入口负责，作防回归基线落档）

export interface BenchCheck {
  label: string;
  passed: boolean;
}

export interface BenchMetric {
  label: string;
  value: string;
}

export interface ScenarioResult {
  id: string;
  title: string;
  passed: boolean;
  metrics: BenchMetric[];
  checks: BenchCheck[];
}

export interface BenchReport {
  tool: 'infinite-table-bench';
  env: string;
  dataset: string;
  startedAt: string;
  durationMs: number;
  passed: boolean;
  scenarios: ScenarioResult[];
}

export function formatTextReport(report: BenchReport): string {
  const lines: string[] = [
    `infinite-table 量化基准报告`,
    `环境：${report.env}`,
    `数据集：${report.dataset}`,
    `时间：${report.startedAt}（耗时 ${report.durationMs.toFixed(0)}ms）`,
    ``,
  ];
  for (const scenario of report.scenarios) {
    lines.push(`${scenario.passed ? '通过' : '未通过'}  ${scenario.title}`);
    for (const metric of scenario.metrics) {
      lines.push(`    ${metric.label}: ${metric.value}`);
    }
    for (const check of scenario.checks) {
      lines.push(`    [${check.passed ? '✓' : '✗'}] ${check.label}`);
    }
    lines.push(``);
  }
  lines.push(report.passed ? '全部基准达标' : '存在未达标基准');
  return lines.join('\n');
}
