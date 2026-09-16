import { describe, expect, it } from 'vitest';

import { InertiaScroller, TouchScrollTracker } from './touch-scroll';

describe('TouchScrollTracker 触点跟踪', () => {
  it('move 产出相对上一采样点的内容滚动增量（手指上滑内容下移为负增量）', () => {
    const tracker = new TouchScrollTracker();
    expect(tracker.move(10, 10, 0)).toBeNull();
    tracker.start(100, 100, 0);
    expect(tracker.move(100, 90, 16)).toEqual({ dx: 0, dy: 10 });
    expect(tracker.move(110, 90, 32)).toEqual({ dx: -10, dy: 0 });
  });

  it('只保留最近 4 个采样，end 按首末点差求初速度', () => {
    const tracker = new TouchScrollTracker();
    tracker.start(0, 0, 0);
    // 6 个采样点，最早两个被挤出：首点 (0,100@100)，末点 (0,500@500)
    tracker.move(0, 100, 100);
    tracker.move(0, 200, 200);
    tracker.move(0, 300, 300);
    tracker.move(0, 400, 400);
    const velocity = tracker.end(0, 500, 500);
    expect(velocity).toEqual({ vx: 0, vy: 1 });
    expect(tracker.tracking).toBe(false);
  });

  it('采样时间相等或不足时不产生惯性', () => {
    const tracker = new TouchScrollTracker();
    tracker.start(0, 0, 100);
    expect(tracker.end(0, 0, 100)).toBeNull();
  });

  it('cancel 清空跟踪', () => {
    const tracker = new TouchScrollTracker();
    tracker.start(0, 0, 0);
    tracker.cancel();
    expect(tracker.tracking).toBe(false);
    expect(tracker.move(1, 1, 1)).toBeNull();
  });
});

describe('InertiaScroller 惯性滚动', () => {
  /** 同步帧泵：pump 一次推进一帧（16ms） */
  function makeRig() {
    const tasks: Array<() => void> = [];
    const deltas: Array<{ dx: number; dy: number }> = [];
    let now = 0;
    const scroller = new InertiaScroller(
      (dx, dy) => deltas.push({ dx, dy }),
      (task) => tasks.push(task),
      () => now,
    );
    return {
      scroller,
      deltas,
      pump(frames: number, dt = 16): void {
        for (let i = 0; i < frames; i++) {
          now += dt;
          const batch = tasks.splice(0);
          for (const task of batch) {
            task();
          }
        }
      },
      get pending(): number {
        return tasks.length;
      },
    };
  }

  it('初速度驱动滚动并按摩擦系数逐帧衰减，方向与触点移动相反', () => {
    const rig = makeRig();
    // 触点速度 +1 px/ms（手指下滑）→ 内容向上滚（负增量）
    rig.scroller.start({ vx: 0, vy: 1 });
    rig.pump(1);
    expect(rig.deltas).toHaveLength(1);
    // 首帧位移 = 平均速度 (1 + 0.95) / 2 * 16 ≈ 15.6，方向取反
    expect(rig.deltas[0]!.dy).toBeCloseTo(-15.6, 5);
    expect(rig.deltas[0]!.dx).toBeCloseTo(0, 5);
    rig.pump(1);
    // 次帧速度 0.95 → 位移更小（衰减）
    expect(Math.abs(rig.deltas[1]!.dy)).toBeLessThan(Math.abs(rig.deltas[0]!.dy));
  });

  it('双轴速度低于阈值后停止，不再排帧', () => {
    const rig = makeRig();
    rig.scroller.start({ vx: 0.1, vy: 0.1 });
    rig.pump(50);
    expect(rig.scroller.isRunning).toBe(false);
    expect(rig.pending).toBe(0);
  });

  it('stop 立即终止；运行中可以新速度重启', () => {
    const rig = makeRig();
    rig.scroller.start({ vx: 0, vy: 2 });
    rig.pump(1);
    rig.scroller.stop();
    const count = rig.deltas.length;
    rig.pump(5);
    expect(rig.deltas).toHaveLength(count);

    rig.scroller.start({ vx: 0, vy: 1 });
    expect(rig.scroller.isRunning).toBe(true);
    rig.pump(1);
    expect(rig.deltas.length).toBeGreaterThan(count);
  });
});
