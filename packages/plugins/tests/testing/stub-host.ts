// 测试专用注入式假渲染宿主（对齐 core 包内 StubHost 形态）：插件包单测构造 ListTable 用。
// 仅测试基础设施 import @infinite-table/render（devDependency）；src/sheet 源码面仍只依赖 core 公开入口。

import { SceneNode } from '@infinite-table/render'
import type {
  Invalidation,
  LayerHandle,
  LayerKind,
  LayerOpts,
  RenderCanvas,
  RenderHost,
  Size,
} from '@infinite-table/render'

class StubLayer implements LayerHandle {
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

  requestFrame(task: () => void): void {
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
