import {
  Sheet,
  TypedEventEmitter,
  type CellAddress,
  type CellRange,
  type SheetSnapshot,
} from '@infinitable/sheet'

import {
  DEFAULT_BAND_ROWS,
  FORM_BINDING_META_NAMESPACE,
  TEMPLATE_SCHEMA_VERSION,
  templateRows,
  type BandKind,
  type FormBand,
  type FormCellBinding,
  type FormTemplate,
} from './template'
import { deleteSnapshotRows, insertSnapshotRows, swapSnapshotRowBlocks } from './snapshot-rows'

/**
 * 设计文档 = Sheet 模型 + 区域注册表 + 统一 undo 门面。
 *
 * 撤销链路口径（app 内测试覆盖）：
 * - 格值/样式/合并/绑定 sidecar 一律走 Sheet 命令系统（样式池落地，天然可撤销），
 *   画布键入、工具栏命令同链；
 * - 区域结构（增删/排序/标记明细）与行高列宽不在 Sheet undo 覆盖内（行列结构命令
 *   无法携带区域注册表、行高列宽明确不进 undo），经「快照纯变换 + 静默 restore」
 *   落地，由 DocHistory 以快照条目补齐撤销；
 * - DocHistory 惰性观测 sheet.undoSize：新编辑（无论来源）清空重做栈，撤销先走
 *   sheet 历史、耗尽到快照条目记录深度再弹快照条目——两套来源交错成单条撤销链。
 */

/** 文档快照（DocHistory 条目载荷；深拷贝隔离，restore 不回写） */
interface DocCapture {
  bands: FormBand[]
  cols: number
  sheet: SheetSnapshot
}

export interface DocHistoryState {
  canUndo: boolean
  canRedo: boolean
}

export type FormDocEvents = {
  /** 区域结构/类型变化（区域面板重渲染；画布行数变化需重建网格） */
  'bands-change': undefined
  /** 撤销链变化（工具栏按钮置灰；画布按行数变化决定重建或就地重绘） */
  'history-change': DocHistoryState
}

/** 区域操作参数：目标区域下标越界时抛错（面板禁用已保证，防御性兜底） */
function bandAt(bands: readonly FormBand[], index: number): FormBand {
  const band = bands[index]
  if (!band) throw new Error(`区域下标越界: ${index}`)
  return band
}

