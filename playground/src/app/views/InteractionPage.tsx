// 交互能力：合成事件与交互管线（拖选/整行整列/键盘/resize/右键菜单/批量更新）。
// 选区/右键菜单/滚动三条状态回显与批量更新、全选、清空按钮在本页驱动 mountInteraction 返回的句柄。

import { normalizeRange } from '@infinitable/core'
import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { mountInteraction } from '../../sections/interaction'
import { useDemoMount } from '../useDemoMount'

/** 事件回显胶囊样式：等宽小字、轻边框，与 DataFormsPage 的模型取值回显一致 */
const STATUS_ITEM_CLASS =
  'rounded-md border bg-muted/50 px-2.5 py-1 font-mono text-xs text-muted-foreground'

export function InteractionPage() {
  const { containerRef, demo } = useDemoMount(mountInteraction)
  const [selectionText, setSelectionText] = useState('选区：无')
  const [menuText, setMenuText] = useState('contextmenu：未触发')
  const [scrollText, setScrollText] = useState('scroll：(0,0)')

  // 三个事件订阅的可见化：选区、右键菜单命中、滚动帧位置
  useEffect(() => {
    if (!demo) return
    const { table } = demo.mount
    const offSelection = table.onSelectionChange((snapshot) => {
      if (snapshot.ranges.length === 0) {
        setSelectionText('选区：无')
        return
      }
      const parts = snapshot.ranges.map((range) => {
        const b = normalizeRange(range)
        return `(${b.minCol},${b.minRow})~(${b.maxCol},${b.maxRow})`
      })
      setSelectionText(`选区：${parts.join(' + ')}`)
    })
    const offMenu = table.onContextMenu((event) => {
      setMenuText(
        event.cell
          ? `contextmenu：格 (${event.cell.col},${event.cell.row})`
          : `contextmenu：(${event.x},${event.y}) 非数据格`,
      )
    })
    const offScroll = table.onScrollFrame((state) => {
      setScrollText(`scroll：(${Math.round(state.left)},${Math.round(state.top)})`)
    })
    return () => {
      offSelection()
      offMenu()
      offScroll()
    }
  }, [demo])

  function batchUpdate100(): void {
    const table = demo?.mount.table
    if (!table || !demo) return
    table.batchUpdate(() => {
      for (let row = 0; row < 100; row++) {
        const record = demo.records[row]
        if (record) {
          record['c1'] = `B-${row}`
          table.refreshCell(1, row)
        }
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-xl font-semibold tracking-tight">交互能力</h2>
          <Badge variant="secondary">框选/拖选</Badge>
          <Badge variant="secondary">整行/整列/全选</Badge>
          <Badge variant="secondary">键盘导航</Badge>
          <Badge variant="secondary">行列调整 Resize</Badge>
          <Badge variant="secondary">右键菜单</Badge>
          <Badge variant="secondary">批量更新</Badge>
        </div>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          完整合成事件与交互管线：鼠标拖选、点击行号选择整行、点击列头选择整列、左上角全选；Shift+方向键区域扩展；行列拖拽调节尺寸（第
          0 行/列由 canResize 规则锁定）；右键快捷菜单响应；以及批量更新（100 格）单帧收敛失效。
        </p>
      </div>

      <div ref={containerRef} className="demo-mount-area" />

      <div className="rounded-xl border bg-card px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={!demo} onClick={batchUpdate100}>
            批量更新 100 格
          </Button>
          <Button size="sm" disabled={!demo} onClick={() => demo?.mount.table.selectAll()}>
            全选
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!demo}
            onClick={() => demo?.mount.table.clearSelection()}
          >
            清空选区
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className={STATUS_ITEM_CLASS}>{selectionText}</span>
          <span className={STATUS_ITEM_CLASS}>{menuText}</span>
          <span className={STATUS_ITEM_CLASS}>{scrollText}</span>
        </div>
      </div>
    </div>
  )
}
