// 网格右键菜单（对标 ultra-ui sheet-context-menu 的三套形态，shadcn Popover 承载）：
// 行号右键（上/下方插入行·数量输入、删除行、行高·数值输入、冻结到当前行）；
// 列头右键（左/右侧插入列、删除列、列宽·数值输入、冻结到当前列）；
// 正文右键（合并/取消合并、设置数据格式子菜单、插入浮动图片、清空内容）。
// 落点在选区外时先选中该格/整行/整列；锚定与行为与命令式版一致（点外/Esc 关闭、数值项 Enter 确认）。

import { flushSync } from 'react-dom'
import { type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useState } from 'react'

import type { ListTable } from '@infinitable/core'

import { colLetters } from '@infinitable/formulas'

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import type { SheetDemo } from '../../../sections/sheet'
import type { NumFmt } from '../../../sections/sheet/format'
import {
  clearValues,
  deleteCol,
  deleteRow,
  insertCol,
  insertRow,
  mergeBounds,
  refreshAllGrid,
  syncMergesToTable,
  unmergeAt,
} from '../../../sections/sheet/ops'

/** 行列尺寸输入 clamp 域：下限对齐引擎最小行列尺寸（core resize MIN_COL_WIDTH/MIN_ROW_HEIGHT = 20，未公开导出；输入先钳到同域避免 Store 与引擎钳制发散），上限防呆 */
const SIZE_MIN = 20
const SIZE_MAX = 1000

interface Bounds {
  minCol: number
  maxCol: number
  minRow: number
  maxRow: number
}

type MenuState =
  | { kind: 'row'; x: number; y: number; row: number; target: Bounds }
  | { kind: 'col'; x: number; y: number; col: number; target: Bounds }
  | { kind: 'cell'; x: number; y: number; hit: { col: number; row: number }; current: Bounds }

/** 子菜单（设置数据格式）锚定：主菜单项右缘 */
interface SubmenuState {
  x: number
  y: number
  bounds: Bounds
}

/** 菜单操作集（结构操作/冻结/numFmt 写路径；三套菜单与子菜单共用） */
function menuOps(demo: SheetDemo) {
  const notify = demo.notify
  /** 结构操作封装（Store 平移 + 引擎合并区同步 + 全表刷新） */
  const structural = (mutate: () => void, done: string): void => {
    const table = demo.table
    const store = demo.getStore()
    mutate()
    syncMergesToTable(table, store, (error) => notify(`合并区同步被拒绝：${error.message}`, 'warn'))
    refreshAllGrid(table, store)
    notify(done)
  }
  const insertRowsAt = (at: number, count: number): void => {
    structural(() => {
      const store = demo.getStore()
      for (let index = 0; index < count; index++) {
        insertRow(store, at)
      }
    }, `已插入 ${count} 行`)
  }
  const insertColsAt = (at: number, count: number): void => {
    structural(() => {
      const store = demo.getStore()
      for (let index = 0; index < count; index++) {
        insertCol(store, at)
      }
    }, `已插入 ${count} 列`)
  }
  const applyFrozen = (next: { colCount?: number; rowCount?: number }): void => {
    const table = demo.table
    const store = demo.getStore()
    const current = store.getFrozen()
    const merged = { ...current, ...next }
    const previous = { ...current }
    store.setFrozen(merged)
    try {
      table.setFrozenColCount(merged.colCount)
      table.setFrozenRowCount(merged.rowCount)
      notify(`冻结 ${merged.rowCount} 行 × ${merged.colCount} 列`)
    } catch (error) {
      store.setFrozen(previous)
      table.setFrozenColCount(previous.colCount)
      table.setFrozenRowCount(previous.rowCount)
      notify(`已拒绝：${(error as Error).message}（冻结数保持原状）`, 'warn')
    }
  }
  /** 数据格式项的统一写路径：选区逐格写 numFmt 侧车 + 选区刷新（同 setStyle 模式） */
  const applyNumFmtToBounds = (bounds: Bounds, fmt: NumFmt | undefined, label: string): void => {
    const table = demo.table
    const setNumFmt = demo.getControls().numFmt.set
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        setNumFmt(col, row, fmt)
      }
    }
    table.batchUpdate(() => {
      for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
        for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
          table.refreshCell(col, row)
        }
      }
    })
    notify(label)
  }
  return { structural, insertRowsAt, insertColsAt, applyFrozen, applyNumFmtToBounds }
}

