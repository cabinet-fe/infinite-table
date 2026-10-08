// 数据供给三形态演示：records/columns 数组、按格 hook、模型事件订阅（含表格回驱防回环）。
// 模型区的改写按钮与取值状态行由 React 页面（DataFormsPage）驱动本模块返回的句柄，不在 section 内建 DOM。

import type { CellChangeEvent, TableModel } from '@infinitable/core'

import { mountTable, type DemoMount } from '../mount'

/** 演示用外部数据模型：Map 存储 + 变更事件订阅 + 回写入口 */
export class DemoModel implements TableModel {
  readonly rowCount = 1000
  /** 变更次数：回驱 echo 被吞时，一次 updateCell 只计一次（防回环可观测） */
  changeCount = 0
  private readonly values = new Map<string, unknown>()
  private readonly listeners = new Set<(change: CellChangeEvent) => void>()

  getCellValue(col: number, row: number): unknown {
    return this.values.get(`${col}:${row}`) ?? `M(${col},${row})`
  }

  setCellValue(col: number, row: number, value: unknown): void {
    const oldValue = this.values.get(`${col}:${row}`)
    this.values.set(`${col}:${row}`, value)
    this.changeCount++
    for (const listener of this.listeners) {
      listener({ col, row, oldValue, newValue: value })
    }
  }

  onCellChange(listener: (change: CellChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export interface DataFormsDemo {
  records: DemoMount
  hooks: DemoMount
  modelMount: DemoMount
  model: DemoModel
}

export function mountDataForms(root: HTMLElement): DataFormsDemo {
  const section = document.createElement('section')
  root.appendChild(section)
  /** 供数形态子标题（样式由 global.css 的 section h3 规则承担） */
  const addHeading = (text: string): void => {
    const heading = document.createElement('h3')
    heading.textContent = text
    section.appendChild(heading)
  }

  addHeading('records/columns 数组')
  const records: DemoMount = mountTable(section, {
    width: 720,
    height: 220,
    columns: [
      { field: 'name', title: '姓名', width: 160 },
      { field: 'qty', title: '数量', width: 120 },
      { field: 'price', title: '单价', width: 120 },
      { field: 'done', title: '完成', width: 100, cellType: 'checkbox' },
    ],
    records: Array.from({ length: 5000 }, (_, row) => ({
      name: `用户-${row}`,
      qty: row % 97,
      price: ((row * 13) % 500) + 1,
      done: row % 2 === 0,
    })),
  })

  addHeading('按格 hook（resolveDisplayValue / resolveCellStyle）')
  const hooks: DemoMount = mountTable(section, {
    width: 720,
    height: 220,
    columns: Array.from({ length: 5 }, (_, col) => ({ title: `列${col}`, width: 130 })),
    rowCount: 5000,
    resolveDisplayValue: (col, row) => `格(${col},${row})=${row * 100 + col}`,
    resolveCellStyle: (_col, row) => (row % 5 === 0 ? { background: '#eef2ff' } : null),
  })

  addHeading('模型事件订阅（外部变更 → 局部刷新；updateCell → 回驱防回环）')
  const model = new DemoModel()
  const modelMount: DemoMount = mountTable(section, {
    width: 720,
    height: 220,
    columns: Array.from({ length: 4 }, (_, col) => ({ title: `模型列${col}`, width: 160 })),
    model,
  })

  return { records, hooks, modelMount, model }
}