/** 深拷贝文档快照（structuredClone 对 JSON 形态快照足够） */
function captureDoc(doc: FormDoc): DocCapture {
  return {
    bands: structuredClone(doc.bands),
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
  bands: FormBand[]
  cols: number

  private constructor(sheet: Sheet, bands: FormBand[], cols: number) {
    super()
    this.sheet = sheet
    this.bands = bands
    this.cols = cols
    this.history = new DocHistory(this, (state) => this.emit('history-change', state))
  }

  /** 画布总行数（区域行区合计） */
  get rows(): number {
    return templateRows(this.bands)
  }

  /** 新建空文档（默认五类区域骨架；内容为空，内置起点模板在后续阶段注入） */
  static create(cols = 8): FormDoc {
    const bands: FormBand[] = []
    let row = 0
    for (const kind of ['pageHeader', 'info', 'detail', 'summary', 'signature'] as const) {
      const count = DEFAULT_BAND_ROWS[kind]
      bands.push({ kind, startRow: row, endRow: row + count - 1 })
      row += count
    }
    const doc = new FormDoc(new Sheet('form'), bands, cols)
    doc.sheet.ensureTableSize(row, cols)
    return doc
  }

  /** 从模板 JSON 还原文档（P5 持久化加载共用入口） */
  static fromTemplate(template: FormTemplate): FormDoc {
    const bands = normalizeBands(template.bands)
    const doc = new FormDoc(new Sheet('form'), bands, template.cols)
    doc.sheet.restore(template.sheet)
    doc.sheet.ensureTableSize(doc.rows, template.cols)
    return doc
  }

  /** 序列化为模板 JSON（区域 + 画布快照；P5 保存共用入口） */
  toTemplate(name: string): FormTemplate {
    return {
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name,
      bands: structuredClone(this.bands),
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
   * 能力保留）+ 重建区域注册表；区域有变时补发 bands-change 驱动面板与画布同步。
   * @internal 仅供本模块 DocHistory 回放调用，业务代码不要直接调
   */
  restoreCapture(capture: DocCapture): void {
    this.sheet.restore(capture.sheet)
    const changed = JSON.stringify(this.bands) !== JSON.stringify(capture.bands)
    this.bands = structuredClone(capture.bands)
    this.cols = capture.cols
    if (changed) this.emit('bands-change', undefined)
  }

  // ─── 区域结构操作 ──────────────────────────────────────────────────────────

  /** 在指定区域下方插入新区域（index 缺省追加到末尾；返回新区域） */
  addBand(kind: BandKind, index?: number, rows = DEFAULT_BAND_ROWS[kind]): FormBand {
    const at = index === undefined ? this.bands.length - 1 : index
    const anchor = bandAt(this.bands, at)
    const insertAt = anchor.endRow + 1
    this.applySnapshotEdit(() => {
      const snapshot = insertSnapshotRows(this.sheet.snapshot(), insertAt, rows)
      this.sheet.restore(snapshot)
      this.bands = insertBandRange(this.bands, insertAt, rows, kind)
    })
    const band = bandAtRowStrict(this.bands, insertAt)
    this.emit('bands-change', undefined)
    return band
  }

  /** 删除指定区域（其行区整体移除，下方区域上移）；最后一个区域不可删 */
  removeBand(index: number): void {
    const band = bandAt(this.bands, index)
    if (this.bands.length <= 1) throw new Error('模板至少保留一个区域')
    this.applySnapshotEdit(() => {
      const snapshot = deleteSnapshotRows(
        this.sheet.snapshot(),
        band.startRow,
        band.endRow - band.startRow + 1,
      )
      this.sheet.restore(snapshot)
      this.bands = removeBandRange(this.bands, index)
    })
    this.emit('bands-change', undefined)
  }

  /** 区域上移/下移一位（相邻交换，内容随行块整体平移） */
  moveBand(index: number, dir: -1 | 1): void {
    const target = index + dir
    if (target < 0 || target >= this.bands.length) return
    const first = dir === -1 ? target : index
    const second = dir === -1 ? index : target
    const firstBand = bandAt(this.bands, first)
    const secondBand = bandAt(this.bands, second)
    this.applySnapshotEdit(() => {
      const snapshot = swapSnapshotRowBlocks(
        this.sheet.snapshot(),
        { start: firstBand.startRow, count: firstBand.endRow - firstBand.startRow + 1 },
        { start: secondBand.startRow, count: secondBand.endRow - secondBand.startRow + 1 },
      )
      this.sheet.restore(snapshot)
      this.bands = swapBands(this.bands, first, second)
    })
    this.emit('bands-change', undefined)
  }

  /** 更改区域类型（标记/取消明细等；纯注册表变更，同样可撤销） */
  setBandKind(index: number, kind: BandKind): void {
    this.applySnapshotEdit(() => {
      this.bands = this.bands.map((band, i) => (i === index ? { ...band, kind } : band))
    })
    this.emit('bands-change', undefined)
  }

  /** 调整区域行数：变高补底部空行、变矮删底行（内容留原处）；可撤销 */
  resizeBand(index: number, rows: number): void {
    const band = bandAt(this.bands, index)
    const delta = rows - (band.endRow - band.startRow + 1)
    if (rows < 1 || delta === 0) return
    const at = delta > 0 ? band.endRow + 1 : band.endRow + delta + 1
    const op = delta > 0 ? insertSnapshotRows : deleteSnapshotRows
    this.applySnapshotEdit(() => {
      this.sheet.restore(op(this.sheet.snapshot(), at, Math.abs(delta)))
      // 行区恒首尾相接：本区域起 endRow 平移，其后区域 startRow 也平移
      this.bands.forEach((b, i) => {
        b.endRow += i >= index ? delta : 0
        if (i > index) b.startRow += delta
      })
    })
    this.emit('bands-change', undefined)
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

  // ─── 绑定 sidecar（P6 绑定编辑写入；模型口径） ──────────────────────────────

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

// ─── 区域注册表纯变换 ────────────────────────────────────────────────────────

function bandRowCount(band: FormBand): number {
  return band.endRow - band.startRow + 1
}

/** 在 insertAt 行处插入新区域行区，既有区域行区平移（调用方保证 insertAt 为区域边界或末尾） */
function insertBandRange(
  bands: FormBand[],
  insertAt: number,
  rows: number,
  kind: BandKind,
): FormBand[] {
  const next: FormBand[] = []
  let inserted = false
  for (const band of bands) {
    if (band.startRow >= insertAt) {
      if (!inserted) {
        next.push({ kind, startRow: insertAt, endRow: insertAt + rows - 1 })
        inserted = true
      }
      next.push({ ...band, startRow: band.startRow + rows, endRow: band.endRow + rows })
    } else {
      next.push({ ...band })
    }
  }
  if (!inserted) next.push({ kind, startRow: insertAt, endRow: insertAt + rows - 1 })
  return next
}

/** 移除下标区域，下方区域上移 */
function removeBandRange(bands: FormBand[], index: number): FormBand[] {
  const removed = bandAt(bands, index)
  const rows = bandRowCount(removed)
  return bands
    .filter((_, i) => i !== index)
    .map((band) =>
      band.startRow > removed.startRow
        ? { ...band, startRow: band.startRow - rows, endRow: band.endRow - rows }
        : { ...band },
    )
}

/** 交换相邻区域（数组顺序对调，行区按行块交换后重算） */
function swapBands(bands: FormBand[], first: number, second: number): FormBand[] {
  const a = bandAt(bands, first)
  const b = bandAt(bands, second)
  const aRows = bandRowCount(a)
  const bRows = bandRowCount(b)
  const base = a.startRow
  const next = bands.map((band) => ({ ...band }))
  // first 位换成原 second 区域（内容已随行块上移到 base 起）
  next[first] = { ...b, startRow: base, endRow: base + bRows - 1 }
  // second 位换成原 first 区域（内容已随行块下移到其后）
  next[second] = { ...a, startRow: base + bRows, endRow: base + bRows + aRows - 1 }
  return next
}

/** 行号所在区域（存在性断言版；区域行区连续覆盖时恒命中） */
function bandAtRowStrict(bands: FormBand[], row: number): FormBand {
  const band = bands.find((item) => row >= item.startRow && row <= item.endRow)
  if (!band) throw new Error(`行 ${row} 不属于任何区域`)
  return band
}

/** 规范化模板区域（校验行区连续覆盖；供 fromTemplate 入口把关） */
function normalizeBands(bands: FormBand[]): FormBand[] {
  if (bands.length === 0) throw new Error('模板至少需要一个区域')
  const normalized = bands.map((band) => ({ ...band }))
  let expect = 0
  for (const band of normalized) {
    if (band.startRow !== expect) {
      throw new Error(`区域行区不连续：期望起始 ${expect}，实际 ${band.startRow}`)
    }
    if (band.endRow < band.startRow)
      throw new Error(`区域行区非法：${band.startRow} > ${band.endRow}`)
    expect = band.endRow + 1
  }
  return normalized
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
