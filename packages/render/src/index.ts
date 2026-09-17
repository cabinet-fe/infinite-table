// 自研 canvas 渲染引擎公共入口：仅显式导出 RenderHost 窄接口与必要类型
export { createRenderHost } from './render-host'
export type { RenderHostOptions } from './render-host'
export { SceneNode } from './scene/scene-node'
export type { SceneEventListener, SceneNodeInit } from './scene/scene-node'
export type { SceneEvent, SceneEventType } from './events/event-system'
export type {
  FrameTask,
  Invalidation,
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
