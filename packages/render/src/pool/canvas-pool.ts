import type { RenderCanvas } from '../types';

export type CanvasFactory = () => RenderCanvas;

/**
 * 离屏 canvas 池：按 像素宽×高 分桶复用，超出容量直接丢弃。
 * 用于 blit 自拷贝的临时位图等短生命周期离屏画布，避免滚动帧反复分配。
 */
export class CanvasPool {
  private readonly buckets = new Map<string, RenderCanvas[]>();
  private count = 0;

  constructor(
    private readonly createCanvas: CanvasFactory,
    private readonly maxSize = 16,
  ) {}

  /** 申请一张 width×height 的画布（物理像素）；池中有同尺寸则复用 */
  acquire(width: number, height: number): RenderCanvas {
    const key = `${width}x${height}`;
    const bucket = this.buckets.get(key);
    const canvas = bucket?.pop();
    if (canvas) {
      if (bucket && bucket.length === 0) {
        this.buckets.delete(key);
      }
      this.count -= 1;
      return canvas;
    }
    const created = this.createCanvas();
    created.width = width;
    created.height = height;
    return created;
  }

  /** 归还画布入池；池满或尺寸为 0 时丢弃 */
  release(canvas: RenderCanvas): void {
    if (canvas.width <= 0 || canvas.height <= 0 || this.count >= this.maxSize) {
      return;
    }
    const key = `${canvas.width}x${canvas.height}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    bucket.push(canvas);
    this.count += 1;
  }

  /** 清空池 */
  clear(): void {
    this.buckets.clear();
    this.count = 0;
  }

  /** 当前池内画布数量 */
  get size(): number {
    return this.count;
  }
}
