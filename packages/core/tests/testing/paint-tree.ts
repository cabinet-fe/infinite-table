// 测试辅助：无栅格化环境下的「逐像素一致」代理断言。
// 用 RecordingContext 按场景树序绘制整棵树（与 render 包 paintTree 同构：
// save → translate → paint → children → restore），再把绘制流按节点段
// （translate 边界）切分、段按「x,y」坐标键稳定排序。
// 依据：非重叠节点的段间次序对像素无影响（重叠 z 序不变量由树序断言单独覆盖），
// 因此规范序绘制流全等 ⇔ 逐像素等价。
import type { SceneNode } from '@infinite-table/render'

import { RecordingContext, type RecordedCall } from './recording-context'

export function paintTreeForTest(node: SceneNode, ctx: RecordingContext): void {
  ctx.save()
  ctx.translate(node.x, node.y)
  node.paint(ctx)
  for (const child of node.children) {
    paintTreeForTest(child, ctx)
  }
  ctx.restore()
}

/** 绘制流规范化：translate 起新段；段内保留带参调用（rect/fillRect/fillText/drawImage），无参结构调用（save/restore/beginPath/clip）不入比较 */
export function canonicalPaintOps(ctx: RecordingContext): RecordedCall[] {
  const blocks: { key: string; calls: RecordedCall[] }[] = []
  for (const call of ctx.calls) {
    if (call.name === 'translate') {
      blocks.push({ key: `${call.args[0]},${call.args[1]}`, calls: [call] })
      continue
    }
    if (
      call.name === 'save' ||
      call.name === 'restore' ||
      call.name === 'beginPath' ||
      call.name === 'clip'
    ) {
      continue
    }
    if (blocks.length > 0) {
      blocks[blocks.length - 1]!.calls.push(call)
    }
  }
  // 稳定排序：同键段（如 root/表头容器/外框同在 0,0）保持树内相对次序
  blocks.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return blocks.flatMap((block) => block.calls)
}

/** 规范序绘制整棵树并返回比较用绘制流 */
export function paintTreeCanonical(root: SceneNode, ctx: RecordingContext): RecordedCall[] {
  paintTreeForTest(root, ctx)
  return canonicalPaintOps(ctx)
}
