// 网格右键菜单（对标 ultra-ui sheet-context-menu 的三套形态，shadcn Popover 承载）：
// 行号右键（上/下方插入行·数量输入、删除行、行高·数值输入、冻结到当前行）；
// 列头右键（左/右侧插入列、删除列、列宽·数值输入、冻结到当前列）；
// 正文右键（合并/取消合并、设置数据格式子菜单、插入浮动图片、清空内容）。
// 事件源走 SheetGrid 公共 onContextMenu（区域分流/坐标换算由 grid 承担，React 层经
// demo.setContextMenuHandler 注册）；写路径全部为 @infinitable/sheet 模型命令
// （结构插删/合并/冻结/样式），视图刷新由模型事件联动（结构变更实例就地重建）。

import { flushSync } from 'react-dom'
import { type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useState } from 'react'

import { colLetters } from '@infinitable/formulas'
import type { SheetGridContextMenuInfo } from '@infinitable/sheet'

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import { demoImagePngBytes } from '../../../mount'
import type { NumFmt, SheetDemo } from '../../../sections/sheet'

/** 行列尺寸输入 clamp 域：下限对齐引擎最小行列尺寸（core resize MIN_COL_WIDTH/MIN_ROW_HEIGHT = 20，未公开导出；输入先钳到同域避免模型与引擎钳制发散），上限防呆 */
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

  /** 结构操作（模型命令；structure-change 后实例由 bundle 就地重建） */
  const structural = (mutate: () => void, done: string): void => {
    mutate()
    notify(done)
  }
  const insertRowsAt = (at: number, count: number): void => {
    structural(() => demo.getStore().insertRows(at, count), `已插入 ${count} 行`)
  }
  const insertColsAt = (at: number, count: number): void => {
    structural(() => demo.getStore().insertCols(at, count), `已插入 ${count} 列`)
  }
  const applyFrozen = (next: { cols?: number; rows?: number }): void => {
    const store = demo.getStore()
    const current = store.frozen
    const merged = { cols: next.cols ?? current.cols, rows: next.rows ?? current.rows }
    store.setFrozen(merged.rows, merged.cols)
    notify(`冻结 ${merged.rows} 行 × ${merged.cols} 列`)
  }
  /** 数据格式项的统一写路径：选区一次 setCellStyle（单命令；显示经引擎显示链格式化） */
  const applyNumFmtToBounds = (bounds: Bounds, fmt: NumFmt | undefined, label: string): void => {
    demo.getStore().setCellStyle(
      {
        start: { row: bounds.minRow, col: bounds.minCol },
        end: { row: bounds.maxRow, col: bounds.maxCol },
      },
      fmt ? { numFmt: fmt } : { numFmt: null },
    )
    notify(label)
  }
  /** 行列尺寸数值项写路径：模型覆盖 + 引擎即时同步（grid.applyAxisSizes） */
  const applyAxisSizes = (axis: 'row' | 'col', indexes: number[]): void => {
    const bundle = demo.getBundle()
    bundle.gridOf(bundle.activeName())?.applyAxisSizes(axis, indexes)
  }
  return {
    structural,
    insertRowsAt,
    insertColsAt,
    applyFrozen,
    applyNumFmtToBounds,
    applyAxisSizes,
  }
}