export function SheetContextMenu({ demo }: { demo: SheetDemo }) {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [submenu, setSubmenu] = useState<SubmenuState | null>(null)

  /** 引擎右键回调里同步上屏（自动化在派发 contextmenu 后立即断言菜单 DOM） */
  const setMenuSync = (next: MenuState): void => {
    flushSync(() => setMenu(next))
  }

  useEffect(() => {
    const openMenu = (event: ContextMenuEvent): void => {
      const table = demo.table
      const store = demo.getStore()
      const hit = event.cell
      // 命中分区：y 在列头带 → 列头菜单；x 在行号带 → 行号菜单；正文格 → 正文菜单
      const onColHeader = event.y < table.headerHeight && event.x >= table.rowHeaderWidth
      const onRowHeader = event.x < table.rowHeaderWidth && event.y >= table.headerHeight

      const colAtX = (x: number): number => {
        let local = x - table.rowHeaderWidth + table.getScrollLeft()
        for (let col = 0; col < store.getColCount(); col++) {
          local -= table.getColWidth(col)
          if (local < 0) {
            return col
          }
        }
        return store.getColCount() - 1
      }
      const rowAtY = (y: number): number => {
        let local = y - table.headerHeight + table.getScrollTop()
        for (let row = 0; row < store.getRowCount(); row++) {
          local -= table.getRowHeight(row)
          if (local < 0) {
            return row
          }
        }
        return store.getRowCount() - 1
      }

      const original = event.originalEvent
      const clientX = original instanceof MouseEvent ? original.clientX : event.x
      const clientY = original instanceof MouseEvent ? original.clientY : event.y

      if (onRowHeader) {
        const row = rowAtY(event.y)
        // 落点在选区外：先选整行
        const bounds = boundsOf(table)
        if (!bounds || row < bounds.minRow || row > bounds.maxRow) {
          table.selectCells([
            { start: { col: 0, row }, end: { col: store.getColCount() - 1, row } },
          ])
        }
        setMenuSync({ kind: 'row', x: clientX, y: clientY, row, target: boundsOf(table)! })
        return
      }

      if (onColHeader) {
        const col = colAtX(event.x)
        const bounds = boundsOf(table)
        if (!bounds || col < bounds.minCol || col > bounds.maxCol) {
          table.selectCells([
            { start: { col, row: 0 }, end: { col, row: store.getRowCount() - 1 } },
          ])
        }
        setMenuSync({ kind: 'col', x: clientX, y: clientY, col, target: boundsOf(table)! })
        return
      }

      if (!hit) {
        return
      }
      const bounds = boundsOf(table)
      if (
        !bounds ||
        hit.col < bounds.minCol ||
        hit.col > bounds.maxCol ||
        hit.row < bounds.minRow ||
        hit.row > bounds.maxRow
      ) {
        table.selectCell(hit.col, hit.row)
      }
      setMenuSync({
        kind: 'cell',
        x: clientX,
        y: clientY,
        hit: { col: hit.col, row: hit.row },
        current: boundsOf(table)!,
      })
    }

    // 右键监听随活跃实例切换重挂（切表后新实例同样弹菜单）
    let off: (() => void) | null = null
    const bind = (table: ListTable): void => {
      off?.()
      off = table.onContextMenu(openMenu)
    }
    bind(demo.table)
    const offBookChange = demo.getSheet().onSheetChange((event) => {
      if (event.table) {
        bind(event.table)
      }
    })
    return () => {
      offBookChange()
      off?.()
    }
  }, [demo])

  const ops = menuOps(demo)

  return (
    <>
      {menu && (
        <AnchoredPopover onClose={() => setMenu(null)} x={menu.x} y={menu.y}>
          {menu.kind === 'row' && (
            <RowMenuItems menu={menu} onClose={() => setMenu(null)} ops={ops} demo={demo} />
          )}
          {menu.kind === 'col' && (
            <ColMenuItems menu={menu} onClose={() => setMenu(null)} ops={ops} demo={demo} />
          )}
          {menu.kind === 'cell' && (
            <CellMenuItems
              demo={demo}
              menu={menu}
              onOpenSubmenu={(next) => {
                // 子菜单替换主菜单（对齐命令式版弹层单例语义）；程序化点击后需同步上屏
                flushSync(() => {
                  setSubmenu(next)
                  setMenu(null)
                })
              }}
            />
          )}
        </AnchoredPopover>
      )}
      {submenu && (
        <AnchoredPopover onClose={() => setSubmenu(null)} x={submenu.x} y={submenu.y}>
          <NumFmtItems bounds={submenu.bounds} onClose={() => setSubmenu(null)} ops={ops} />
        </AnchoredPopover>
      )}
    </>
  )
}

