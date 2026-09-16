import type { FrameTask } from './types';

export type FrameScheduleFn = (callback: () => void) => number;
export type FrameCancelFn = (handle: number) => void;

/** 默认帧调度：浏览器 rAF，非浏览器环境退化 setTimeout(16) */
function defaultSchedule(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback);
  }
  return setTimeout(callback, 16) as unknown as number;
}

function defaultCancel(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
}

/**
 * 帧调度器：把多次 requestFrame 收敛到同一个渲染帧执行；
 * 同一任务引用在同一帧内只执行一次（单帧收敛）。
 */
export class FrameScheduler {
  private readonly tasks = new Set<FrameTask>();
  private handle: number | null = null;

  constructor(
    private readonly schedule: FrameScheduleFn = defaultSchedule,
    private readonly cancel: FrameCancelFn = defaultCancel,
  ) {}

  request(task: FrameTask): void {
    this.tasks.add(task);
    if (this.handle === null) {
      this.handle = this.schedule(() => this.flush());
    }
  }

  /** 是否有已排期未执行的帧 */
  get pending(): boolean {
    return this.handle !== null;
  }

  private flush(): void {
    this.handle = null;
    const tasks = [...this.tasks];
    this.tasks.clear();
    for (const task of tasks) {
      task();
    }
  }

  destroy(): void {
    if (this.handle !== null) {
      this.cancel(this.handle);
      this.handle = null;
    }
    this.tasks.clear();
  }
}
