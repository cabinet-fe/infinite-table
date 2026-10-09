// 样式工具栏（对标 ultra-ui sheet-toolbar）：shadcn Button/Tooltip/Separator 图标分组 + Popover 弹层。
// 组序：历史（撤销/重做）| 单元格（边框/填充色/合并/拆分）| 文本（粗斜下删/字色/字号/六向对齐/换行）
//      | 编辑（查找/函数）| 插入（图片）| 文件（导入/导出）。
// 操作语义走 toolbar-actions.ts（Store 格级样式 + batchUpdate 收敛刷新）。

import {
  ALargeSmall,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartVertical,
  Baseline,
  Bold,
  ChevronLeft,
  ChevronRight,
  Combine,
  FileDown,
  FileUp,
  Frame,
  Image as ImageIcon,
  Italic,
  PaintBucket,
  Redo2,
  Search,
  Split,
  SquareFunction,
  Strikethrough,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  TextWrap,
  Underline,
  Undo2,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useReducer, useRef, useState } from 'react'

import type { ListTable } from '@infinitable/core'

import { listFormulaFunctions, type FormulaFunctionInfo } from '@infinitable/formulas'

import type { BorderPreset } from '@infinitable/sheet'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import type { SheetDemo } from '../../../sections/sheet'
import { createFindReplace, type FindReplaceController } from '../../../sections/sheet/find-replace'
import {
  FONT_SIZES,
  LINE_STYLES,
  PALETTE,
  borderEdgeOf,
  createToolbarActions,
  dataUrlToImage,
  fileToDataURL,
  type ToolbarActions,
} from './toolbar-actions'
import { FORMULA_PANEL_CATEGORIES } from './formula-session'
import type { SheetUiBridge } from './ui-bridge'

interface SheetToolbarProps {
  demo: SheetDemo
  ui: SheetUiBridge
}

