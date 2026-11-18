import { createRange, type CellAddress, type SheetRange } from './address'
import { TypedEventEmitter } from './events'

/**
 * 选区模型：activeCell + ranges。
 * activeCell 永远指向锚点（构造时注入 resolveAnchor）。
 */

export interface SheetSelectionState {
  /** 活动单元格（锚点语义）；未选中时为 null */
  activeCell: CellAddress | null
  /** 选中区域列表（本阶段单选区，预留多选区） */
  ranges: SheetRange[]
}

type SelectionEvents = { change: SheetSelectionState }

export class SelectionModel {
  private state: SheetSelectionState = { activeCell: null, ranges: [] }
  private emitter = new TypedEventEmitter<SelectionEvents>()

  constructor(
    private readonly resolveAnchor: (addr: CellAddress) => CellAddress,
    private readonly resolveRange?: (addr: CellAddress) => SheetRange,
  ) {}

  get activeCell(): CellAddress | null {
    return this.state.activeCell
  }

  get ranges(): SheetRange[] {
    return this.state.ranges
  }

  /** 选中单格；被覆盖格自动解析到锚点并扩展至合并区域完整范围 */
  selectCell(addr: CellAddress): void {
    const anchor = this.resolveAnchor(addr)
    const range = this.resolveRange ? this.resolveRange(addr) : createRange(anchor, anchor)
    this.setState({ activeCell: anchor, ranges: [range] })
  }

  /**
   * 选中区域。
   * `active` 缺省为区域起点锚点；整行/整列头点击可传入视口边缘格作为活动格
   * （与 Excel 一致：选区仍为整行/列，锚点落在当前可见边缘）。
   */
  selectRange(range: SheetRange, active?: CellAddress): void {
    const normalized = createRange(range.start, range.end)
    let anchor = this.resolveAnchor(active ?? normalized.start)
    anchor = {
      row: Math.min(Math.max(anchor.row, normalized.start.row), normalized.end.row),
      col: Math.min(Math.max(anchor.col, normalized.start.col), normalized.end.col),
    }
    anchor = this.resolveAnchor(anchor)
    this.setState({ activeCell: anchor, ranges: [normalized] })
  }

  getState(): SheetSelectionState {
    return {
      activeCell: this.state.activeCell ? { ...this.state.activeCell } : null,
      ranges: this.state.ranges.map((range) => ({
        start: { ...range.start },
        end: { ...range.end },
      })),
    }
  }

  /**
   * 静默写入选区（`Sheet.restore` 用）。
   * 不发 change——restore 语义是全量重置后由调用方重建 grid，选区由构造回驱接管。
   */
  restoreState(state: SheetSelectionState): void {
    this.state = {
      activeCell: state.activeCell ? { ...state.activeCell } : null,
      ranges: state.ranges.map((range) => ({ start: { ...range.start }, end: { ...range.end } })),
    }
  }

  on(handler: (state: SheetSelectionState) => void): () => void {
    return this.emitter.on('change', handler)
  }

  private setState(state: SheetSelectionState): void {
    // 相等性去重：重复点击同一格/同区域不 emit（#24）——grid 全量选区回驱、
    // 公式栏刷新、工具栏 stateTick 都是重活，无变化时全部跳过
    if (selectionEqual(this.state, state)) return
    this.state = state
    this.emitter.emit('change', this.getState())
  }
}

/** 选区状态相等（activeCell + ranges 深比较） */
function selectionEqual(a: SheetSelectionState, b: SheetSelectionState): boolean {
  if (a.activeCell == null || b.activeCell == null) {
    return a.activeCell === b.activeCell
  }
  if (a.activeCell.row !== b.activeCell.row || a.activeCell.col !== b.activeCell.col) return false
  if (a.ranges.length !== b.ranges.length) return false
  for (let i = 0; i < a.ranges.length; i++) {
    const ra = a.ranges[i]!
    const rb = b.ranges[i]!
    if (
      ra.start.row !== rb.start.row ||
      ra.start.col !== rb.start.col ||
      ra.end.row !== rb.end.row ||
      ra.end.col !== rb.end.col
    ) {
      return false
    }
  }
  return true
}
