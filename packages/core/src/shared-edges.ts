// 共享边冲突裁决（纯函数，可单测）：相邻格各设对侧边时，一条共享边只画一次。
// 所有权模型（对齐 VTable cellBorderClipDirection: 'bottom-right'）：
// 共享竖边归左格（其 right）、共享横边归上格（其 bottom）；非所有者不画该边，
// 其显式边经 facing 溯源由所有者代为呈现。
// 已知 nuance：所有者在可视窗口外时（滚出），邻居的显式对侧边暂不显示——
// 与视口边缘本就无对侧网格线的表现同级，可接受。

import type { CellBorder, CellBorderEdge } from './cell-style'

/**
 * 共享边裁决的对侧边输入：邻居格看向本格的边。
 * right = 右邻居的 left 边（本格 right 共享边的对侧）；bottom = 下邻居的 top 边。
 * 无邻居（模型最右列/最下行）或邻居该边未设置为 undefined。
 */
export interface FacingEdges {
  right?: CellBorderEdge
  bottom?: CellBorderEdge
}

/** 生效绘制四边的边界条件：模型最左列/最上行（无同带左/上邻居）才画自己的 left/top */
export interface EdgeBoundary {
  firstCol: boolean
  firstRow: boolean
}

/**
 * 两边取强：显式边（无 grid 标记）恒胜网格派生边；同档宽者胜；等宽取前者（own）。
 * 调用方把「所有者自己的边」放前参，等宽时确定性取所有者。
 * 也用于合并格区域外邻居逐格对侧边的归约（等宽取先扫描到的，结果确定）。
 */
export function strongerEdge(
  own: CellBorderEdge | undefined,
  facing: CellBorderEdge | undefined,
): CellBorderEdge | undefined {
  if (!own) {
    return facing
  }
  if (!facing) {
    return own
  }
  const ownExplicit = own.grid !== true
  const facingExplicit = facing.grid !== true
  if (ownExplicit !== facingExplicit) {
    return ownExplicit ? own : facing
  }
  if (own.width !== facing.width) {
    return own.width > facing.width ? own : facing
  }
  return own
}

/**
 * 共享边裁决：输入本格投影样式四边 + 右/下邻居对侧边，输出本格实际绘制的四边。
 * - right/bottom：本格为所有者，画 stronger(自己的边, 邻居对侧边)；
 * - left/top：非所有者不画（由左/上邻居的 right/bottom 呈现）；
 *   仅 boundary 标记的最左列/最上行画自己的 left/top；
 * - 输出不做拷贝（胜出的边对象原引用返回，样式对象按不可变约定使用）；
 *   四边皆无时返回 undefined。
 */
export function resolveSharedEdges(
  border: CellBorder | undefined,
  facing: FacingEdges,
  boundary: EdgeBoundary,
): CellBorder | undefined {
  const right = strongerEdge(border?.right, facing.right)
  const bottom = strongerEdge(border?.bottom, facing.bottom)
  const left = boundary.firstCol ? border?.left : undefined
  const top = boundary.firstRow ? border?.top : undefined
  if (!left && !right && !bottom && !top) {
    return undefined
  }
  return { top, right, bottom, left }
}
