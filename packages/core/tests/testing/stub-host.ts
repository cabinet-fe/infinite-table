// 测试用注入式假宿主：core 只依赖 RenderHost 窄接口，stub 记录失效提交

import { SceneNode } from '@infinite-table/render'
import type {
  FrameTask,
  Invalidation,
  LayerHandle,
  LayerKind,
  LayerOpts,
  RenderCanvas,
  RenderHost,
  Size,
} from '@infinite-table/render'

export class StubLayer implements LayerHandle {
  readonly root = new SceneNode({ pickable: false })
  readonly canvasElement: RenderCanvas = { width: 0, height: 0, getContext: () => null }

  constructor(readonly kind: LayerKind) {}

  setSize(): void {}
  invalidate(): void {}
  translateBy(): void {}
}

export class StubHost implements RenderHost {
  readonly layers = new Map<LayerKind, StubLayer>()
  readonly submitted: { kind: LayerKind; inv: Invalidation }[] = []
  destroyed = false

  createLayer(opts: LayerOpts): LayerHandle {
    let layer = this.layers.get(opts.kind)
    if (!layer) {
      layer = new StubLayer(opts.kind)
      this.layers.set(opts.kind, layer)
    }
    return layer
  }

  submitInvalidation(kind: LayerKind, inv: Invalidation): void {
    this.submitted.push({ kind, inv })
  }

  requestFrame(task: FrameTask): void {
    task()
  }

  measure(): Size {
    return { width: 0, height: 0 }
  }

  resize(): void {}

  destroy(): void {
    this.destroyed = true
  }
}
