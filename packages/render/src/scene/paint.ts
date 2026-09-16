import type { Region, RenderContext } from '../types';
import { intersects } from '../region';
import type { SceneNode } from './scene-node';

/**
 * 绘制遍历：先绘自身再按 children 顺序绘子节点（后者在上）。
 * cull 提供时（层坐标下的脏区），整棵子树包围盒与其不相交则跳过。
 */
export function paintTree(
  node: SceneNode,
  ctx: RenderContext,
  cull: Region | null = null,
  offsetX = 0,
  offsetY = 0,
): void {
  if (!node.visible) {
    return;
  }
  const gx = offsetX + node.x;
  const gy = offsetY + node.y;
  if (cull && !intersects({ x: gx, y: gy, width: node.width, height: node.height }, cull)) {
    return;
  }
  ctx.save();
  ctx.translate(node.x, node.y);
  node.paint(ctx);
  for (const child of node.children) {
    paintTree(child, ctx, cull, gx, gy);
  }
  ctx.restore();
}
