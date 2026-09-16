import type { SceneNode } from './scene-node';

/**
 * 命中测试：x/y 为 node 父坐标系下的点（根节点即层坐标），
 * 返回包含该点的最深层、绘制顺序最靠上的可拾取节点；未命中返回 null。
 */
export function hitTest(node: SceneNode, x: number, y: number): SceneNode | null {
  if (!node.visible) {
    return null;
  }
  const lx = x - node.x;
  const ly = y - node.y;
  if (lx < 0 || ly < 0 || lx >= node.width || ly >= node.height) {
    return null;
  }
  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i];
    if (child) {
      const hit = hitTest(child, lx, ly);
      if (hit) {
        return hit;
      }
    }
  }
  return node.pickable ? node : null;
}
