import { describe, expect, it } from 'vitest'

import { ModelBinding } from '../src/model-binding'
import type { CellChangeEvent, TableModel } from '../src/types'

/** 同步 echo 的假模型：setCellValue 内同步发变更事件（模拟回驱 echo） */
class EchoModel implements TableModel {
  readonly rowCount = 100
  readonly data = new Map<string, unknown>()
  private readonly listeners = new Set<(change: CellChangeEvent) => void>()
  setCalls = 0

  getCellValue(col: number, row: number): unknown {
    return this.data.get(`${col}:${row}`)
  }

  setCellValue(col: number, row: number, value: unknown): void {
    this.setCalls++
    const oldValue = this.data.get(`${col}:${row}`)
    this.data.set(`${col}:${row}`, value)
    this.emit({ col, row, oldValue, newValue: value })
  }

  onCellChange(listener: (change: CellChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(change: CellChangeEvent): void {
    for (const listener of this.listeners) {
      listener(change)
    }
  }
}

/** 同步重算的假模型：setCellValue 回驱本格外，还同步发派生格变更（模拟公式依赖重算） */
class RecalcModel extends EchoModel {
  /** 写入完成后同步发出的派生格事件序列（可含重复通知） */
  constructor(private readonly derived: CellChangeEvent[]) {
    super()
  }

  override setCellValue(col: number, row: number, value: unknown): void {
    super.setCellValue(col, row, value)
    for (const change of this.derived) {
      this.emit(change)
    }
  }
}

describe('ModelBinding 模型事件订阅与回驱防递归', () => {
  it('外部变更事件转发给表格', () => {
    const model = new EchoModel()
    const received: CellChangeEvent[] = []
    const binding = new ModelBinding(model, (change) => received.push(change))
    binding.attach()
    model.emit({ col: 1, row: 2, oldValue: undefined, newValue: undefined })
    expect(received).toEqual([{ col: 1, row: 2 }])
    binding.dispose()
  })

  it('回驱窗口内模型发出的变更格（含派生格）收集去重随返回值交出，不直接转发', () => {
    const model = new RecalcModel([
      { col: 5, row: 5, oldValue: undefined, newValue: 'd1' }, // 同步重算派生格
      { col: 6, row: 6, oldValue: undefined, newValue: 'd2' }, // 同步重算派生格
      { col: 0, row: 0, oldValue: undefined, newValue: 'x' }, // 被编辑格自身 echo（重复）
      { col: 5, row: 5, oldValue: undefined, newValue: 'd1' }, // 派生格重复通知
    ])
    const received: CellChangeEvent[] = []
    const binding = new ModelBinding(model, (change) => received.push(change))
    binding.attach()
    const echoed = binding.writeBack(0, 0, 'x')
    expect(model.getCellValue(0, 0)).toBe('x')
    expect(model.setCalls).toBe(1)
    // 窗口内不直接转发（防回环）；每个变更格（编辑格 + 派生格）在收集结果里恰好一次
    expect(received).toEqual([])
    expect(echoed.map((c) => [c.col, c.row])).toEqual([
      [0, 0],
      [5, 5],
      [6, 6],
    ])
  })

  it('外部事件处理器里回驱模型：echo 不转发回处理器（不递归重入），随返回值收集', () => {
    const model = new EchoModel()
    const received: CellChangeEvent[] = []
    let innerEchoed: readonly CellChangeEvent[] = []
    const binding = new ModelBinding(model, (change) => {
      received.push(change)
      // 外部变更触发的回写：其 echo 不再进入本处理器（无递归），只随返回值交回
      innerEchoed = binding.writeBack(change.col, change.row, 'handled')
    })
    binding.attach()
    model.emit({ col: 3, row: 4, oldValue: undefined, newValue: undefined })
    expect(received).toEqual([{ col: 3, row: 4 }])
    expect(model.setCalls).toBe(1)
    expect(model.getCellValue(3, 4)).toBe('handled')
    expect(innerEchoed.map((c) => [c.col, c.row])).toEqual([[3, 4]])
  })

  it('dispose 后不再接收事件；attach 幂等', () => {
    const model = new EchoModel()
    const received: CellChangeEvent[] = []
    const binding = new ModelBinding(model, (change) => received.push(change))
    binding.attach()
    binding.attach()
    binding.dispose()
    model.emit({ col: 0, row: 0, oldValue: undefined, newValue: undefined })
    expect(received).toEqual([])
  })

  it('模型未提供 setCellValue 时 writeBack 为空操作并返回空收集', () => {
    const model = new EchoModel()
    const readOnly: TableModel = {
      rowCount: 1,
      getCellValue: () => undefined,
      onCellChange: (l) => model.onCellChange(l),
    }
    const binding = new ModelBinding(readOnly, () => {})
    binding.attach()
    expect(binding.writeBack(0, 0, 'x')).toEqual([])
  })
})
