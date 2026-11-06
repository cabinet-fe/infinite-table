import {
  Sheet,
  TypedEventEmitter,
  type CellAddress,
  type CellRange,
  type SheetSnapshot,
} from '@infinitable/sheet'

import {
  FORM_BINDING_META_NAMESPACE,
  TEMPLATE_SCHEMA_VERSION,
  migrateTemplateV1,
  normalizeRegions,
  templateCols,
  templateRows,
  type FormCellBinding,
  type FormRegion,
  type FormTemplate,
  type RegionExpand,
} from './template'
import { deleteSnapshotRows, insertSnapshotRows } from './snapshot-rows'

/**
 * 设计文档 = Sheet 模型 + 区域注册表 + 统一 undo 门面。
 *
 * 撤销链路口径（app 内测试覆盖）：
 * - 格值/样式/合并/绑定 sidecar 一律走 Sheet 命令系统（样式池落地，天然可撤销），
 *   画布键入、工具栏命令同链；
 * - 区域结构（增删/改范围/展开方式）与行高列宽不在 Sheet undo 覆盖内（行列结构命令
 *   无法携带区域注册表、行高列宽明确不进 undo），经「快照纯变换 + 静默 restore」
 *   落地，由 DocHistory 以快照条目补齐撤销；
 * - DocHistory 惰性观测 sheet.undoSize：新编辑（无论来源）清空重做栈，撤销先走
 *   sheet 历史、耗尽到快照条目记录深度再弹快照条目——两套来源交错成单条撤销链。
 */

/** 文档快照（DocHistory 条目载荷；深拷贝隔离，restore 不回写） */
interface DocCapture {
  regions: FormRegion[]
  cols: number
  sheet: SheetSnapshot
}

export interface DocHistoryState {
  canUndo: boolean
  canRedo: boolean
}

export type FormDocEvents = {
  /** 区域结构变化（区域面板重渲染；画布行数变化需重建网格） */
  'regions-change': undefined
  /** 撤销链变化（工具栏按钮置灰；画布按行数变化决定重建或就地重绘） */
  'history-change': DocHistoryState
}

/** 区域操作参数：目标区域下标越界时抛错（面板禁用已保证，防御性兜底） */
function regionAt(regions: readonly FormRegion[], index: number): FormRegion {
  const region = regions[index]
  if (!region) throw new Error(`区域下标越界: ${index}`)
  return region
}

