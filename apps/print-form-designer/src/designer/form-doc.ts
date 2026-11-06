import {
  Sheet,
  TypedEventEmitter,
  type CellAddress,
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
  regionsWithName,
  regionsWithSource,
} from './region-ops'
import { deleteSnapshotRows, insertSnapshotRows } from './snapshot-rows'
import {
  FORM_BINDING_META_NAMESPACE,
  TEMPLATE_SCHEMA_VERSION,
  normalizeRegions,
  stripOrphanSources,
  type FormCellBinding,
  type FormRegion,
  type FormTemplate,
  type RegionExpand,
  type RegionSource,
} from './template'

/**
 * 设计文档 = Sheet 模型 + 区域注册表 + 统一 undo 门面。
 *
 * 画布尺寸口径（无限画布）：**没有声明行列数**。行列数一律由内容包围盒推导
 * （content-bounds.ts），序列化时把 sheet 快照收紧到包围盒——引擎 growOnScroll
 * 撑出的上百行空行不进模板，round-trip 幂等。
 *
 * 撤销链路口径（app 内测试覆盖）：
 * - 格值/样式/合并/绑定 sidecar 一律走 Sheet 命令系统（样式池落地，天然可撤销），
 *   画布键入、工具栏命令同链；
 * - 区域结构（增删/改范围/展开方式/数据源/名称）与行高列宽不在 Sheet undo 覆盖内
 *   （行列结构命令无法携带区域注册表、行高列宽明确不进 undo），经「快照纯变换 +
 *   静默 restore」落地，由 DocHistory 以快照条目补齐撤销；
 * - DocHistory 惰性观测 sheet.undoSize：新编辑（无论来源）清空重做栈，撤销先走
 *   sheet 历史、耗尽到快照条目记录深度再弹快照条目——两套来源交错成单条撤销链。
 */

/** 文档快照（DocHistory 条目载荷；深拷贝隔离，restore 不回写） */
interface DocCapture {
  regions: FormRegion[]
  sheet: SheetSnapshot
}

export interface DocHistoryState {
  canUndo: boolean
  canRedo: boolean
}

type FormDocEvents = {
  /** 区域结构变化（区域面板重渲染；画布区域描边同步） */
  'regions-change': undefined
  /** 撤销链变化（工具栏按钮置灰；画布按几何/合并变化决定重建或就地重绘） */
  'history-change': DocHistoryState
}

/** 深拷贝文档快照（structuredClone 对 JSON 形态快照足够） */
function captureDoc(doc: FormDoc): DocCapture {
  return {
    regions: structuredClone(doc.regions),
    sheet: doc.sheet.snapshot(),
  }
}

// ─── 统一 undo 门面 ──────────────────────────────────────────────────────────