export function SheetToolbar({ demo, ui }: SheetToolbarProps) {
  const [, refreshRender] = useReducer((count: number) => count + 1, 0)
  const actionsRef = useRef<ToolbarActions | null>(null)
  const findRef = useRef<FindReplaceController | null>(null)
  const [fontColorBar, setFontColorBar] = useState('#ed1c24')
  const [findOpen, setFindOpen] = useState(false)

  useEffect(() => {
    const refresh = (): void => {
      refreshRender()
    }
    const bundle = demo.getBundle()
    const notify = demo.notify
    const actions = createToolbarActions({
      table: () => demo.table,
      store: () => demo.getStore(),
      notify,
      refreshStates: refresh,
    })
    const find = createFindReplace({
      table: () => demo.table,
      sheet: () => demo.getStore(),
      notify,
      onUpdate: refresh,
    })
    actionsRef.current = actions
    findRef.current = find
    demo.registerUi({
      toolbar: {
        applyFragment: (fragment, mode) => actions.applyFragment(fragment, mode),
        clearFormat: () => actions.clearFormat(),
        refreshStates: refresh,
      },
      find,
    })
    ui.toggleFind = () => setFindOpen((open) => !open)
    ui.refreshToolbar = refresh

    // 按钮态订阅：随活跃实例切换重挂（选区/值变化刷新样式激活态）
    let bindings: Array<() => void> = []
    let boundTable: ListTable | null = null
    const bindTo = (table: ListTable): void => {
      if (table === boundTable) {
        return
      }
      for (const off of bindings.splice(0)) {
        off()
      }
      bindings.push(table.onSelectionChange(refresh), table.onCellChange(refresh))
      boundTable = table
    }
    bindTo(demo.table)
    const offBookChange = bundle.onBookChange(() => {
      bindTo(demo.table)
    })

    // 装配完成后刷一帧（首渲染时动作集尚未就位，空闲页也要立即呈现按钮行）
    refresh()

    return () => {
      offBookChange()
      for (const off of bindings.splice(0)) {
        off()
      }
      // 与 FormulaBar/SheetInspector 一致：卸载时把桥上入口复位 noop
      ui.toggleFind = () => {}
      ui.refreshToolbar = () => {}
    }
  }, [demo, ui])

  const actions = actionsRef.current
  const find = findRef.current

  // 动作集在挂载效应里装配；首帧（装配完成前）不渲染按钮行
  if (!actions || !find) {
    return null
  }

  const sheet = demo.getStore()
  const style = actions.focusCellStyle()
  const active = (on: boolean): string | undefined => (on ? 'bg-accent text-primary' : undefined)

  return (
    <div className="border-b border-border/70">
      <div
        className="flex items-center gap-1 overflow-x-auto px-1.5 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        ref={(node) => {
          // 滚轮转横滚（溢出时；滚动条隐藏）：首帧 actions 未就绪不渲染本节点，挂接须等节点实际挂载（ref callback）
          if (!node) {
            return
          }
          const onWheel = (event: WheelEvent): void => {
            if (event.deltaY !== 0 && node.scrollWidth > node.clientWidth) {
              event.preventDefault()
              node.scrollLeft += event.deltaY
            }
          }
          node.addEventListener('wheel', onWheel, { passive: false })
          return () => {
            node.removeEventListener('wheel', onWheel)
          }
        }}
      >
        {/* 历史 */}
        <ToolButton
          disabled={!sheet.canUndo}
          label="撤销（Ctrl/Cmd+Z）"
          onClick={() => {
            sheet.undo()
            demo.notify('已撤销')
            refreshRender()
          }}
        >
          <Undo2 />
        </ToolButton>
        <ToolButton
          disabled={!sheet.canRedo}
          label="重做（Ctrl/Cmd+Shift+Z 或 Ctrl+Y）"
          onClick={() => {
            sheet.redo()
            demo.notify('已重做')
            refreshRender()
          }}
        >
          <Redo2 />
        </ToolButton>

        {/* 单元格 */}
        <GroupDivider />
        <ToolPopover
          icon={<Frame />}
          label="设置单元格边框"
          panel={(close) => <BorderPanel actions={actions} close={close} />}
        />
        <ToolPopover
          icon={<PaintBucket />}
          label="设置单元格背景填充"
          panel={(close) => (
            <FillColorPanel actions={actions} close={close} focusStyle={style?.fill?.color} />
          )}
        />
        <ToolButton label="合并选中区域" onClick={() => actions.mergeSelection()}>
          <Combine />
        </ToolButton>
        <ToolButton label="取消活动格所在合并" onClick={() => actions.unmergeSelection()}>
          <Split />
        </ToolButton>

        {/* 文本 */}
        <GroupDivider />
        <ToolButton
          active={style?.font?.bold === true}
          label="加粗"
          onClick={() => actions.applyFragment({ font: { bold: true } }, 'toggle')}
        >
          <Bold />
        </ToolButton>
        <ToolButton
          active={style?.font?.italic === true}
          label="斜体"
          onClick={() => actions.applyFragment({ font: { italic: true } }, 'toggle')}
        >
          <Italic />
        </ToolButton>
        <ToolButton
          active={style?.font?.underline === true}
          label="下划线"
          onClick={() => actions.applyFragment({ font: { underline: true } }, 'toggle')}
        >
          <Underline />
        </ToolButton>
        <ToolButton
          active={style?.font?.strikethrough === true}
          label="删除线"
          onClick={() => actions.applyFragment({ font: { strikethrough: true } }, 'toggle')}
        >
          <Strikethrough />
        </ToolButton>
        <ToolPopover
          colorBar={fontColorBar}
          icon={<Baseline />}
          label="设置字体颜色"
          panel={(close) => (
            <FontColorPanel
              actions={actions}
              close={close}
              focusColor={style?.font?.color}
              onPicked={setFontColorBar}
            />
          )}
        />
        <ToolPopover
          icon={<ALargeSmall />}
          label="设置字体大小"
          panel={(close) => (
            <FontSizePanel actions={actions} close={close} focusSize={style?.font?.size} />
          )}
        />
        <ToolButton
          className={active((style?.align?.horizontal ?? 'left') === 'left')}
          label="水平左对齐"
          onClick={() => actions.applyFragment({ align: { horizontal: 'left' } }, 'set')}
        >
          <TextAlignStart />
        </ToolButton>
        <ToolButton
          className={active((style?.align?.horizontal ?? 'left') === 'center')}
          label="水平居中"
          onClick={() => actions.applyFragment({ align: { horizontal: 'center' } }, 'set')}
        >
          <TextAlignCenter />
        </ToolButton>
        <ToolButton
          className={active((style?.align?.horizontal ?? 'left') === 'right')}
          label="水平右对齐"
          onClick={() => actions.applyFragment({ align: { horizontal: 'right' } }, 'set')}
        >
          <TextAlignEnd />
        </ToolButton>
        <ToolButton
          className={active((style?.align?.vertical ?? 'middle') === 'top')}
          label="垂直顶端对齐"
          onClick={() => actions.applyFragment({ align: { vertical: 'top' } }, 'set')}
        >
          <AlignStartVertical />
        </ToolButton>
        <ToolButton
          className={active((style?.align?.vertical ?? 'middle') === 'middle')}
          label="垂直居中对齐"
          onClick={() => actions.applyFragment({ align: { vertical: 'middle' } }, 'set')}
        >
          <AlignCenterVertical />
        </ToolButton>
        <ToolButton
          className={active((style?.align?.vertical ?? 'middle') === 'bottom')}
          label="垂直底端对齐"
          onClick={() => actions.applyFragment({ align: { vertical: 'bottom' } }, 'set')}
        >
          <AlignEndVertical />
        </ToolButton>
        <ToolButton
          active={style?.align?.wrap === true}
          label="自动换行"
          onClick={() => actions.applyFragment({ align: { wrap: true } }, 'toggle')}
        >
          <TextWrap />
        </ToolButton>

        {/* 编辑 */}
        <GroupDivider />
        <Popover
          onOpenChange={(open) => {
            if (open) {
              find.reset()
            }
            setFindOpen(open)
          }}
          open={findOpen}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <ToolButtonInner label="查找与替换（Ctrl/Cmd+F）">
                  <Search />
                </ToolButtonInner>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">查找与替换（Ctrl/Cmd+F）</TooltipContent>
          </Tooltip>
          <PopoverContent align="start" className="w-80 p-3">
            <FindReplacePanel demo={demo} find={find} onClose={() => setFindOpen(false)} />
          </PopoverContent>
        </Popover>
        <ToolPopover
          icon={<SquareFunction />}
          label="按分类浏览并插入函数"
          panel={(close) => <FunctionsPanel close={close} ui={ui} />}
        />

        {/* 插入 */}
        <GroupDivider />
        <ToolPopover
          icon={<ImageIcon />}
          label="插入浮动图片"
          panel={(close) => (
            <InsertImagePanel actions={actions} close={close} notify={demo.notify} />
          )}
        />

        {/* 文件 */}
        <GroupDivider />
        <ToolButton
          label="从 .xlsx / .csv 文件导入"
          onClick={() => demo.getControls().csv.openPicker()}
        >
          <FileUp />
        </ToolButton>
        <ToolPopover
          icon={<FileDown />}
          label="导出为 Excel 或 CSV"
          panel={(close) => <ExportPanel close={close} demo={demo} />}
        />
      </div>
    </div>
  )
}