/** 深拷贝文档快照（structuredClone 对 JSON 形态快照足够） */
function captureDoc(doc: FormDoc): DocCapture {
  return {
    regions: structuredClone(doc.regions),
    cols: doc.cols,
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
export class DocHistory {
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
  cols: number

  private constructor(sheet: Sheet, regions: FormRegion[], cols: number) {
    super()
    this.sheet = sheet
    this.regions = regions
    this.cols = cols
    this.history = new DocHistory(this, (state) => this.emit('history-change', state))
  }

  /** 画布总行数（区域最大 endRow + 1） */
  get rows(): number {
    return templateRows(this.regions)
  }

  /** 画布总列数（声明列数与区域最大 endCol + 1 的较大者） */
  get effectiveCols(): number {
    return templateCols(this.regions, this.cols)
  }

  /** 新建空白文档：默认只给一个全宽 3 行区域（不再有五类骨架） */
  static create(cols = 8): FormDoc {
    const regions: FormRegion[] = [
      { startRow: 0, endRow: 2, startCol: 0, endCol: cols - 1, expand: 'none' },
    ]
    const doc = new FormDoc(new Sheet('form'), regions, cols)
    doc.sheet.ensureTableSize(3, cols)
    return doc
  }

  /** 从模板 JSON 还原文档（schemaVersion 1 自动迁移到 v2） */
  static fromTemplate(
    input: FormTemplate | (Record<string, unknown> & { schemaVersion?: number }),
  ): FormDoc {
    const template: FormTemplate =
      input.schemaVersion === 1 ? migrateTemplateV1(input as never) : (input as FormTemplate)
    const declaredCols = template.cols
    // 越界上界：行数由区域自身决定（空白快照 rows=0 时区域即表格大小），
    // 列数必须落在模板声明（或快照声明）的宽度内——超宽说明模板数据本身有问题
    const limitRows = Math.max(template.sheet.rows, templateRows(template.regions))
    const limitCols = Math.max(template.sheet.cols, declaredCols)
    const regions = normalizeRegions(template.regions, limitRows, limitCols)
    const rows = templateRows(regions)
    const cols = templateCols(regions, declaredCols)
    const doc = new FormDoc(new Sheet('form'), regions, declaredCols)
    doc.sheet.restore(template.sheet)
    doc.sheet.ensureTableSize(rows, cols)
    return doc
  }

  /** 序列化为模板 JSON（区域 + 画布快照） */
  toTemplate(name: string): FormTemplate {
    return {
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name,
      regions: structuredClone(this.regions),
      cols: this.cols,
      sheet: this.sheet.snapshot(),
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
    this.cols = capture.cols
    if (changed) this.emit('regions-change', undefined)
  }

  // ─── 区域结构操作 ──────────────────────────────────────────────────────────

  /**
   * 在现有区域最下方添加一个全宽区域（默认 3 行）。
   * 需要时扩行（insertSnapshotRows）并同步行数——区域之外的行就是普通静态内容。
   */
  addRegion(rows = 3): FormRegion {
    const startRow = templateRows(this.regions)
    const region: FormRegion = {
      startRow,
      endRow: startRow + rows - 1,
      startCol: 0,
      endCol: this.cols - 1,
      expand: 'none',
    }
    this.applySnapshotEdit(() => {
      this.sheet.restore(insertSnapshotRows(this.sheet.snapshot(), startRow, rows))
      this.regions = [...this.regions, region]
    })
    this.emit('regions-change', undefined)
    return region
  }

  /** 删除区域标记（只删注册表项，画布内容保留——用户手画的东西不能误删） */
  removeRegion(index: number): void {
    regionAt(this.regions, index)
    this.applySnapshotEdit(() => {
      this.regions = this.regions.filter((_, i) => i !== index)
    })
    this.emit('regions-change', undefined)
  }

  /** 设置展开方式（`down` / `right` 各最多一个，超限抛错） */
  setRegionExpand(index: number, expand: RegionExpand): void {
    regionAt(this.regions, index)
    if (expand !== 'none') {
      const existing = this.regions.findIndex((r, i) => i !== index && r.expand === expand)
      if (existing >= 0) {
        const label = expand === 'down' ? '向下展开' : '向右展开'
        throw new Error(`已经有区域 ${existing + 1} 在「${label}」了：同一模板只能有一个`)
      }
    }
    this.applySnapshotEdit(() => {
      this.regions = this.regions.map((r, i) => (i === index ? { ...r, expand } : r))
    })
    this.emit('regions-change', undefined)
  }

  /** 改区域范围/重复标记（越界、重叠抛错；不移动画布内容、不允许借此撑大表格） */
  setRegionFields(index: number, patch: Partial<Omit<FormRegion, 'expand'>>): void {
    const next = this.regions.map((region, i) => (i === index ? { ...region, ...patch } : region))
    // 上界 = 当前表格尺寸（改范围只重新框选，不扩表）
    const normalized = normalizeRegions(next, this.rows, this.effectiveCols)
    this.applySnapshotEdit(() => {
      this.regions = normalized
    })
    this.emit('regions-change', undefined)
  }

  /** 调整区域行数：变高在区域底部插空行、变矮删底行（内容留原处）；可撤销 */
  resizeRegionRows(index: number, rows: number): void {
    const region = regionAt(this.regions, index)
    const delta = rows - (region.endRow - region.startRow + 1)
    if (rows < 1 || delta === 0) return
    const at = delta > 0 ? region.endRow + 1 : region.endRow + delta + 1
    // 行区调整后不得与其它区域重叠（下方区域起点可能被吃进来）
    const next = this.regions.map((r, i) => ({
      ...r,
      startRow: r.startRow + (i > index ? delta : 0),
      endRow: r.endRow + (i >= index ? delta : 0),
    }))
    const normalized = normalizeRegions(next, Math.max(this.rows + delta, 1), this.effectiveCols)
    this.applySnapshotEdit(() => {
      const op = delta > 0 ? insertSnapshotRows : deleteSnapshotRows
      this.sheet.restore(op(this.sheet.snapshot(), at, Math.abs(delta)))
      this.regions = normalized
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

/** 选区规范化（工具栏操作取 min/max 包围盒；模型 CellRange 语义无关方向） */
export function normalizeRange(range: CellRange): CellRange {
  return {
    start: {
      row: Math.min(range.start.row, range.end.row),
      col: Math.min(range.start.col, range.end.col),
    },
    end: {
      row: Math.max(range.start.row, range.end.row),
      col: Math.max(range.start.col, range.end.col),
    },
  }
}