function boundsOf(table: ListTable): Bounds | null {
  const range = table.getSelectedCellRanges()[0]
  return range
    ? {
        minCol: Math.min(range.start.col, range.end.col),
        maxCol: Math.max(range.start.col, range.end.col),
        minRow: Math.min(range.start.row, range.end.row),
        maxRow: Math.max(range.start.row, range.end.row),
      }
    : null
}

/** 以视口坐标锚定的菜单弹层（右键落点为面板左上角，radix 碰撞检测负责越界夹取） */
function AnchoredPopover({
  x,
  y,
  onClose,
  children,
}: {
  x: number
  y: number
  onClose: () => void
  children: ReactNode
}): ReactNode {
  return (
    <Popover onOpenChange={(open) => !open && onClose()} open>
      <PopoverAnchor asChild>
        <span aria-hidden="true" className="fixed size-0" style={{ left: x, top: y }} />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-52 p-1"
        onContextMenu={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        side="bottom"
        sideOffset={0}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

// ---- 菜单项 ----

function MenuAction({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
}): ReactNode {
  return (
    <button
      className={cn(
        'sheet-menu__item block w-full cursor-pointer rounded-sm px-2.5 py-1 text-left text-xs',
        disabled ? 'pointer-events-none text-muted-foreground/60' : 'hover:bg-accent',
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  )
}

function MenuSeparator(): ReactNode {
  return <div className="sheet-menu__separator my-1 border-t" />
}

/** 数量输入项：「在上方插入 [3] 行」——Enter 确认执行（keepOpen，不点外不关） */
function MenuCount({
  label,
  unit,
  value,
  min = 1,
  max = 100,
  onConfirm,
  onClose,
}: {
  label: string
  unit: string
  value?: number
  min?: number
  max?: number
  onConfirm: (value: number) => void
  onClose: () => void
}): ReactNode {
  const initial = value ?? 1
  return (
    <div
      className="sheet-menu__count flex cursor-pointer items-center gap-1.5 px-2.5 py-1 text-xs"
      onClick={(event) => {
        if (event.target instanceof HTMLInputElement) {
          return
        }
        const input = event.currentTarget.querySelector('input')
        input?.focus()
        input?.select()
      }}
    >
      <span>{label}</span>
      <input
        className="sheet-menu__count-input h-5 w-11 rounded-sm border border-border bg-background px-1 text-right text-xs outline-none focus:border-primary"
        defaultValue={String(initial)}
        max={max}
        min={min}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') {
            const next = Math.max(
              min,
              Math.min(max, Math.floor(Number(event.currentTarget.value) || initial)),
            )
            onClose()
            onConfirm(next)
          } else if (event.key === 'Escape') {
            onClose()
          }
        }}
        step="1"
        type="number"
      />
      <span className="text-muted-foreground">{unit}</span>
    </div>
  )
}

type MenuOps = ReturnType<typeof menuOps>

// ---- 三套菜单内容 ----

function RowMenuItems({
  demo,
  menu,
  onClose,
  ops,
}: {
  demo: SheetDemo
  menu: Extract<MenuState, { kind: 'row' }>
  onClose: () => void
  ops: MenuOps
}): ReactNode {
  const store = demo.getStore()
  const table = demo.table
  const { row, target } = menu
  return (
    <>
      <MenuCount
        label="在上方插入"
        onClose={onClose}
        onConfirm={(count) => ops.insertRowsAt(row, count)}
        unit="行"
      />
      <MenuCount
        label="在下方插入"
        onClose={onClose}
        onConfirm={(count) => ops.insertRowsAt(row + 1, count)}
        unit="行"
      />
      <MenuAction
        label={`删除行 ${row + 1}`}
        onClick={() => ops.structural(() => deleteRow(store, row), `已删除行 ${row + 1}`)}
      />
      <MenuCount
        label="行高"
        max={SIZE_MAX}
        min={SIZE_MIN}
        onClose={onClose}
        onConfirm={(height) => {
          for (let r = target.minRow; r <= target.maxRow; r++) {
            store.setRowHeight(r, height)
            table.setRowHeight(r, height)
          }
          demo.notify(`已设置行高 ${height}px`)
        }}
        unit="px"
        value={store.getRowHeight(row)}
      />
      <MenuSeparator />
      <MenuAction
        label={`${store.getFrozen().rowCount === row + 1 ? '✓ ' : ''}冻结到当前行`}
        onClick={() => ops.applyFrozen({ rowCount: row + 1 })}
      />
      <MenuAction
        disabled={store.getFrozen().rowCount === 0 && store.getFrozen().colCount === 0}
        label="取消冻结"
        onClick={() => ops.applyFrozen({ rowCount: 0, colCount: 0 })}
      />
    </>
  )
}

function ColMenuItems({
  demo,
  menu,
  onClose,
  ops,
}: {
  demo: SheetDemo
  menu: Extract<MenuState, { kind: 'col' }>
  onClose: () => void
  ops: MenuOps
}): ReactNode {
  const store = demo.getStore()
  const table = demo.table
  const { col, target } = menu
  return (
    <>
      <MenuCount
        label="在左侧插入"
        onClose={onClose}
        onConfirm={(count) => ops.insertColsAt(col, count)}
        unit="列"
      />
      <MenuCount
        label="在右侧插入"
        onClose={onClose}
        onConfirm={(count) => ops.insertColsAt(col + 1, count)}
        unit="列"
      />
      <MenuAction
        label={`删除列 ${colLetters(col)}`}
        onClick={() => ops.structural(() => deleteCol(store, col), `已删除列 ${colLetters(col)}`)}
      />
      <MenuCount
        label="列宽"
        max={SIZE_MAX}
        min={SIZE_MIN}
        onClose={onClose}
        onConfirm={(width) => {
          for (let c = target.minCol; c <= target.maxCol; c++) {
            store.setColWidth(c, width)
            table.setColWidth(c, width)
          }
          demo.notify(`已设置列宽 ${width}px`)
        }}
        unit="px"
        value={store.getColWidth(col)}
      />
      <MenuSeparator />
      <MenuAction
        label={`${store.getFrozen().colCount === col + 1 ? '✓ ' : ''}冻结到当前列`}
        onClick={() => ops.applyFrozen({ colCount: col + 1 })}
      />
      <MenuAction
        disabled={store.getFrozen().rowCount === 0 && store.getFrozen().colCount === 0}
        label="取消冻结"
        onClick={() => ops.applyFrozen({ rowCount: 0, colCount: 0 })}
      />
    </>
  )
}

/** 菜单项计数器（插入图片 id 序号，模块级递增） */
let insertImageSeq = 0

function CellMenuItems({
  demo,
  menu,
  onOpenSubmenu,
}: {
  demo: SheetDemo
  menu: Extract<MenuState, { kind: 'cell' }>
  onOpenSubmenu: (submenu: SubmenuState) => void
}): ReactNode {
  const table = demo.table
  const store = demo.getStore()
  const { hit, current } = menu
  const inMerge = store
    .getMerges()
    .some(
      (range) =>
        hit.col >= range.startCol &&
        hit.col <= range.endCol &&
        hit.row >= range.startRow &&
        hit.row <= range.endRow,
    )
  const single = current.minCol === current.maxCol && current.minRow === current.maxRow
  insertImageSeq += 1
  const seq = insertImageSeq

  return (
    <>
      <MenuAction
        disabled={single}
        label="合并单元格"
        onClick={() => {
          try {
            table.setMergeCells([...store.getMerges(), mergeBounds(current)])
            store.setMerges([...store.getMerges(), mergeBounds(current)])
            demo.notify('已合并选区')
          } catch (error) {
            demo.notify(`已拒绝：${(error as Error).message}`, 'warn')
          }
        }}
      />
      <MenuAction
        disabled={!inMerge}
        label="取消合并单元格"
        onClick={() => {
          const kept = unmergeAt(store, current)
          table.setMergeCells([...kept])
          demo.notify('已取消合并')
        }}
      />
      <MenuSeparator />
      <MenuAction
        label="设置数据格式 ▸"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          onOpenSubmenu({ x: rect.right + 2, y: rect.top, bounds: current })
        }}
      />
      <MenuSeparator />
      <MenuAction
        label="插入图片"
        onClick={() => {
          table.floatObjects.add({
            id: `sheet-menu-img-${seq}`,
            kind: 'image',
            anchor: {
              from: { col: hit.col, row: hit.row },
              to: { col: hit.col + 2, row: hit.row + 2 },
              offsetX: 2,
              offsetY: 2,
            },
            src: `demo://sheet/insert-${seq}`,
            title: '插入图片',
          })
          demo.notify('已插入图片')
        }}
      />
      <MenuSeparator />
      <MenuAction
        label="清空内容"
        onClick={() => {
          clearValues(store, current, demo.getSheet())
          refreshAllGrid(table, store)
          demo.notify('已清空选区内容')
        }}
      />
    </>
  )
}

