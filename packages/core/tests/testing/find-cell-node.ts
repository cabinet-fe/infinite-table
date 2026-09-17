// 测试辅助：在层场景树中按格坐标深度优先查找 CellNode。
// R2-5 后表头节点收进 body root 的表头容器（非直接子节点），查找需递归下钻。

import type { SceneNode } from '@infinite-table/render'

import { CellNode } from '../../src/cell-node'

export function findCellNode(root: SceneNode, col: number, row: number): CellNode | undefined {
  for (const child of root.children) {
    if (child instanceof CellNode && child.col === col && child.row === row) {
      return child
    }
    const found = findCellNode(child, col, row)
    if (found) {
      return found
    }
  }
  return undefined
}