// ---- 工具按钮与弹层外壳 ----

function GroupDivider(): ReactNode {
  return <Separator className="mx-0.5 self-stretch" orientation="vertical" />
}

function ToolButtonInner({
  label,
  children,
  onClick,
  active,
  disabled,
  colorBar,
  className,
}: {
  label: string
  children: ReactNode
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  colorBar?: string
  className?: string
}): ReactNode {
  return (
    <Button
      aria-label={label}
      className={cn(
        'relative size-7 shrink-0 [&_svg]:size-4',
        active && 'bg-accent text-primary',
        className,
      )}
      disabled={disabled}
      onClick={onClick}
      size="icon-xs"
      title={label}
      variant="ghost"
    >
      {children}
      {colorBar && (
        <span
          className="absolute right-1 bottom-0.5 left-1 h-[3px] rounded-[1px]"
          style={{ background: colorBar }}
        />
      )}
    </Button>
  )
}

function ToolButton(props: Parameters<typeof ToolButtonInner>[0]): ReactNode {
  const { label } = props
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToolButtonInner {...props} />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/** 带弹层的工具按钮：panel 为弹层内容渲染函数（收 close 用于选完即关） */
function ToolPopover({
  label,
  icon,
  panel,
  colorBar,
}: {
  label: string
  icon: ReactNode
  panel: (close: () => void) => ReactNode
  colorBar?: string
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <ToolButtonInner colorBar={colorBar} label={label}>
              {icon}
            </ToolButtonInner>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        className="w-auto p-2"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {panel(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  )
}

// ---- 弹层面板 ----

/** 色板（7 列 × 5 行；activeColor 命中描边） */
function PaletteGrid({
  onPick,
  activeColor,
  compact,
}: {
  onPick: (color: string) => void
  activeColor?: string | null
  compact?: boolean
}): ReactNode {
  return (
    <div className={cn('grid gap-1', compact ? 'grid-cols-10' : 'grid-cols-7')}>
      {PALETTE.map((color) => (
        <button
          aria-label={color}
          className={cn(
            'cursor-pointer rounded-[3px] border border-border/80',
            compact ? 'size-4' : 'size-5',
            activeColor === color && 'ring-2 ring-primary ring-offset-1',
          )}
          key={color}
          onClick={() => onPick(color)}
          style={{ background: color }}
          title={color}
          type="button"
        />
      ))}
    </div>
  )
}

function FillColorPanel({
  actions,
  close,
  focusStyle,
}: {
  actions: ToolbarActions
  close: () => void
  focusStyle: string | undefined
}): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <PaletteGrid
        activeColor={focusStyle ?? null}
        onPick={(color) => {
          actions.applyFragment({ fill: { color } }, 'set')
          close()
        }}
      />
      <Button
        className="h-6 w-full text-xs"
        onClick={() => {
          actions.applyRemoveKeys('fill')
          close()
        }}
        size="xs"
        variant="outline"
      >
        无填充
      </Button>
    </div>
  )
}

function FontColorPanel({
  actions,
  close,
  focusColor,
  onPicked,
}: {
  actions: ToolbarActions
  close: () => void
  focusColor: string | undefined
  onPicked: (color: string) => void
}): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <PaletteGrid
        activeColor={focusColor ?? null}
        onPick={(color) => {
          actions.applyFragment({ font: { color } }, 'set')
          onPicked(color)
          close()
        }}
      />
      <Button
        className="h-6 w-full text-xs"
        onClick={() => {
          actions.applyRemoveKeys('color')
          close()
        }}
        size="xs"
        variant="outline"
      >
        自动
      </Button>
    </div>
  )
}