export function SheetContextMenu({ demo }: { demo: SheetDemo }) {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [submenu, setSubmenu] = useState<SubmenuState | null>(null)

  /** 引擎右键回调里同步上屏（自动化在派发 contextmenu 后立即断言菜单 DOM） */
  const setMenuSync = (next: MenuState): void => {
    flushSync(() => setMenu(next))
  }

  useEffect(() => {
    const boundsOf = (): Bounds | null => {
      const range = demo.table.getSelectedCellRanges()[0]
      if (!range) {
        return null
      }
      return {
        minCol: Math.min(range.start.col, range.end.col),
        maxCol: Math.max(range.start.col, range.end.col),
        minRow: Math.min(range.start.row, range.end.row),
        maxRow: Math.max(range.start.row, range.end.row),
      }
    }

    const openMenu = (info: SheetGridContextMenuInfo): void => {
      const table = demo.table
      const store = demo.getStore()

      if (info.kind === 'row-header' && info.row !== undefined) {
        const row = info.row
        // 落点在选区外：先选整行
        const bounds = boundsOf()
        if (!bounds || row < bounds.minRow || row > bounds.maxRow) {
          table.selectCells([{ start: { col: 0, row }, end: { col: store.cols - 1, row } }])
        }
        setMenuSync({ kind: 'row', x: info.x, y: info.y, row, target: boundsOf()! })
        return
      }

      if (info.kind === 'col-header' && info.col !== undefined) {
        const col = info.col
        const bounds = boundsOf()
        if (!bounds || col < bounds.minCol || col > bounds.maxCol) {
          table.selectCells([{ start: { col, row: 0 }, end: { col, row: store.rows - 1 } }])
        }
        setMenuSync({ kind: 'col', x: info.x, y: info.y, col, target: boundsOf()! })
        return
      }

      const hit = info.addr
      if (!hit) {
        // 角点/空白（addr null）：保留当前选区，不开菜单（同旧口径）
        return
      }
      const bounds = boundsOf()
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
        x: info.x,
        y: info.y,
        hit: { col: hit.col, row: hit.row },
        current: boundsOf()!,
      })
    }

    // 右键事件源：SheetGrid 公共 onContextMenu（随活跃实例由 bundle 转发，切换表同样生效）
    demo.setContextMenuHandler((_name, info) => openMenu(info))
    return () => {
      demo.setContextMenuHandler(null)
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
        onClick={() => ops.structural(() => store.deleteRows(row), `已删除行 ${row + 1}`)}
      />
      <MenuCount
        label="行高"
        max={SIZE_MAX}
        min={SIZE_MIN}
        onClose={onClose}
        onConfirm={(height) => {
          const rows = Array.from(
            { length: target.maxRow - target.minRow + 1 },
            (_, index) => target.minRow + index,
          )
          for (const r of rows) {
            store.setRowHeight(r, height)
          }
          ops.applyAxisSizes('row', rows)
          demo.notify(`已设置行高 ${height}px`)
        }}
        unit="px"
        value={store.getRowHeight(row) ?? 28}
      />
      <MenuSeparator />
      <MenuAction
        label={`${store.frozen.rows === row + 1 ? '✓ ' : ''}冻结到当前行`}
        onClick={() => ops.applyFrozen({ rows: row + 1 })}
      />
      <MenuAction
        disabled={store.frozen.rows === 0 && store.frozen.cols === 0}
        label="取消冻结"
        onClick={() => ops.applyFrozen({ rows: 0, cols: 0 })}
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
        onClick={() => ops.structural(() => store.deleteCols(col), `已删除列 ${colLetters(col)}`)}
      />
      <MenuCount
        label="列宽"
        max={SIZE_MAX}
        min={SIZE_MIN}
        onClose={onClose}
        onConfirm={(width) => {
          const cols = Array.from(
            { length: target.maxCol - target.minCol + 1 },
            (_, index) => target.minCol + index,
          )
          for (const c of cols) {
            store.setColWidth(c, width)
          }
          ops.applyAxisSizes('col', cols)
          demo.notify(`已设置列宽 ${width}px`)
        }}
        unit="px"
        value={store.getColWidth(col) ?? 80}
      />
      <MenuSeparator />
      <MenuAction
        label={`${store.frozen.cols === col + 1 ? '✓ ' : ''}冻结到当前列`}
        onClick={() => ops.applyFrozen({ cols: col + 1 })}
      />
      <MenuAction
        disabled={store.frozen.rows === 0 && store.frozen.cols === 0}
        label="取消冻结"
        onClick={() => ops.applyFrozen({ rows: 0, cols: 0 })}
      />
    </>
  )
}

/** 菜单项计数器（插入图片序号，模块级递增） */
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
  const store = demo.getStore()
  const { hit, current } = menu
  const inMerge = store.merges
    .getMerges()
    .some(
      (range) =>
        hit.col >= range.start.col &&
        hit.col <= range.end.col &&
        hit.row >= range.start.row &&
        hit.row <= range.end.row,
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
          store.mergeCells({
            start: { row: current.minRow, col: current.minCol },
            end: { row: current.maxRow, col: current.maxCol },
          })
          demo.notify('已合并选区')
        }}
      />
      <MenuAction
        disabled={!inMerge}
        label="取消合并单元格"
        onClick={() => {
          store.unmergeCells({
            start: { row: current.minRow, col: current.minCol },
            end: { row: current.maxRow, col: current.maxCol },
          })
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
          store.insertImage({
            data: demoImagePngBytes(`demo://sheet/insert-${seq}`),
            type: 'png',
            anchor: {
              from: { row: hit.row, col: hit.col, offsetX: 2, offsetY: 2 },
              to: { row: hit.row + 2, col: hit.col + 2 },
            },
            title: '插入图片',
          })
          demo.notify('已插入图片')
        }}
      />
      <MenuSeparator />
      <MenuAction
        label="清空内容"
        onClick={() => {
          const items: Array<{ addr: { row: number; col: number }; data: undefined }> = []
          for (let row = current.minRow; row <= current.maxRow; row++) {
            for (let col = current.minCol; col <= current.maxCol; col++) {
              items.push({ addr: { row, col }, data: undefined })
            }
          }
          store.setCells(items)
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
      <MenuAction label="日期" onClick={() => apply({ type: 'date' }, '已设置数据格式：日期')} />
      <MenuAction
        label="千分位金额"
        onClick={() => apply({ type: 'thousands' }, '已设置数据格式：千分位金额')}
      />
      <MenuAction
        label="大写金额"
        onClick={() => apply({ type: 'cnUpper' }, '已设置数据格式：大写金额')}
      />
      <MenuSeparator />
      {Array.from({ length: 11 }, (_, digits) => (
        <MenuAction
          key={digits}
          label={`小数位数 ${digits}`}
          onClick={() => apply({ type: 'fixed', digits }, `已设置数据格式：小数位数 ${digits}`)}
        />
      ))}
      <MenuSeparator />
      <MenuAction label="清除格式" onClick={() => apply(undefined, '已清除数据格式')} />
    </>
  )
}