/** 「设置数据格式」子菜单：日期 / 千分位金额 / 大写金额 / 小数位数 0–10 / 清除格式 */
function NumFmtItems({
  bounds,
  onClose,
  ops,
}: {
  bounds: Bounds
  onClose: () => void
  ops: MenuOps
}): ReactNode {
  /** 应用即关子菜单（对齐命令式版：apply 后 close） */
  const apply = (fmt: NumFmt | undefined, label: string): void => {
    ops.applyNumFmtToBounds(bounds, fmt, label)
    onClose()
  }
  return (
    <>
      <MenuAction label="日期" onClick={() => apply({ kind: 'date' }, '已设置数据格式：日期')} />
      <MenuAction
        label="千分位金额"
        onClick={() => apply({ kind: 'thousands' }, '已设置数据格式：千分位金额')}
      />
      <MenuAction
        label="大写金额"
        onClick={() => apply({ kind: 'cnUpper' }, '已设置数据格式：大写金额')}
      />
      <MenuSeparator />
      {Array.from({ length: 11 }, (_, digits) => (
        <MenuAction
          key={digits}
          label={`小数位数 ${digits}`}
          onClick={() => apply({ kind: 'fixed', digits }, `已设置数据格式：小数位数 ${digits}`)}
        />
      ))}
      <MenuSeparator />
      <MenuAction label="清除格式" onClick={() => apply(undefined, '已清除数据格式')} />
    </>
  )
}

/** 引擎右键事件形态（core ListTable#onContextMenu 回调参数面） */
type ContextMenuEvent = Parameters<Parameters<ListTable['onContextMenu']>[0]>[0]
