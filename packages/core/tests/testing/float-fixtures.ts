// 浮动对象层测试共享台架：假层（记录失效）、等分格假几何、标准图片对象与格命中
// （float-object-layer / float-transform 两组测试共用同一口径）
import { SceneNode, type Invalidation, type LayerHandle } from '@infinitable/render'

import type { CellRef } from '../../src/types'
import type { FloatGeometry, FloatObject } from '../../src/float/float-object-layer'

/** 记录失效的假层 */
export function stubLayer() {
  const invalidated: Invalidation[] = []
  const root = new SceneNode({ pickable: false })
  const layer: LayerHandle = {
    kind: 'sky',
    root,
    canvasElement: { width: 0, height: 0, getContext: () => null },
    setSize: () => {},
    invalidate: (inv) => invalidated.push(inv),
    translateBy: () => {},
  }
  return { layer, root, invalidated }
}

/**
 * 等行高列宽的假几何：scroll/cell 由闭包变量驱动（模拟滚动跟随与行列 resize 后尺寸变更）；
 * cellAtPoint 缺省不提供（拖拽落点回弹路径）。
 */
export function stubGeometry(
  scroll: { left: number; top: number },
  cell: { width: number; height: number } = { width: 100, height: 32 },
  cellAtPoint?: (x: number, y: number) => CellRef | null,
): FloatGeometry {
  return {
    cellOrigin: (col, row) => ({
      x: col * cell.width - scroll.left,
      y: row * cell.height - scroll.top,
    }),
    cellSize: () => ({ width: cell.width, height: cell.height }),
    ...(cellAtPoint ? { cellAtPoint } : {}),
  }
}

/** 标准图片对象：锚在 from 格 + (4,8) 偏移，无显式尺寸（由 from→to 格范围决定） */
export function imageObject(id: string, from: { col: number; row: number }): FloatObject {
  return {
    id,
    kind: 'image',
    anchor: { from, to: { col: from.col + 1, row: from.row + 1 }, offsetX: 4, offsetY: 8 },
    src: `${id}.png`,
  }
}

/** 格命中：层坐标按等分格（100×32）换算，负坐标（表头带）为 null */
export function hitCell(x: number, y: number): CellRef | null {
  return x < 0 || y < 0 ? null : { col: Math.floor(x / 100), row: Math.floor(y / 32) }
}
