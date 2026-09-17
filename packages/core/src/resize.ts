// 行列 resize：拖拽手柄命中检测与尺寸计算（纯逻辑，事件接入由 ListTable 完成）。
// canResizeRow 能力（吸收 vtable 补丁行为）：行高调整与列宽调整对称，默认开启、可按行/列关闭。

/** resize 所需的几何快照（视口→内容坐标换算含冻结区与滚动，由调用方注入） */
export interface ResizeGeometry {
  /** 列宽前缀和（内容坐标），length = 列数 + 1 */
  readonly colOffsets: readonly number[]
  /** 行高前缀和（内容坐标），length = 行数 + 1 */
  readonly rowOffsets: readonly number[]
  readonly rowHeaderWidth: number
  readonly headerHeight: number
  /** 视口 x → 内容 x */
  toContentX(x: number): number
  /** 视口 y → 内容 y */
  toContentY(y: number): number
}

export type ResizeTarget =
  | { readonly kind: 'col'; readonly index: number }
  | { readonly kind: 'row'; readonly index: number }

/** 列宽拖拽会话结束事件：列索引与最终宽度（夹取后的生效值） */
export interface ColResizeEndEvent {
  col: number
  width: number
}

/** 行高拖拽会话结束事件：行索引与最终高度（夹取后的生效值） */
export interface RowResizeEndEvent {
  row: number
  height: number
}

export interface ResizeCapability {
  canResizeCol?(col: number): boolean
  canResizeRow?(row: number): boolean
}

export const RESIZE_HANDLE_THRESHOLD = 4
export const MIN_COL_WIDTH = 20
export const MIN_ROW_HEIGHT = 20

/**
 * 阈值带内最近的行/列边缘二分定位：在单调不减的 offsets 中找第一个满足
 * offsets[i+1] >= target 的 i（下界，i ∈ [0, count]）。与线性扫描「首个命中边缘」
 * 逐点等价：更早的边缘都 < target − threshold，不可能落带内。
 */
function firstEdgeAtLeast(offsets: readonly number[], count: number, target: number): number {
  let lo = 0
  let hi = count
  while (lo < hi) {
    const mid = lo + ((hi - lo) >> 1)
    if ((offsets[mid + 1] ?? 0) < target) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

/**
 * 命中 resize 手柄：列手柄在列头区的列右缘，行手柄在行号列区的行下缘。
 * 返回 null 表示未命中或该行列被 canResize 能力禁止。
 */
export function hitResizeHandle(
  x: number,
  y: number,
  geo: ResizeGeometry,
  capability: ResizeCapability = {},
  threshold = RESIZE_HANDLE_THRESHOLD,
): ResizeTarget | null {
  // 列手柄：指针在列头带内，接近某列右缘的视口位置
  if (y >= 0 && y <= geo.headerHeight && x >= geo.rowHeaderWidth) {
    const contentX = geo.toContentX(x)
    const colCount = geo.colOffsets.length - 1
    const first = firstEdgeAtLeast(geo.colOffsets, colCount, contentX - threshold)
    if (first < colCount && (geo.colOffsets[first + 1] ?? 0) <= contentX + threshold) {
      if (capability.canResizeCol && !capability.canResizeCol(first)) {
        return null
      }
      return { kind: 'col', index: first }
    }
  }
  // 行手柄：指针在行号列带内，接近某行下缘的视口位置
  if (x >= 0 && x <= geo.rowHeaderWidth && y >= geo.headerHeight) {
    const contentY = geo.toContentY(y)
    const rowCount = geo.rowOffsets.length - 1
    const first = firstEdgeAtLeast(geo.rowOffsets, rowCount, contentY - threshold)
    if (first < rowCount && (geo.rowOffsets[first + 1] ?? 0) <= contentY + threshold) {
      if (capability.canResizeRow && !capability.canResizeRow(first)) {
        return null
      }
      return { kind: 'row', index: first }
    }
  }
  return null
}

/** 一次拖拽 resize 会话：记录起始尺寸，按指针位移给出夹取后的目标尺寸 */
export class ResizeSession {
  private readonly startSize: number

  constructor(
    readonly target: ResizeTarget,
    startSize: number,
    private readonly startPointer: number,
  ) {
    this.startSize = startSize
  }

  /** pointer 为拖拽轴向上的当前视口坐标（列取 x，行取 y） */
  sizeAt(pointer: number): number {
    const min = this.target.kind === 'col' ? MIN_COL_WIDTH : MIN_ROW_HEIGHT
    return Math.max(min, this.startSize + (pointer - this.startPointer))
  }
}
