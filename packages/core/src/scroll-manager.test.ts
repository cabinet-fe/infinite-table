import { describe, expect, it } from 'vitest';

import { ScrollManager, type ScrollState } from './scroll-manager';

function createManager() {
  const manager = new ScrollManager();
  manager.setViewportSize(500, 400);
  manager.setContentSize(1000, 3200);
  return manager;
}

describe('ScrollManager 唯一滚动状态源', () => {
  it('scrollTo/scrollBy 更新状态并广播 (state, delta)', () => {
    const manager = createManager();
    const events: { state: ScrollState; dx: number; dy: number }[] = [];
    manager.onScroll((state, delta) => events.push({ state, dx: delta.dx, dy: delta.dy }));

    manager.scrollTo(100, 320);
    expect(manager.state).toEqual({ left: 100, top: 320 });
    expect(events).toEqual([{ state: { left: 100, top: 320 }, dx: 100, dy: 320 }]);

    manager.scrollBy(-20, 32);
    expect(manager.state).toEqual({ left: 80, top: 352 });
    expect(events).toHaveLength(2);
  });

  it('夹取到 [0, max]：越界滚动落在边界上', () => {
    const manager = createManager();
    manager.scrollTo(-10, Number.MAX_SAFE_INTEGER);
    expect(manager.state).toEqual({ left: 0, top: 2800 });
    expect(manager.maxLeft).toBe(500);
    expect(manager.maxTop).toBe(2800);
  });

  it('位置未变不广播', () => {
    const manager = createManager();
    let count = 0;
    manager.onScroll(() => count++);
    manager.scrollTo(0, 0);
    manager.scrollBy(0, 0);
    expect(count).toBe(0);
  });

  it('内容缩小后重新夹取并广播修正', () => {
    const manager = createManager();
    manager.scrollTo(0, 2000);
    const events: ScrollState[] = [];
    manager.onScroll((state) => events.push(state));
    manager.setContentSize(1000, 1000);
    expect(manager.state).toEqual({ left: 0, top: 600 });
    expect(events).toEqual([{ left: 0, top: 600 }]);
  });

  it('退订后不再接收', () => {
    const manager = createManager();
    let count = 0;
    const off = manager.onScroll(() => count++);
    off();
    manager.scrollTo(10, 10);
    expect(count).toBe(0);
  });
});
