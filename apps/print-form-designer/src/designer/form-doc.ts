import {
  Sheet,
  TypedEventEmitter,
  type CellAddress,
  type CellMetaSnapshotItem,
  type CellRange,
  type SheetSnapshot,
} from '@infinitable/sheet'

import { clampSnapshotToBounds, contentBounds, type ContentBounds } from './content-bounds'
import {
  appendRegionRect,
  planRegionRowResize,
  regionAt,
  regionsWithExpand,
  regionsWithFields,
  regionsWithGroupBy,
  regionsWithName,
  regionsWithRowRole,
  regionsWithSource,
} from './region-ops'
import { deleteSnapshotRows, insertSnapshotRows } from './snapshot-rows'
import {
  FORM_BINDING_META_NAMESPACE,
  FORM_FUNCTION_META_NAMESPACE,
  TEMPLATE_SCHEMA_VERSION,
  isAggBinding,
  normalizeAggregations,
  normalizeCellBinding,
  normalizeCellFunction,
  normalizeRegions,
  regionRefOf,
  type FormAggregation,
  type FormCellBinding,
  type FormCellFunction,
  type FormRegion,
  type FormTemplate,
  type LegacyFormCellFunction,
  type RegionExpand,
  type RegionRowRole,
  type RegionSource,
} from './template'

/**
 * 设计文档 = Sheet 模型 + 数据块注册表 + 聚合注册表 + 统一 undo 门面。
 *
 * 画布尺寸口径（无限画布）：**没有声明行列数**。行列数一律由内容包围盒推导
 * （content-bounds.ts），序列化时把 sheet 快照收紧到包围盒——引擎 growOnScroll
 * 撑出的上百行空行不进模板，round-trip 幂等。
 *
 * 撤销链路口径（app 内测试覆盖）：
 * - 格值/样式/合并/绑定与函数 sidecar 一律走 Sheet 命令系统（样式池落地，天然可撤销），
 *   画布键入、工具栏命令同链；
 * - 数据块/聚合结构（增删/改范围/展开方式/数据源/分组/名称）与行高列宽不在 Sheet undo
 *   覆盖内，经「快照纯变换 + 静默 restore」落地，由 DocHistory 以快照条目补齐撤销；
 * - DocHistory 惰性观测 sheet.undoSize：新编辑（无论来源）清空重做栈，撤销先走
 *   sheet 历史、耗尽到快照条目记录深度再弹快照条目——两套来源交错成单条撤销链。
 */

/** 文档快照（DocHistory 条目载荷；数据块/聚合更新全走不可变更新，引用即隔离） */
interface DocCapture {
  regions: FormRegion[]
  aggregations: FormAggregation[]
  sheet: SheetSnapshot
}

export interface DocHistoryState {
  canUndo: boolean
  canRedo: boolean
}

type FormDocEvents = {
  /** 数据块结构变化（数据块面板重渲染；画布数据块描边同步） */
  'regions-change': undefined
  /** 聚合结构变化（聚合面板重渲染） */
  'aggregations-change': undefined
  /** 撤销链变化（工具栏按钮置灰；画布按几何/合并变化决定重建或就地重绘） */
  'history-change': DocHistoryState
}

/** 矩形（数据块闭区间口径） */
interface Rect {
  startRow: number
  endRow: number
  startCol: number
  endCol: number
}

/** 格是否落在矩形内（闭区间） */
function inRect(item: { row: number; col: number }, rect: Rect): boolean {
  return (
    item.row >= rect.startRow &&
    item.row <= rect.endRow &&
    item.col >= rect.startCol &&
    item.col <= rect.endCol
  )
}