function FontSizePanel({
  actions,
  close,
  focusSize,
}: {
  actions: ToolbarActions
  close: () => void
  focusSize: number | undefined
}): ReactNode {
  return (
    <div className="grid grid-cols-4 gap-1">
      {FONT_SIZES.map((size) => (
        <button
          className={cn(
            'h-6 w-10 cursor-pointer rounded-sm text-xs',
            focusSize === size ? 'bg-accent text-primary' : 'hover:bg-accent',
          )}
          key={size}
          onClick={() => {
            actions.applyFragment({ font: { size } }, 'set')
            close()
          }}
          type="button"
        >
          {size}
        </button>
      ))}
    </div>
  )
}

/** 边框弹层：线型 + 颜色 + 预设（8 预设语义对齐 ultra-ui） */
function BorderPanel({
  actions,
  close,
}: {
  actions: ToolbarActions
  close: () => void
}): ReactNode {
  const [lineId, setLineId] = useState<BorderLineStyleId>('thin')
  const [color, setColor] = useState('#000000')

  /** 线型 + 颜色 → 边定义（borderEdgeOf 组装模型边），渲染线型按钮的预览色条 */
  const swatchBorder = (id: BorderLineStyleId, swatchColor: string): string => {
    const edge = borderEdgeOf(id, swatchColor)
    // CSS border 只认 solid/dashed/dotted；模型 thin/medium/thick 均为实线分级
    const css = edge.style === 'dashed' || edge.style === 'dotted' ? edge.style : 'solid'
    return `${edge.width}px ${css} ${edge.color}`
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className="w-8 shrink-0 text-xs text-muted-foreground">线型</span>
        <div className="flex gap-1">
          {LINE_STYLES.map((item) => (
            <button
              aria-label={item.label}
              className={cn(
                'flex h-7 w-9 cursor-pointer items-center justify-center rounded-sm border',
                item.id === lineId ? 'border-primary' : 'border-border',
              )}
              key={item.id}
              onClick={() => setLineId(item.id)}
              title={item.label}
              type="button"
            >
              <span
                className="w-6 border-b-2 border-t-0 border-r-0 border-l-0"
                style={{ borderBottom: swatchBorder(item.id, color) }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-start gap-2">
        <span className="w-8 shrink-0 text-xs text-muted-foreground">颜色</span>
        <PaletteGrid compact onPick={setColor} />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-8 shrink-0 text-xs text-muted-foreground">预设</span>
        <div className="grid grid-cols-8 gap-1">
          {BORDER_PRESETS.map(([preset, title]) => (
            <button
              aria-label={title}
              className="flex size-7 cursor-pointer items-center justify-center rounded-sm border border-border text-primary hover:bg-accent"
              key={preset}
              onClick={() => {
                actions.applyBorderPreset(preset, borderEdgeOf(lineId, color))
                close()
              }}
              title={title}
              type="button"
            >
              <BorderGlyph preset={preset} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

type BorderLineStyleId = (typeof LINE_STYLES)[number]['id']

/** 边框预设按钮图标（16×16 线框字形；对齐 ultra-ui 形态） */
function BorderGlyph({ preset }: { preset: BorderPreset }): ReactNode {
  const on = 'currentColor'
  const off = '#d4d4d8'
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="square"
      strokeWidth="1.5"
      viewBox="0 0 16 16"
      width="16"
    >
      <rect height="12" rx="1" stroke={off} width="12" x="2" y="2" />
      {preset === 'outer' || preset === 'all' ? (
        <rect height="12" rx="1" stroke={on} width="12" x="2" y="2" />
      ) : null}
      {(preset === 'inner' || preset === 'all') && (
        <>
          <path d="M8 2v12" stroke={on} />
          <path d="M2 8h12" stroke={on} />
        </>
      )}
      {preset === 'top' && <path d="M2 8h12" stroke={on} />}
      {preset === 'bottom' && <path d="M2 14h12" stroke={on} />}
      {preset === 'left' && <path d="M8 2v12" stroke={on} />}
      {preset === 'right' && <path d="M14 2v12" stroke={on} />}
    </svg>
  )
}

const BORDER_PRESETS: ReadonlyArray<readonly [BorderPreset, string]> = [
  ['outer', '外边框'],
  ['inner', '内边框'],
  ['all', '所有边框'],
  ['top', '上边框'],
  ['bottom', '下边框'],
  ['left', '左边框'],
  ['right', '右边框'],
  ['none', '无边框'],
]

/** 函数面板（工具栏版：分类 + 搜索 + 列表；插入落点为公式栏输入区） */
function FunctionsPanel({ close, ui }: { close: () => void; ui: SheetUiBridge }): ReactNode {
  const [category, setCategory] = useState(FORMULA_PANEL_CATEGORIES[0]!)
  const [keyword, setKeyword] = useState('')
  const items = useMemo(() => {
    const lower = keyword.trim().toLowerCase()
    return listFormulaFunctions().filter((info) => {
      if (category !== '全部' && info.category !== category) {
        return false
      }
      if (lower && !`${info.name} ${info.description}`.toLowerCase().includes(lower)) {
        return false
      }
      return true
    })
  }, [category, keyword])
  return (
    <div className="flex h-72 w-[320px] flex-col">
      <div className="flex gap-1 overflow-x-auto border-b p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FORMULA_PANEL_CATEGORIES.map((name) => (
          <button
            className={cn(
              'shrink-0 cursor-pointer rounded-sm px-2 py-1 text-xs whitespace-nowrap',
              name === category ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
            )}
            key={name}
            onClick={() => setCategory(name)}
            type="button"
          >
            {name}
          </button>
        ))}
      </div>
      <Input
        className="m-1 h-6 text-xs"
        onChange={(event) => setKeyword(event.target.value)}
        placeholder="搜索函数名或描述"
        type="text"
        value={keyword}
      />
      <div className="min-h-0 flex-1 overflow-auto p-1">
        {items.map((info) => (
          <FunctionRow
            info={info}
            key={info.name}
            onInsert={() => {
              ui.insertFormulaSnippet(info.name)
              close()
            }}
          />
        ))}
        {items.length === 0 && (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">无匹配函数</div>
        )}
      </div>
    </div>
  )
}

function FunctionRow({
  info,
  onInsert,
}: {
  info: FormulaFunctionInfo
  onInsert: () => void
}): ReactNode {
  return (
    <button
      className="block w-full cursor-pointer rounded-sm px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
      onClick={onInsert}
      type="button"
    >
      <div className="font-mono text-xs text-foreground">{info.signature}</div>
      <div className="text-xs text-muted-foreground">{info.description}</div>
    </button>
  )
}

/** 插入浮动图片：本地文件（data: URL → 字节）或 URL（fetch → 字节；模型图带字节可入 xlsx 导出） */
function InsertImagePanel({
  actions,
  close,
  notify,
}: {
  actions: ToolbarActions
  close: () => void
  notify: (text: string, kind?: 'info' | 'warn') => void
}): ReactNode {
  const fileRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  /** URL → 模型图片字节（data: 本地解码；http(s) 拉取，失败 toast） */
  const resolveUrlInput = async (
    raw: string,
  ): Promise<{ data: Uint8Array; type: 'png' | 'jpeg' | 'gif' | 'svg' | 'webp' }> => {
    const local = dataUrlToImage(raw)
    if (local) {
      return local
    }
    const response = await fetch(raw)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const mime = response.headers.get('content-type') ?? ''
    const type = /png|jpeg|gif|svg|webp/i.exec(mime)?.[0]?.toLowerCase()
    if (!type) {
      throw new Error('不支持的图片类型')
    }
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      type:
        type === 'svg+xml' || type === 'svg' ? 'svg' : (type as 'png' | 'jpeg' | 'gif' | 'webp'),
    }
  }

  const insertFrom = (task: Promise<void>): void => {
    setBusy(true)
    void task
      .catch((error: unknown) =>
        notify(`图片读取失败：${error instanceof Error ? error.message : String(error)}`, 'warn'),
      )
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex w-64 flex-col gap-2">
      <input
        accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) {
            return
          }
          close()
          insertFrom(
            (async () => {
              const input = dataUrlToImage(await fileToDataURL(file))
              if (!input) {
                throw new Error('无法解析图片文件')
              }
              actions.insertFloatImage(input)
            })(),
          )
        }}
        ref={fileRef}
        type="file"
      />
      <button
        className="flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed border-border px-4 py-4 text-xs text-foreground hover:border-primary hover:text-primary"
        onClick={() => fileRef.current?.click()}
        type="button"
      >
        <ImageIcon className="size-5" />
        选择图片文件
        <span className="text-muted-foreground">支持 png / jpeg / gif / svg / webp</span>
      </button>
      <div className="flex items-center gap-1.5">
        <Input
          className="h-7 flex-1 text-xs"
          onChange={(event) => setUrl(event.target.value)}
          placeholder="输入图片 URL"
          type="text"
          value={url}
        />
        <Button
          className="h-7 text-xs"
          disabled={!url.trim() || busy}
          onClick={() => {
            const target = url.trim()
            close()
            insertFrom(
              (async () => {
                actions.insertFloatImage(await resolveUrlInput(target))
              })(),
            )
          }}
          size="xs"
        >
          插入
        </Button>
      </div>
    </div>
  )
}

function ExportPanel({ close, demo }: { close: () => void; demo: SheetDemo }): ReactNode {
  const controls = demo.getControls()
  return (
    <div className="flex w-44 flex-col gap-1">
      <button
        className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
        onClick={() => {
          void controls.xlsx
            .downloadBook()
            .then(() => demo.notify('已导出 Excel（整本工作簿）'))
            .catch((error: unknown) =>
              demo.notify(
                `导出失败：${error instanceof Error ? error.message : String(error)}`,
                'warn',
              ),
            )
          close()
        }}
        type="button"
      >
        <FileDown className="size-3.5 text-muted-foreground" />
        导出 Excel (.xlsx)
      </button>
      <button
        className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
        onClick={() => {
          const csv = controls.csv.exportCurrent()
          demo.notify(`已导出 CSV（${csv.split('\n').length} 行）`)
          close()
        }}
        type="button"
      >
        <FileDown className="size-3.5 text-muted-foreground" />
        导出 CSV (.csv)
      </button>
    </div>
  )
}

// ---- 查找替换面板 ----

function FindReplacePanel({
  demo,
  find,
  onClose,
}: {
  demo: SheetDemo
  find: FindReplaceController
  onClose: () => void
}): ReactNode {
  const [keyword, setKeyword] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeCell, setWholeCell] = useState(false)
  const [mode, setMode] = useState<'value' | 'formula'>('value')

  const sync = (
    next?: Partial<{
      keyword: string
      caseSensitive: boolean
      wholeCell: boolean
      mode: 'value' | 'formula'
    }>,
  ): void => {
    find.setQuery({
      keyword: next?.keyword ?? keyword,
      replacement,
      caseSensitive: next?.caseSensitive ?? caseSensitive,
      wholeCell: next?.wholeCell ?? wholeCell,
      mode: next?.mode ?? mode,
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          className="h-7 flex-1 text-xs"
          onChange={(event) => {
            setKeyword(event.target.value)
            sync({ keyword: event.target.value })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              find.stepBy(event.shiftKey ? -1 : 1)
            }
          }}
          placeholder="查找内容"
          type="text"
          value={keyword}
        />
        <span className="w-10 shrink-0 text-center font-mono text-xs text-muted-foreground">
          {find.countLabel()}
        </span>
        <Button
          aria-label="上一个（Shift+Enter）"
          onClick={() => find.stepBy(-1)}
          size="icon-xs"
          title="上一个（Shift+Enter）"
          variant="outline"
        >
          <ChevronLeft />
        </Button>
        <Button
          aria-label="下一个（Enter）"
          onClick={() => find.stepBy(1)}
          size="icon-xs"
          title="下一个（Enter）"
          variant="outline"
        >
          <ChevronRight />
        </Button>
        <Button aria-label="关闭" onClick={onClose} size="icon-xs" title="关闭" variant="ghost">
          <X />
        </Button>
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          className="h-7 flex-1 text-xs"
          onChange={(event) => {
            setReplacement(event.target.value)
            find.setReplacement(event.target.value)
          }}
          placeholder="替换为"
          type="text"
          value={replacement}
        />
        <Button
          className="h-7 text-xs"
          onClick={() => find.replaceOne()}
          size="xs"
          variant="outline"
        >
          替换
        </Button>
        <Button
          className="h-7 text-xs"
          onClick={() => {
            const count = find.replaceAll()
            demo.notify(
              count > 0 ? `已替换 ${count} 处` : '无匹配内容',
              count > 0 ? 'info' : 'warn',
            )
          }}
          size="xs"
        >
          全部替换
        </Button>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <label className="flex items-center gap-1.5">
          <Switch
            checked={caseSensitive}
            onCheckedChange={(checked) => {
              setCaseSensitive(checked)
              sync({ caseSensitive: checked })
            }}
          />
          区分大小写
        </label>
        <label className="flex items-center gap-1.5">
          <Switch
            checked={wholeCell}
            onCheckedChange={(checked) => {
              setWholeCell(checked)
              sync({ wholeCell: checked })
            }}
          />
          整格匹配
        </label>
        <Select
          onValueChange={(value) => {
            const next = value === 'formula' ? 'formula' : 'value'
            setMode(next)
            sync({ mode: next })
          }}
          value={mode}
        >
          <SelectTrigger className="ml-auto h-6 w-[96px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="value">按显示值</SelectItem>
            <SelectItem value="formula">按公式</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
