// 自研 canvas 渲染引擎公共入口：RenderHost 窄接口、场景树（含内建图元节点）、
// 绘制/命中遍历与 region 几何工具的显式导出
export { createRenderHost } from './render-host'
export type { RenderHostOptions } from './render-host'
export { SceneNode } from './scene/scene-node'
export type { SceneEventListener, SceneNodeInit } from './scene/scene-node'
export { paintTree } from './scene/paint'
export { hitTest } from './scene/hit-test'
export { ImageNode, PathNode, RectNode, TextNode } from './scene/primitives'
export type {
  ImageNodeInit,
  PaintStyle,
  PathCommand,
  PathNodeInit,
  RectNodeInit,
  TextNodeInit,
} from './scene/primitives'
export { ceil, clip, contains, equals, intersects, spread, union } from './region'
export type { SceneEvent, SceneEventType } from './events/event-system'
export type {
  FrameTask,
  Invalidation,
  LayerConsumption,
  LayerHandle,
  LayerKind,
  LayerOpts,
  Region,
  RenderCanvas,
  RenderContext,
  RenderHost,
  RenderImageSource,
  Size,
} from './types'