/** 字符串字面量整词替换（数据块引用名改写用：`'明细'` / `"明细"` → 新名） */
function rewriteStringRef(expression: string, oldRef: string, newRef: string): string {
  return expression.replace(/(['"])([^'"\n]*)\1/g, (match, quote: string, inner: string) =>
    inner === oldRef ? `${quote}${newRef}${quote}` : match,
  )
}

/** 聚合访问改写：`agg.old` / `agg['old']` → 新名（词边界匹配，避免误伤前缀同名） */
function rewriteAggRef(expression: string, oldName: string, newName: string): string {
  return expression
    .replace(new RegExp(`\\bagg\\.${escapeRegExp(oldName)}\\b`, 'g'), `agg.${newName}`)
    .replace(new RegExp(`\\bagg\\[(['"])${escapeRegExp(oldName)}\\1\\]`, 'g'), `agg['${newName}']`)
}

/** 正则元字符转义（用户提供的名字按字面量匹配） */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 加载期函数 sidecar 规范化：旧表达式嗅探 + 新形状校验（非法即抛错，整模板拒绝） */
function normalizeFunctionMeta(sheet: SheetSnapshot): SheetSnapshot {
  if (!sheet.meta?.some((item) => item.namespace === FORM_FUNCTION_META_NAMESPACE)) return sheet
  const meta = sheet.meta.map((item) =>
    item.namespace === FORM_FUNCTION_META_NAMESPACE
      ? { ...item, payload: normalizeCellFunction(item.payload) }
      : item,
  )
  return { ...sheet, meta }
}

/** 加载期绑定 sidecar 规范化：相对/聚合引用两形状校验（非法即抛错，整模板拒绝） */
function normalizeBindingMeta(sheet: SheetSnapshot): SheetSnapshot {
  if (!sheet.meta?.some((item) => item.namespace === FORM_BINDING_META_NAMESPACE)) return sheet
  const meta = sheet.meta.map((item) =>
    item.namespace === FORM_BINDING_META_NAMESPACE
      ? { ...item, payload: normalizeCellBinding(item.payload) }
      : item,
  )
  return { ...sheet, meta }
}

/** 捕获文档快照：数据块/聚合直接存引用（更新走不可变更新，旧引用不会被回写） */
function captureDoc(doc: FormDoc): DocCapture {
  return {
    regions: doc.regions,
    aggregations: doc.aggregations,
    sheet: doc.sheet.snapshot(),
  }
}

// ─── 统一 undo 门面 ──────────────────────────────────────────────────────────

/**
 * 撤销门面：sheet 命令历史（值/样式/合并/meta）+ 快照条目（数据块/聚合结构/行高列宽）
 * 交错成单条撤销链。
 *
 * 不变量：快照条目栈内 atDepth 非严格递减（自底向上），且恒有
 * sheet.history.undoSize >= 栈顶条目 atDepth——撤销先耗 sheet 历史到条目深度，
 * 再弹条目回放快照；重做按撤销逆序经 redoLog 复原。惰性观测 undoSize 增长
 * （工具栏命令与画布键入同待遇）以清空重做链，与 sheet 新命令清 redo 栈对齐。
 */
class DocHistory {
  private readonly doc: FormDoc
  private readonly emitState: (state: DocHistoryState) => void
  private entries: { atDepth: number; before: DocCapture; after: DocCapture }[] = []
  private redoLog: (
    | 'sheet'
    | { snapshot: { atDepth: number; before: DocCapture; after: DocCapture } }
  )[] = []
  private lastDepth = 0

  constructor(doc: FormDoc, emitState: (state: DocHistoryState) => void) {
    this.doc = doc
    this.emitState = emitState
  }

  /** 惰性观测 sheet 深度：增长即有新编辑入栈 → 清空重做链（对齐 sheet 清 redo 栈） */
  private observe(): void {
    const depth = this.doc.sheet.history.undoSize
    if (depth > this.lastDepth) this.redoLog = []
    this.lastDepth = depth
  }

  /** 记录一次快照级编辑（数据块/聚合结构/行高列宽；快照存引用，靠不可变更新隔离） */
  pushSnapshotEdit(before: DocCapture, after: DocCapture): void {
    if (JSON.stringify(before) === JSON.stringify(after)) return
    this.observe()
    this.entries.push({ atDepth: this.doc.sheet.history.undoSize, before, after })
    this.redoLog = []
    this.emitState(this.getState())
  }

  get canUndo(): boolean {
    this.observe()
    const floor = this.entries[this.entries.length - 1]?.atDepth ?? 0
    return this.doc.sheet.history.undoSize > floor || this.entries.length > 0
  }

  get canRedo(): boolean {
    this.observe()
    return this.redoLog.length > 0
  }

  getState(): DocHistoryState {
    return { canUndo: this.canUndo, canRedo: this.canRedo }
  }

  undo(): boolean {
    this.observe()
    const top = this.entries[this.entries.length - 1]
    if (this.doc.sheet.history.undoSize > (top?.atDepth ?? 0)) {
      if (!this.doc.sheet.undo()) return false
      this.lastDepth = this.doc.sheet.history.undoSize
      this.redoLog.push('sheet')
      this.emitState(this.getState())
      return true
    }
    if (!top) return false
    this.entries.pop()
    this.doc.restoreCapture(top.before)
    this.redoLog.push({ snapshot: top })
    this.emitState(this.getState())
    return true
  }

  redo(): boolean {
    this.observe()
    const top = this.redoLog[this.redoLog.length - 1]
    if (!top) return false
    if (top === 'sheet') {
      if (!this.doc.sheet.redo()) return false
      this.lastDepth = this.doc.sheet.history.undoSize
    } else {
      this.entries.push(top.snapshot)
      this.doc.restoreCapture(top.snapshot.after)
    }
    this.redoLog.pop()
    this.emitState(this.getState())
    return true
  }
}

// ─── 设计文档 ────────────────────────────────────────────────────────────────

export class FormDoc extends TypedEventEmitter<FormDocEvents> {
  readonly sheet: Sheet
  readonly history: DocHistory
  regions: FormRegion[]
  aggregations: FormAggregation[]

  private constructor(sheet: Sheet, regions: FormRegion[], aggregations: FormAggregation[]) {
    super()
    this.sheet = sheet
    this.regions = regions
    this.aggregations = aggregations
    this.history = new DocHistory(this, (state) => this.emit('history-change', state))
  }

  /** 内容包围盒（序列化/打印/参考线的共同口径） */
  get bounds(): ContentBounds {
    return contentBounds(this.sheet.snapshot(), this.regions)
  }

  /** 画布总行数（内容包围盒的行数，至少 1） */
  get rows(): number {
    return this.bounds.rows
  }

  /** 画布总列数（内容包围盒的列数，至少 1） */
  get cols(): number {
    return this.bounds.cols
  }

  /**
   * 新建空白文档：给一个全宽 3 行的静态数据块（宽度由 `cols` 指定）。
   * `cols` 只是这块起始数据块的宽度——画布本身没有声明尺寸（引擎按视口给足，
   * 序列化时按内容包围盒收紧）。
   */
  static create(cols: number): FormDoc {
    const regions: FormRegion[] = [
      { startRow: 0, endRow: 2, startCol: 0, endCol: cols - 1, expand: 'none' },
    ]
    return new FormDoc(new Sheet('form'), regions, [])
  }

  /**
   * 从模板 JSON 还原文档：只认当前 schema 版本。
   * 类型上的 `schemaVersion` 是字面量，但载荷来自网络/手改 JSON，因此运行期再判一次；
   * 不是当前版本直接抛错，不做迁移、不兜底（v4/v5 → v6 由 migrateTemplateToCurrent 承担）。
   * 绑定/函数 sidecar 在此统一规范化（绑定两形状 / 函数旧表达式嗅探与新形状校验）；聚合
   * 走**宽松** normalize（缺 type 空数据试跑推导、失败按数据块引用回退），加载不卡。
   */
  static fromTemplate(input: FormTemplate): FormDoc {
    if (input.schemaVersion !== TEMPLATE_SCHEMA_VERSION) {
      const expected = String(TEMPLATE_SCHEMA_VERSION)
      throw new Error(`模板 schemaVersion 必须是 ${expected}：${String(input.schemaVersion)}`)
    }
    const aggregations = normalizeAggregations(input.aggregations ?? [], {
      regions: input.regions,
    })
    const regions = normalizeRegions(input.regions, aggregations)
    const doc = new FormDoc(new Sheet('form'), regions, aggregations)
    const sheet = normalizeBindingMeta(normalizeFunctionMeta(input.sheet))
    doc.sheet.restore(clampSnapshotToBounds(sheet, contentBounds(input.sheet, regions)))
    return doc
  }

  /** 序列化为模板 JSON（数据块 + 聚合 + 画布快照；快照行列数收紧到内容包围盒） */
  toTemplate(name: string): FormTemplate {
    const snapshot = this.sheet.snapshot()
    return {
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name,
      regions: normalizeRegions(this.regions, this.aggregations),
      aggregations: normalizeAggregations(this.aggregations, { regions: this.regions }),
      sheet: clampSnapshotToBounds(snapshot, contentBounds(snapshot, this.regions)),
    }
  }

  /** 快照级编辑包装：捕获前后态 → 变换 → 记入撤销链（无实际变化不入链） */
  private applySnapshotEdit(mutate: () => void): void {
    const before = captureDoc(this)
    mutate()
    this.history.pushSnapshotEdit(before, captureDoc(this))
  }

  /**
   * 快照回放（撤销/重做路径）：静默 restore（不清 sheet 历史，样式命令的撤销
   * 能力保留）+ 重建数据块/聚合注册表；有变时补发变更信号驱动面板与画布同步。
   * @internal 仅供本模块 DocHistory 回放调用，业务代码不要直接调
   */
  restoreCapture(capture: DocCapture): void {
    this.sheet.restore(capture.sheet)
    const regionsChanged = JSON.stringify(this.regions) !== JSON.stringify(capture.regions)
    const aggregationsChanged =
      JSON.stringify(this.aggregations) !== JSON.stringify(capture.aggregations)
    this.regions = capture.regions
    this.aggregations = capture.aggregations
    if (regionsChanged) this.emit('regions-change', undefined)
    if (aggregationsChanged) this.emit('aggregations-change', undefined)
  }

  // ─── 绑定/函数 sidecar 读写（模型口径） ────────────────────────────────────

  /** 读取格绑定（合并格解析锚点）；未绑定返回 undefined */
  getCellBinding(addr: CellAddress): FormCellBinding | undefined {
    return this.sheet.getCellMeta<FormCellBinding>(addr, FORM_BINDING_META_NAMESPACE)
  }

  /**
   * 写入/清除格绑定（经 cell-meta 命令，sheet 历史内可撤销）。
   * 两种形态：相对绑定（块内条目路径）或聚合引用（`kind: 'agg'`，直接取非数组聚合的
   * 值）。写入即规范化（聚合引用要求聚合名非空）；绑定与函数互斥：写入绑定即清同格的
   * 函数 sidecar。
   */
  setCellBinding(addr: CellAddress, binding: FormCellBinding | null): void {
    if (binding) {
      if (this.getCellFunction(addr)) {
        this.sheet.clearCellMeta(addr, FORM_FUNCTION_META_NAMESPACE)
      }
      this.sheet.setCellMeta(addr, FORM_BINDING_META_NAMESPACE, normalizeCellBinding(binding))
    } else {
      this.sheet.clearCellMeta(addr, FORM_BINDING_META_NAMESPACE)
    }
  }

  /** 读取格函数（文档内载荷已规范化）；未设置返回 undefined */
  getCellFunction(addr: CellAddress): FormCellFunction | undefined {
    return this.sheet.getCellMeta<FormCellFunction>(addr, FORM_FUNCTION_META_NAMESPACE)
  }

  /**
   * 写入/清除格函数（经 cell-meta 命令，可撤销）；写入函数时清掉同格绑定。
   * 写入即规范化（旧表达式形状在此嗅探转换），文档内不存在未规范化载荷——
   * 参数类型收旧形状仅为兼容既有调用方（种子/测试），语义以 normalize 为准。
   */
  setCellFunction(addr: CellAddress, fn: FormCellFunction | LegacyFormCellFunction | null): void {
    if (fn) {
      if (this.getCellBinding(addr)) {
        this.sheet.clearCellMeta(addr, FORM_BINDING_META_NAMESPACE)
      }
      this.sheet.setCellMeta(addr, FORM_FUNCTION_META_NAMESPACE, normalizeCellFunction(fn))
    } else {
      this.sheet.clearCellMeta(addr, FORM_FUNCTION_META_NAMESPACE)
    }
  }

  /**
   * 矩形内的**相对绑定**格清单（数据块创建/改范围守卫与清除用）。
   * 聚合引用绑定不以数据块为归属（求值只看聚合环境），不算数也不随之清除。
   */
  private bindingCellsIn(rect: Rect): { row: number; col: number }[] {
    return (this.sheet.snapshot().meta ?? [])
      .filter(
        (item) =>
          item.namespace === FORM_BINDING_META_NAMESPACE &&
          !isAggBinding(item.payload) &&
          inRect(item, rect),
      )
      .map(({ row, col }) => ({ row, col }))
  }

  /**
   * 静默清除矩形内的**相对绑定** sidecar（数据块内数据源被清/数据块删除时；随快照条目
   * 可撤销）。聚合引用绑定保留——它不依赖数据块的数据源。
   */
  private clearBindingsIn(rect: Rect): void {
    const snapshot = this.sheet.snapshot()
    const meta = snapshot.meta?.filter(
      (item) =>
        !(
          item.namespace === FORM_BINDING_META_NAMESPACE &&
          !isAggBinding(item.payload) &&
          inRect(item, rect)
        ),
    )
    this.sheet.restore({ ...snapshot, meta })
  }

  /**
   * 静默改写全部函数 sidecar（重命名联动，随快照条目可撤销）：
   * 结构化 fn 改 region 字段，自定义 expr 改表达式内的字符串引用；未变须返回原引用。
   */
  private rewriteFunctionRefs(rewrite: (payload: FormCellFunction) => FormCellFunction): void {
    const snapshot = this.sheet.snapshot()
    let changed = false
    const meta: CellMetaSnapshotItem[] | undefined = snapshot.meta?.map((item) => {
      if (item.namespace !== FORM_FUNCTION_META_NAMESPACE) return item
      const payload = item.payload as FormCellFunction
      const next = rewrite(payload)
      if (next === payload) return item
      changed = true
      return { ...item, payload: next }
    })
    if (changed) this.sheet.restore({ ...snapshot, meta })
  }

  /**
   * 静默改写全部绑定 sidecar（聚合重命名联动，随快照条目可撤销）：
   * 聚合引用绑定改 aggName 字段；未变须返回原引用。相对绑定不引用聚合，不受影响。
   */
  private rewriteBindingRefs(rewrite: (payload: FormCellBinding) => FormCellBinding): void {
    const snapshot = this.sheet.snapshot()
    let changed = false
    const meta: CellMetaSnapshotItem[] | undefined = snapshot.meta?.map((item) => {
      if (item.namespace !== FORM_BINDING_META_NAMESPACE) return item
      const payload = item.payload as FormCellBinding
      const next = rewrite(payload)
      if (next === payload) return item
      changed = true
      return { ...item, payload: next }
    })
    if (changed) this.sheet.restore({ ...snapshot, meta })
  }

  // ─── 数据块结构操作 ──────────────────────────────────────────────────────────

  /**
   * 在内容包围盒最下方追加一个全宽数据块（行数由 `rows` 指定）。
   * 追加位置在既有内容之后，因此不移动画布内容、也不需要插行。
   * v4 起画布 UI 不再暴露「添加数据块」入口（框选右键即主路径），本方法保留为
   * 模型级构造器（测试与种子构建用）。
   */
  addRegion(rows: number): FormRegion {
    const bounds = this.bounds
    const region: FormRegion = {
      startRow: bounds.rows,
      endRow: bounds.rows + rows - 1,
      startCol: 0,
      endCol: bounds.cols - 1,
      expand: 'none',
    }
    this.commitRegions(appendRegionRect(this.regions, region, this.aggregations))
    return this.regions[this.regions.length - 1]!
  }

  /**
   * 选区 → 数据块（画布右键菜单的主入口）：把一块矩形框成新数据块。
   * 守卫：选区不得与既有数据块重叠（appendRegionRect 校验），也不得包含已设相对绑定的
   * 单元格——相对绑定的数据源继承所在数据块，把它框进新数据块会让绑定失去归属。
   * 聚合引用绑定不依赖数据块，不拦。
   */
  createRegionFromRange(
    range: CellRange,
    options: { name?: string; expand?: RegionExpand; source?: RegionSource } = {},
  ): FormRegion {
    const rect = {
      startRow: Math.min(range.start.row, range.end.row),
      endRow: Math.max(range.start.row, range.end.row),
      startCol: Math.min(range.start.col, range.end.col),
      endCol: Math.max(range.start.col, range.end.col),
    }
    const boundCells = this.bindingCellsIn(rect)
    if (boundCells.length > 0) {
      throw new Error('选区内有绑定字段的单元格：字段绑定只能属于数据块，请先调整范围或清除绑定')
    }
    const region: FormRegion = {
      ...rect,
      expand: options.expand ?? 'none',
      ...(options.name?.trim() ? { name: options.name.trim() } : {}),
      ...(options.source ? { source: options.source } : {}),
    }
    this.commitRegions(appendRegionRect(this.regions, region, this.aggregations))
    return this.regions[this.regions.length - 1]!
  }

  /**
   * 删除数据块标记（画布内容保留——用户手画的东西不能误删）。
   * 数据块内的字段绑定随之清除：绑定以数据块的数据源为归属，数据块没了绑定即失效。
   */
  removeRegion(index: number): void {
    const region = regionAt(this.regions, index)
    this.applySnapshotEdit(() => {
      this.clearBindingsIn(region)
      this.regions = this.regions.filter((_, i) => i !== index)
    })
    this.emit('regions-change', undefined)
  }

  /** 设置展开方式（`down` / `right` 各最多一个；数据源可后绑——展开未绑源是合法中间态） */
  setRegionExpand(index: number, expand: RegionExpand): void {
    this.commitRegions(regionsWithExpand(this.regions, index, expand, this.aggregations))
  }

  /**
   * 设置/替换数据块的数据源（展开份数的唯一来源）。
   * 清空后展开方式保留（未绑源的数据块渲染暂按 1 份）；清空数据源时数据块内的
   * 字段绑定一并清除（绑定以数据源为归属）。
   */
  setRegionSource(index: number, source: RegionSource | undefined): void {
    const region = regionAt(this.regions, index)
    this.applySnapshotEdit(() => {
      this.regions = regionsWithSource(this.regions, index, source, this.aggregations)
      if (!source) this.clearBindingsIn(region)
    })
    this.emit('regions-change', undefined)
  }

  /**
   * 重命名数据块（空名 = 回到缺省的「数据块 N」）。
   * 引用名变了就联动改写全部函数载荷里的数据块引用（结构化改 region 字段、
   * 自定义改表达式内的字符串引用），保证 `SUM('明细')` 不断链。
   */
  renameRegion(index: number, name: string): void {
    const oldRef = regionRefOf(regionAt(this.regions, index), index)
    const next = normalizeRegions(regionsWithName(this.regions, index, name), this.aggregations)
    const newRef = regionRefOf(next[index]!, index)
    if (oldRef === newRef) {
      this.commitRegions(next)
      return
    }
    this.applySnapshotEdit(() => {
      this.regions = next
      this.rewriteFunctionRefs((payload) => {
        if (payload.kind !== 'fn') {
          const expression = rewriteStringRef(payload.expression, oldRef, newRef)
          return expression === payload.expression ? payload : { kind: 'expr', expression }
        }
        return payload.fn !== 'GROUP' && payload.region === oldRef
          ? { ...payload, region: newRef }
          : payload
      })
    })
    this.emit('regions-change', undefined)
  }

  /**
   * 改数据块范围（不移动画布内容；画布拖拽与右键「调整为选区」的落点）。
   * 守卫：缩小范围不得把已绑定字段的单元格踢出数据块——绑定以数据块为归属。
   */
  setRegionFields(
    index: number,
    patch: Partial<Omit<FormRegion, 'expand' | 'groupBy' | 'rowRoles'>>,
  ): void {
    const region = regionAt(this.regions, index)
    const next = { ...region, ...patch }
    const kicked = this.bindingCellsIn(region).filter((cell) => !inRect(cell, next))
    if (kicked.length > 0) {
      throw new Error('调整后的范围把绑定字段的单元格挤出了数据块：请先清除这些格的绑定')
    }
    this.commitRegions(regionsWithFields(this.regions, index, patch, this.aggregations))
  }

  /** 调整数据块行数：变高在数据块底部插空行、变矮删底行（内容留原处）；可撤销 */
  resizeRegionRows(index: number, rows: number): void {
    const plan = planRegionRowResize(this.regions, index, rows, this.aggregations)
    if (!plan) return
    this.applySnapshotEdit(() => {
      const op = plan.delta > 0 ? insertSnapshotRows : deleteSnapshotRows
      this.sheet.restore(op(this.sheet.snapshot(), plan.at, Math.abs(plan.delta)))
      this.regions = plan.regions
    })
    this.emit('regions-change', undefined)
  }

  /**
   * 设置分组字段（undefined/空 = 清除）。首次从无到有会连带预填典型行角色布局
   * （region-ops 内完成，与分组字段同属一次撤销）；清除时组头/小计角色随之剔除。
   */
  setRegionGroupBy(index: number, paths: string[] | undefined): void {
    this.commitRegions(regionsWithGroupBy(this.regions, index, paths, this.aggregations))
  }

  /** 设置数据块内某行的渲染角色（'detail' = 回到默认明细行） */
  setRegionRowRole(index: number, row: number, role: RegionRowRole): void {
    this.commitRegions(regionsWithRowRole(this.regions, index, row, role, this.aggregations))
  }

  /** 数据块序列的落点：走撤销门面 + 补发变更信号（所有数据块结构操作的唯一出口） */
  private commitRegions(next: FormRegion[]): void {
    this.applySnapshotEdit(() => {
      this.regions = next
    })
    this.emit('regions-change', undefined)
  }

  // ─── 聚合操作 ──────────────────────────────────────────────────────────────

  /**
   * 整表替换聚合序列（聚合面板 CRUD 的唯一落点）。
   * 校验（**提交强校验** mode submit）：名字/变量名/表达式/类型合法，空数据试跑不抛错
   * 且返回形态与声明类型一致（缺 type 先推导再校验）；数据块的数据源引用的聚合仍存在
   * （先删引用再删聚合）。
   */
  setAggregations(next: FormAggregation[]): void {
    const normalized = normalizeAggregations(next, { mode: 'submit', regions: this.regions })
    // 数据块 agg 来源的引用完整性（normalizeRegions 内含该校验，这里前置拿到清晰报错）
    normalizeRegions(this.regions, normalized)
    this.applySnapshotEdit(() => {
      this.aggregations = normalized
    })
    this.emit('aggregations-change', undefined)
  }

  /**
   * 重命名聚合：联动改写数据块 agg 数据源、函数表达式里的 `agg.old` 访问与聚合引用
   * 绑定（`kind: 'agg'`）的 aggName。
   */
  renameAggregation(oldName: string, newName: string): void {
    const next = this.aggregations.map((agg) =>
      agg.name === oldName ? { ...agg, name: newName.trim() } : agg,
    )
    const normalized = normalizeAggregations(next)
    normalizeRegions(
      this.regions.map((region) =>
        region.source?.kind === 'agg' && region.source.aggName === oldName
          ? { ...region, source: { ...region.source, aggName: newName.trim() } }
          : region,
      ),
      normalized,
    )
    this.applySnapshotEdit(() => {
      this.aggregations = normalized
      this.regions = this.regions.map((region) =>
        region.source?.kind === 'agg' && region.source.aggName === oldName
          ? { ...region, source: { ...region.source, aggName: newName.trim() } }
          : region,
      )
      // 聚合引用只可能出现在自定义表达式里（结构化 fn 不引用聚合）
      this.rewriteFunctionRefs((payload) => {
        if (payload.kind !== 'expr') return payload
        const expression = rewriteAggRef(payload.expression, oldName, newName.trim())
        return expression === payload.expression ? payload : { kind: 'expr', expression }
      })
      this.rewriteBindingRefs((payload) =>
        isAggBinding(payload) && payload.aggName === oldName
          ? { ...payload, aggName: newName.trim() }
          : payload,
      )
    })
    this.emit('aggregations-change', undefined)
    this.emit('regions-change', undefined)
  }

  // ─── 行高列宽（快照级编辑补齐撤销） ────────────────────────────────────────

  /** 设置行高（height 非正数 = 清除自定义高度）；可撤销 */
  setRowHeight(row: number, height: number): void {
    this.applySnapshotEdit(() => this.sheet.setRowHeight(row, height))
  }

  /** 设置列宽（width 非正数 = 清除自定义宽度）；可撤销 */
  setColWidth(col: number, width: number): void {
    this.applySnapshotEdit(() => this.sheet.setColWidth(col, width))
  }
}
