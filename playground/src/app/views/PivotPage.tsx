// 透视表页：PivotGrid 领域引擎演示。控件面为飞书式字段配置区——行维度按层级序
// 排列（一级/二级徽标 + 上下移 + 移除 + 追加）、列维度同为层级序（多级表头，可清空
// 为度量直排）、度量带聚合方式切换（求和/计数/平均/最大/最小）；行方向为多列树形
// 布局（同组跨行合并），点击组格折叠/展开、一键展开/收起与双击数值格下钻明细记录
// （Dialog）。全部操作经 demo.pivot 领域 API 驱动，面板态每次从引擎回读（引擎为唯一
// 事实源）；水印开关演示协议插件跨引擎挂载。

import {
  ChevronDown,
  ChevronUp,
  Droplets,
  FoldVertical,
  Lock,
  LockOpen,
  Plus,
  UnfoldVertical,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { PIVOT_DIMENSIONS, PIVOT_MEASURES, mountPivot, type PivotDemo } from '../../sections/pivot'
import { SectionPage } from '../SectionPage'
import type { PivotAggregator, PivotDimension, PivotMeasure, PivotRecord } from '@infinitable/pivot'

/** 聚合方式中文标签（面板 Select 与度量标题联动共用） */
const AGG_LABELS: Record<PivotAggregator, string> = {
  sum: '求和',
  count: '计数',
  avg: '平均',
  max: '最大',
  min: '最小',
}

/** 度量标题后缀（随聚合方式联动，列头与面板始终一致） */
const AGG_TITLE_SUFFIX: Record<PivotAggregator, string> = {
  sum: '和',
  count: '数',
  avg: '均',
  max: '最大',
  min: '最小',
}

const MEASURE_FIELD_LABELS: Record<string, string> = {
  '': '记录',
  qty: '数量',
  amount: '金额',
  rating: '评分',
}

const LEVEL_PREFIXES = ['一', '二', '三', '四', '五', '六'] as const

function levelLabel(index: number): string {
  return `${LEVEL_PREFIXES[index] ?? index + 1}级`
}

function measureTitle(field: string, agg: PivotAggregator): string {
  return `${MEASURE_FIELD_LABELS[field] ?? field}${AGG_TITLE_SUFFIX[agg]}`
}

function describe(demo: PivotDemo): string {
  const visible = demo.pivot.getVisibleRowCount()
  const collapsed = demo.pivot.getSubtotalRowCount()
  const leaf = Math.max(0, visible - collapsed - 1)
  return `行 ${visible}（折叠组 ${collapsed} + 明细 ${leaf} + 总计）· 表头层 ${demo.pivot.getHeaderRowCount()} · 数据列 ${demo.pivot.getDataColumnCount()} · 记录 ${demo.pivot.getRecordCount()}`
}

/** 图标小按钮 */
function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-5 text-muted-foreground hover:text-foreground"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

/** 维度 chip（行/列维度共用）：层级徽标 + 名称 + 上移/下移/移除（minCount 以下不可移除） */
function DimChip({
  dimension,
  index,
  count,
  minCount,
  onMove,
  onRemove,
}: {
  dimension: PivotDimension
  index: number
  count: number
  /** 允许的最少数量（行维度至少一层，列维度可清空为度量直排） */
  minCount: number
  onMove: (from: number, to: number) => void
  onRemove: () => void
}) {
  return (
    <span className="flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-1.5">
      <Badge variant="secondary" className="px-1.5 text-[10px]">
        {levelLabel(index)}
      </Badge>
      <span className="text-xs font-medium">{dimension.title}</span>
      <IconButton
        label={`上移 ${dimension.title}`}
        disabled={index === 0}
        onClick={() => onMove(index, index - 1)}
      >
        <ChevronUp />
      </IconButton>
      <IconButton
        label={`下移 ${dimension.title}`}
        disabled={index === count - 1}
        onClick={() => onMove(index, index + 1)}
      >
        <ChevronDown />
      </IconButton>
      <IconButton label={`移除 ${dimension.title}`} disabled={count <= minCount} onClick={onRemove}>
        <X />
      </IconButton>
    </span>
  )
}

/** 度量 chip：名称 + 聚合方式切换 + 移除（末位度量不可移除，引擎要求至少一个） */
function MeasureChip({
  measure,
  removable,
  onAggChange,
  onRemove,
}: {
  measure: PivotMeasure
  removable: boolean
  onAggChange: (agg: PivotAggregator) => void
  onRemove: () => void
}) {
  return (
    <span className="flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-1.5">
      <span className="text-xs font-medium">{measure.title}</span>
      <Select value={measure.agg} onValueChange={(value) => onAggChange(value as PivotAggregator)}>
        <SelectTrigger
          size="sm"
          className="h-5 w-14 border-none bg-transparent px-1.5 text-xs text-muted-foreground shadow-none"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(AGG_LABELS) as PivotAggregator[]).map((agg) => (
            <SelectItem key={agg} value={agg} className="text-xs">
              {AGG_LABELS[agg]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <IconButton label={`移除 ${measure.title}`} disabled={!removable} onClick={onRemove}>
        <X />
      </IconButton>
    </span>
  )
}

/** 双击下钻明细弹窗：交叉格聚合覆盖的原始记录 */
function DrillDialog({
  drill,
  measureFields,
  onClose,
}: {
  drill: { records: readonly PivotRecord[] }
  measureFields: string[]
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">
            交叉格明细 · {drill.records.length} 条记录
          </DialogTitle>
          <DialogDescription>双击数值格下钻：以下为该格聚合覆盖的全部原始记录。</DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/70">
              <tr>
                {PIVOT_DIMENSIONS.map((dimension) => (
                  <th key={dimension.key} className="px-2.5 py-1.5 text-left font-medium">
                    {dimension.title}
                  </th>
                ))}
                {measureFields.map((field) => (
                  <th key={field} className="px-2.5 py-1.5 text-right font-medium">
                    {MEASURE_FIELD_LABELS[field] ?? field}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drill.records.map((record, index) => (
                <tr key={index} className="border-t">
                  {PIVOT_DIMENSIONS.map((dimension) => (
                    <td key={dimension.key} className="px-2.5 py-1.5">
                      {String(record[dimension.key] ?? '')}
                    </td>
                  ))}
                  {measureFields.map((field) => (
                    <td key={field} className="px-2.5 py-1.5 text-right tabular-nums">
                      {String(record[field] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 演示控制面板：飞书式行维度/列维度/度量字段区 + 树操作 + 水印开关 + 结构状态行 */
function PivotControls({ demo }: { demo: PivotDemo }) {
  // 面板态全部从引擎回读（引擎为唯一事实源）
  const [rowDims, setRowDims] = useState<string[]>(() => [...demo.pivot.getRowDimensionKeys()])
  const [colDims, setColDims] = useState<string[]>(() => [...demo.pivot.getColumnDimensionKeys()])
  const [measures, setMeasures] = useState<readonly PivotMeasure[]>(() => demo.pivot.getMeasures())
  const [collapsible, setCollapsible] = useState(() => demo.pivot.getCollapsible())
  const [status, setStatus] = useState(() => describe(demo))
  const [watermarkOn, setWatermarkOn] = useState(() => demo.watermark.isEnabled())
  const [drill, setDrill] = useState<{ records: readonly PivotRecord[] } | null>(null)

  useEffect(() => demo.pivot.onCellDrill(setDrill), [demo])

  const sync = useCallback(() => {
    setRowDims([...demo.pivot.getRowDimensionKeys()])
    setColDims([...demo.pivot.getColumnDimensionKeys()])
    setMeasures(demo.pivot.getMeasures())
    setCollapsible(demo.pivot.getCollapsible())
    setStatus(describe(demo))
  }, [demo])

  const setRowKeys = (next: (keys: string[]) => string[]) => {
    demo.pivot.setRowDimensions(next([...rowDims]))
    sync()
  }

  const setColKeys = (next: (keys: string[]) => string[]) => {
    demo.pivot.setColumnDimensions(next([...colDims]))
    sync()
  }

  const setMeasureKeys = (next: (keys: string[]) => string[]) => {
    demo.pivot.setMeasures(next(measures.map((measure) => measure.key)))
    sync()
  }

  const rowDimensionByKey = (key: string) => PIVOT_DIMENSIONS.find((dim) => dim.key === key)
  const measureByKey = (key: string) => PIVOT_MEASURES.find((measure) => measure.key === key)
  const inactiveDimensions = PIVOT_DIMENSIONS.filter(
    (dim) => !rowDims.includes(dim.key) && !colDims.includes(dim.key),
  )
  const inactiveMeasures = PIVOT_MEASURES.filter(
    (measure) => !measures.some((active) => active.key === measure.key),
  )
  const measureFields = [
    ...new Set(measures.map((measure) => measure.field).filter((field) => field !== '')),
  ]

  const moveKey = (keys: string[], from: number, to: number): string[] => {
    const next = [...keys]
    ;[next[from], next[to]] = [next[to]!, next[from]!]
    return next
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-2.5">
          {/* 行维度区：层级序 chip + 追加 + 树操作 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Label className="w-12 shrink-0 text-xs text-muted-foreground">行维度</Label>
            {rowDims.map((key, index) => {
              const dimension = rowDimensionByKey(key)
              return dimension ? (
                <DimChip
                  key={key}
                  dimension={dimension}
                  index={index}
                  count={rowDims.length}
                  minCount={1}
                  onMove={(from, to) => setRowKeys((keys) => moveKey(keys, from, to))}
                  onRemove={() => setRowKeys((keys) => keys.filter((existing) => existing !== key))}
                />
              ) : null
            })}
            {inactiveDimensions.length > 0 ? (
              // value 恒为无匹配哨兵：追加下拉只出占位符，选中即回哑值
              <Select
                value="__add_dim"
                onValueChange={(key) => setRowKeys((keys) => [...keys, key])}
              >
                <SelectTrigger
                  size="sm"
                  className="h-6 w-24 border-dashed text-xs text-muted-foreground"
                >
                  <Plus className="size-3" />
                  <SelectValue placeholder="行维度" />
                </SelectTrigger>
                <SelectContent>
                  {inactiveDimensions.map((dimension) => (
                    <SelectItem key={dimension.key} value={dimension.key} className="text-xs">
                      {dimension.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Separator orientation="vertical" className="mx-1 h-5" />
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={!collapsible}
              onClick={() => {
                demo.pivot.expandAll()
                sync()
              }}
            >
              <UnfoldVertical className="size-3.5" />
              全部展开
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={!collapsible}
              onClick={() => {
                demo.pivot.collapseAll()
                sync()
              }}
            >
              <FoldVertical className="size-3.5" />
              收起到一级
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                demo.pivot.setCollapsible(!demo.pivot.getCollapsible())
                sync()
              }}
            >
              {collapsible ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
              {collapsible ? '禁止折叠' : '允许折叠'}
            </Button>
          </div>

          {/* 列维度区：层级序 chip（多级表头）+ 追加；可清空为度量直排 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Label className="w-12 shrink-0 text-xs text-muted-foreground">列维度</Label>
            {colDims.map((key, index) => {
              const dimension = rowDimensionByKey(key)
              return dimension ? (
                <DimChip
                  key={key}
                  dimension={dimension}
                  index={index}
                  count={colDims.length}
                  minCount={0}
                  onMove={(from, to) => setColKeys((keys) => moveKey(keys, from, to))}
                  onRemove={() => setColKeys((keys) => keys.filter((existing) => existing !== key))}
                />
              ) : null
            })}
            {colDims.length === 0 ? (
              <span className="text-xs text-muted-foreground">无（度量直排）</span>
            ) : null}
            {inactiveDimensions.length > 0 ? (
              <Select
                value="__add_col_dim"
                onValueChange={(key) => setColKeys((keys) => [...keys, key])}
              >
                <SelectTrigger
                  size="sm"
                  className="h-6 w-24 border-dashed text-xs text-muted-foreground"
                >
                  <Plus className="size-3" />
                  <SelectValue placeholder="列维度" />
                </SelectTrigger>
                <SelectContent>
                  {inactiveDimensions.map((dimension) => (
                    <SelectItem key={dimension.key} value={dimension.key} className="text-xs">
                      {dimension.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>

          {/* 度量区：名称 + 聚合方式 + 追加 + 水印 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Label className="w-12 shrink-0 text-xs text-muted-foreground">度量</Label>
            {measures.map((measure) => (
              <MeasureChip
                key={measure.key}
                measure={measure}
                removable={measures.length > 1}
                onAggChange={(agg) => {
                  demo.pivot.updateMeasure(measure.key, {
                    agg,
                    title: measureTitle(measure.field, agg),
                  })
                  sync()
                }}
                onRemove={() =>
                  setMeasureKeys((keys) => keys.filter((existing) => existing !== measure.key))
                }
              />
            ))}
            {inactiveMeasures.length > 0 ? (
              <Select
                value="__add_measure"
                onValueChange={(key) => {
                  const measure = measureByKey(key)
                  if (measure) demo.pivot.setMeasures([...measures.map((m) => m.key), key])
                  sync()
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="h-6 w-24 border-dashed text-xs text-muted-foreground"
                >
                  <Plus className="size-3" />
                  <SelectValue placeholder="度量" />
                </SelectTrigger>
                <SelectContent>
                  {inactiveMeasures.map((measure) => (
                    <SelectItem key={measure.key} value={measure.key} className="text-xs">
                      {measure.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Separator orientation="vertical" className="mx-1 h-5" />
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                const next = !demo.watermark.isEnabled()
                demo.watermark.updateConfig({ enabled: next })
                setWatermarkOn(next)
              }}
            >
              <Droplets className="size-3.5" />
              {watermarkOn ? '摘水印' : '挂水印'}
            </Button>
          </div>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {status} · 点击行维度组格左缘 ▸/▾
        图标折叠/展开（折叠组收敛为自带聚合的单行），点击组格其余区域选中该组全部维度数据；双击数值格下钻明细。列维度可多级勾选（年份/月份为日期层级示例），「禁止折叠」后始终平铺。
      </p>
      {drill ? (
        <DrillDialog drill={drill} measureFields={measureFields} onClose={() => setDrill(null)} />
      ) : null}
    </div>
  )
}

export function PivotPage() {
  const [demo, setDemo] = useState<PivotDemo | null>(null)
  // 包装为引用稳定回调：SectionPage 的挂载 effect 依赖 mount 引用，只跑一次
  const mount = useCallback((root: HTMLElement): PivotDemo => {
    const mounted = mountPivot(root)
    setDemo(mounted)
    return mounted
  }, [])
  const unmount = useCallback((mounted: PivotDemo) => mounted.dispose(), [])

  return (
    <div className="flex flex-col gap-4">
      <SectionPage
        title="透视表（PivotGrid 引擎）"
        tags={[
          '引擎装配协议',
          '多列树形行头',
          '跨行合并',
          '多级表头',
          '度量聚合',
          '明细下钻',
          '插件跨引擎',
        ]}
        desc="@infinitable/pivot 的 PivotGrid：与 ListTable 平级的领域引擎，内部经 TableEngine 协议面装配 table 引擎——行方向为多列树形布局：每个行维度独占一列，同组单元格跨行合并，点击组格折叠/展开（折叠组收敛为自带聚合值的单行载体），双击数值格下钻明细；列方向为多级表头：列维度逐层 + 度量行，以引擎冻结行 + 合并区落地；列维度 × 度量交叉聚合即时重算、结构动态增删原地落地；水印经 EngineAssembly 插件槽位跨引擎挂载。"
        mount={mount}
        unmount={unmount}
      />
      {demo ? <PivotControls demo={demo} /> : null}
    </div>
  )
}
