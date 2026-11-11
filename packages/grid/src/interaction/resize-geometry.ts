// 8 方向 resize 几何单源：方向词汇、轴向符号、指针光标与手柄方块命中。
// FloatObjectLayer 的变换手柄（四角/四边中点 + 旋转）与区域交互（region-interaction
// 的边缘/角落拖拽）共用这份方向语义——两处的命中几何不同（手柄骑在对象边界上 vs
// 区域手柄缩进右下角单元格内、边缘走热区），但「哪条边、动哪个轴、配什么光标」
// 只有一个真相源，避免两套词汇各自漂移。

/** 拖拽命中的边/角（8 方向：四边 + 四角） */
export type ResizeEdge =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

/** 边 → 轴向符号：-1 = 起侧（startRow/startCol，向外拖收缩）、+1 = 止侧、0 = 该轴不动 */
export const EDGE_SIGN: Readonly<Record<ResizeEdge, { sx: -1 | 0 | 1; sy: -1 | 0 | 1 }>> = {
  top: { sx: 0, sy: -1 },
  bottom: { sx: 0, sy: 1 },
  left: { sx: -1, sy: 0 },
  right: { sx: 1, sy: 0 },
  'top-left': { sx: -1, sy: -1 },
  'top-right': { sx: 1, sy: -1 },
  'bottom-left': { sx: -1, sy: 1 },
  'bottom-right': { sx: 1, sy: 1 },
}

/** 边/角 → 鼠标指针样式（对角 nwse/nesw、正边 ns/ew；与主流编辑器同口径） */
export function cursorForEdge(edge: ResizeEdge): string {
  const { sx, sy } = EDGE_SIGN[edge]
  if (sx !== 0 && sy !== 0) return sx === sy ? 'nwse-resize' : 'nesw-resize'
  return sx !== 0 ? 'ew-resize' : 'ns-resize'
}

/** 指针是否落在以 (cx, cy) 为中心的 size 方块内（手柄命中；半开区间 [c-half, c+half)） */
export function hitSquare(x: number, y: number, cx: number, cy: number, size: number): boolean {
  const half = size / 2
  return x >= cx - half && x < cx + half && y >= cy - half && y < cy + half
}