/**
 * 撤销门面：sheet 命令历史（值/样式/合并/meta）+ 快照条目（区域结构/行高列宽）
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

  /** 记录一次快照级编辑（区域结构/行高列宽；before/after 均为深拷贝） */
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

  private constructor(sheet: Sheet, regions: FormRegion[]) {
    super()
    this.sheet = sheet
    this.regions = regions
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
   * 新建空白文档：给一个全宽 3 行区域（宽度由 `cols` 指定）。
   * `cols` 只是这块起始区域的宽度——画布本身没有声明尺寸（引擎按视口给足，
   * 序列化时按内容包围盒收紧）。
   */
  static create(cols: number): FormDoc {
    const regions: FormRegion[] = [
      { startRow: 0, endRow: 2, startCol: 0, endCol: cols - 1, expand: 'none' },
    ]
    return new FormDoc(new Sheet('form'), regions)
  }

  /**
   * 从模板 JSON 还原文档：只认当前 schema 版本。
   * 类型上的 `schemaVersion` 是字面量，但载荷来自网络/手改 JSON，因此运行期再判一次；
   * 不是当前版本直接抛错，不做迁移、不兜底。
   */
  static fromTemplate(input: FormTemplate): FormDoc {
    if (input.schemaVersion !== TEMPLATE_SCHEMA_VERSION) {
      const expected = String(TEMPLATE_SCHEMA_VERSION)
      throw new Error(`模板 schemaVersion 必须是 ${expected}：${String(input.schemaVersion)}`)
    }
    // 加载边界：不展开区域上残留的数据源在这里清除（模板里不留无效配置）
    const regions = normalizeRegions(stripOrphanSources(input.regions))
    const doc = new FormDoc(new Sheet('form'), regions)
    const sheet = input.sheet
    doc.sheet.restore(clampSnapshotToBounds(sheet, contentBounds(sheet, regions)))
    return doc
  }

  /** 序列化为模板 JSON（区域 + 画布快照；快照行列数收紧到内容包围盒） */
  toTemplate(name: string): FormTemplate {
    const snapshot = this.sheet.snapshot()
    return {
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name,
      // 序列化边界归一：不展开区域上残留的数据源在这里被清除，模板里不留无效配置
      regions: normalizeRegions(stripOrphanSources(this.regions)),
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
   * 能力保留）+ 重建区域注册表；区域有变时补发 regions-change 驱动面板与画布同步。
   * @internal 仅供本模块 DocHistory 回放调用，业务代码不要直接调
   */
  restoreCapture(capture: DocCapture): void {
    this.sheet.restore(capture.sheet)
    const changed = JSON.stringify(this.regions) !== JSON.stringify(capture.regions)
    this.regions = structuredClone(capture.regions)
    if (changed) this.emit('regions-change', undefined)
  }

  // ─── 区域结构操作 ──────────────────────────────────────────────────────────

  /**
   * 在内容包围盒最下方追加一个全宽区域（行数由 `rows` 指定）。
   * 追加位置在既有内容之后，因此不移动画布内容、也不需要插行。
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
    this.commitRegions([...this.regions, region])
    return region
  }

  /**
   * 选区 → 区域（无限画布下的主入口）：把一块矩形框成新区域。
   * 任一格落在既有区域内即拒绝——一个格子不能属于两个区域。
   */
  createRegionFromRange(
    range: CellRange,
    options: { name?: string; expand?: RegionExpand; source?: RegionSource },
  ): FormRegion {
    const rect: FormRegion = {
      startRow: Math.min(range.start.row, range.end.row),
      endRow: Math.max(range.start.row, range.end.row),
      startCol: Math.min(range.start.col, range.end.col),
      endCol: Math.max(range.start.col, range.end.col),
      expand: options.expand ?? 'none',
      ...(options.name?.trim() ? { name: options.name.trim() } : {}),
      ...(options.source ? { source: options.source } : {}),
    }
    const next = appendRegionRect(this.regions, rect)
    this.commitRegions(next)
    return next[next.length - 1]!
  }

  /** 删除区域标记（只删注册表项，画布内容保留——用户手画的东西不能误删） */
  removeRegion(index: number): void {
    regionAt(this.regions, index)
    this.commitRegions(this.regions.filter((_, i) => i !== index))
  }

  /** 设置展开方式（`down` / `right` 各最多一个；改非 none 前必须已声明数据源） */
  setRegionExpand(index: number, expand: RegionExpand): void {
    this.commitRegions(regionsWithExpand(this.regions, index, expand))
  }

  /**
   * 设置/替换区域数据源（展开分区数的唯一来源）。
   * 展开中的区域不允许清空数据源（否则份数无据可依），调用方应先改回 `none`。
   */
  setRegionSource(index: number, source: RegionSource | undefined): void {
    this.commitRegions(regionsWithSource(this.regions, index, source))
  }

  /** 重命名区域（空名 = 回到缺省的「区域 N」） */
  renameRegion(index: number, name: string): void {
    this.commitRegions(regionsWithName(this.regions, index, name))
  }

  /**
   * 改区域范围/名称/重复标记（不移动画布内容）。
   * 无限画布下没有表格尺寸上界：只校验非负、start ≤ end、不与其它区域重叠。
   */
  setRegionFields(index: number, patch: Partial<Omit<FormRegion, 'expand'>>): void {
    this.commitRegions(regionsWithFields(this.regions, index, patch))
  }

  /** 调整区域行数：变高在区域底部插空行、变矮删底行（内容留原处）；可撤销 */
  resizeRegionRows(index: number, rows: number): void {
    const plan = planRegionRowResize(this.regions, index, rows)
    if (!plan) return
    this.applySnapshotEdit(() => {
      const op = plan.delta > 0 ? insertSnapshotRows : deleteSnapshotRows
      this.sheet.restore(op(this.sheet.snapshot(), plan.at, Math.abs(plan.delta)))
      this.regions = plan.regions
    })
    this.emit('regions-change', undefined)
  }

  /** 区域序列的落点：走撤销门面 + 补发变更信号（所有区域结构操作的唯一出口） */
  private commitRegions(next: FormRegion[]): void {
    this.applySnapshotEdit(() => {
      this.regions = next
    })
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

  // ─── 绑定 sidecar（模型口径） ──────────────────────────────────────────────

  /** 读取格绑定（合并格解析锚点）；未绑定返回 undefined */
  getCellBinding(addr: CellAddress): FormCellBinding | undefined {
    return this.sheet.getCellMeta<FormCellBinding>(addr, FORM_BINDING_META_NAMESPACE)
  }

  /** 写入/清除格绑定（经 cell-meta 命令，sheet 历史内可撤销） */
  setCellBinding(addr: CellAddress, binding: FormCellBinding | null): void {
    if (binding) this.sheet.setCellMeta(addr, FORM_BINDING_META_NAMESPACE, binding)
    else this.sheet.clearCellMeta(addr, FORM_BINDING_META_NAMESPACE)
  }
}
