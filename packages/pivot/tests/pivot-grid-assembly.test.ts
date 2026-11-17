// @vitest-environment happy-dom
// PivotGrid 引擎装配协议（EngineAssembly）验收测试：
// 验证 plugins 构造项、use/unuse、destroy 逆序卸载、registerPainter、resize、
// capabilities.gridRead 与只读语义（无 updateCell / onCellChange）。

import { describe, expect, it, vi } from 'vitest'

import type { EngineAssembly, EnginePlugin } from '@infinitable/protocol'

import { PivotGrid } from '../src/pivot-grid'
import type { PivotDimension, PivotMeasure, PivotRecord } from '../src/types'

const DIMENSIONS: PivotDimension[] = [
  { key: 'status', title: '状态', width: 120 },
  { key: 'priority', title: '优先级', width: 100 },
]

const MEASURES: PivotMeasure[] = [
  { key: 'amount', title: '金额和', field: 'amount', agg: 'sum', width: 120 },
]

const RECORDS: PivotRecord[] = [
  { status: '已完成', priority: '中', amount: 10 },
  { status: '待启动', priority: '低', amount: 25 },
]

function createPivot(plugins?: readonly EnginePlugin[]): PivotGrid {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return new PivotGrid({
    container,
    width: 600,
    height: 400,
    dpr: 1,
    dimensions: DIMENSIONS,
    measures: MEASURES,
    records: RECORDS,
    rowDimensions: ['status', 'priority'],
    columnDimensions: [],
    plugins,
  })
}

describe('PivotGrid EngineAssembly 装配协议', () => {
  it('满足 EngineAssembly 契约，且只读引擎不暴露 updateCell / onCellChange', () => {
    const pivot = createPivot()
    try {
      const assembly: EngineAssembly = pivot
      expect(assembly).toBe(pivot)
      expect(assembly.host).toBe(pivot.getTable().host)
      expect(assembly.width).toBe(600)
      expect(assembly.height).toBe(400)
      expect(assembly.capabilities?.gridRead).toBe(pivot.read)
      expect(assembly.capabilities?.gridRead?.rowCount).toBe(pivot.rowCount)
      expect(assembly.capabilities?.gridRead?.getCellText(2, 3)).toBe('35')
      expect('updateCell' in pivot).toBe(false)
      expect('onCellChange' in pivot).toBe(false)
    } finally {
      pivot.destroy()
    }
  })

  it('plugins 构造项与 use/unuse 向插件传入 PivotGrid 实例（非内部 ListTable），destroy 逆序卸载', () => {
    const events: string[] = []
    const receivedEngines: EngineAssembly[] = []

    const p1: EnginePlugin = {
      name: 'p1',
      mount(engine) {
        receivedEngines.push(engine)
        events.push('mount:p1')
        return () => events.push('cleanup:p1')
      },
      unmount(engine) {
        receivedEngines.push(engine)
        events.push('unmount:p1')
      },
    }
    const p2: EnginePlugin = {
      name: 'p2',
      mount(engine) {
        receivedEngines.push(engine)
        events.push('mount:p2')
        return () => events.push('cleanup:p2')
      },
      unmount(engine) {
        receivedEngines.push(engine)
        events.push('unmount:p2')
      },
    }
    const p3: EnginePlugin = {
      name: 'p3',
      mount(engine) {
        receivedEngines.push(engine)
        events.push('mount:p3')
      },
      unmount(engine) {
        receivedEngines.push(engine)
        events.push('unmount:p3')
      },
    }

    const pivot = createPivot([p1, p2])
    expect(events).toEqual(['mount:p1', 'mount:p2'])

    const disposeP3 = pivot.use(p3)
    expect(events).toEqual(['mount:p1', 'mount:p2', 'mount:p3'])

    // 所有插件收到的都是 PivotGrid 本体，而非内部 ListTable
    for (const engine of receivedEngines) {
      expect(engine).toBe(pivot)
      expect(engine).not.toBe(pivot.getTable())
    }

    // unuse 按实例或名称卸载
    pivot.unuse('p2')
    expect(events).toEqual(['mount:p1', 'mount:p2', 'mount:p3', 'cleanup:p2', 'unmount:p2'])

    // 重新挂载 p2 后验证 destroy 逆序卸载（p3 -> p2 -> p1）
    pivot.use(p2)
    pivot.destroy()
    expect(events).toEqual([
      'mount:p1',
      'mount:p2',
      'mount:p3',
      'cleanup:p2',
      'unmount:p2',
      'mount:p2',
      'cleanup:p2',
      'unmount:p2',
      'unmount:p3',
      'cleanup:p1',
      'unmount:p1',
    ])

    // 销毁幂等，且销毁后调用 dispose 不重复卸载
    expect(() => disposeP3()).not.toThrow()
    expect(() => pivot.destroy()).not.toThrow()
  })

  it('registerPainter 与 resize 正确转发到底层引擎', () => {
    const pivot = createPivot()
    try {
      const paint = vi.fn<() => void>()
      const unregister = pivot.registerPainter({
        id: 'pivot-overlay',
        slot: 'overlay',
        paint,
      })
      expect(typeof unregister).toBe('function')
      unregister()
      expect(() => unregister()).not.toThrow()

      pivot.resize(840, 520)
      expect(pivot.width).toBe(840)
      expect(pivot.height).toBe(520)
      expect(pivot.getTable().width).toBe(840)
      expect(pivot.getTable().height).toBe(520)
    } finally {
      pivot.destroy()
    }
  })
})
