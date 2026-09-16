// 失效面积计量：包装 RenderHost 记录 submitInvalidation，
// 失效提交与滚动/交互调用同步发生，按帧 drain 即得每帧失效面积（07 §1.1 口径：失效像素面积 / 视口面积）

import type {
  FrameTask,
  Invalidation,
  LayerHandle,
  LayerKind,
  LayerOpts,
  RenderHost,
  Size,
} from '@infinite-table/render';

export interface LayerInvalidationStats {
  full: number;
  band: number;
  cell: number;
  /** 本帧该层失效像素面积合计（full 按整层视口面积计） */
  area: number;
}

export class InvalidationMeter {
  private readonly pending = new Map<LayerKind, LayerInvalidationStats>();

  constructor(private readonly viewportArea: number) {}

  /** 包装真实宿主：拦截失效提交做计量后原样转发 */
  wrap(host: RenderHost): RenderHost {
    return {
      createLayer: (opts: LayerOpts): LayerHandle => host.createLayer(opts),
      submitInvalidation: (kind: LayerKind, inv: Invalidation): void => {
        this.record(kind, inv);
        host.submitInvalidation(kind, inv);
      },
      requestFrame: (task: FrameTask): void => host.requestFrame(task),
      measure: (text: string, font: string): Size => host.measure(text, font),
      destroy: (): void => host.destroy(),
    };
  }

  /** 取出并清空自上次 drain 以来的失效记录（key 为层 kind） */
  drain(): Map<LayerKind, LayerInvalidationStats> {
    const snapshot = new Map(this.pending);
    this.pending.clear();
    return snapshot;
  }

  private record(kind: LayerKind, inv: Invalidation): void {
    let stats = this.pending.get(kind);
    if (!stats) {
      stats = { full: 0, band: 0, cell: 0, area: 0 };
      this.pending.set(kind, stats);
    }
    if (inv.type === 'full') {
      stats.full += 1;
      stats.area += this.viewportArea;
      return;
    }
    stats[inv.type] += 1;
    stats.area += inv.region.width * inv.region.height;
  }
}
