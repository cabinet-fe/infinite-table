// 唯一滚动状态源：表格内所有滚动（代码/滚动条/触控/键盘）都经此收敛，
// 状态变更以 (state, delta) 广播，由 ListTable 驱动窗口重建与三档失效登记。

export interface ScrollState {
  readonly left: number;
  readonly top: number;
}

export interface ScrollDelta {
  readonly dx: number;
  readonly dy: number;
}

export type ScrollListener = (state: ScrollState, delta: ScrollDelta) => void;

export class ScrollManager {
  private left = 0;
  private top = 0;
  private contentWidth = 0;
  private contentHeight = 0;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private readonly listeners = new Set<ScrollListener>();

  get state(): ScrollState {
    return { left: this.left, top: this.top };
  }

  get maxLeft(): number {
    return Math.max(0, this.contentWidth - this.viewportWidth);
  }

  get maxTop(): number {
    return Math.max(0, this.contentHeight - this.viewportHeight);
  }

  setContentSize(width: number, height: number): void {
    this.contentWidth = width;
    this.contentHeight = height;
    this.clampIntoBounds();
  }

  setViewportSize(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.clampIntoBounds();
  }

  /** 滚动到指定位置（自动夹取到 [0, max]）；位置未变时不广播 */
  scrollTo(left: number, top: number): void {
    const nextLeft = Math.min(Math.max(left, 0), this.maxLeft);
    const nextTop = Math.min(Math.max(top, 0), this.maxTop);
    const dx = nextLeft - this.left;
    const dy = nextTop - this.top;
    if (dx === 0 && dy === 0) {
      return;
    }
    this.left = nextLeft;
    this.top = nextTop;
    const state = this.state;
    const delta: ScrollDelta = { dx, dy };
    for (const listener of this.listeners) {
      listener(state, delta);
    }
  }

  scrollBy(dx: number, dy: number): void {
    this.scrollTo(this.left + dx, this.top + dy);
  }

  /** 订阅滚动；返回退订函数 */
  onScroll(listener: ScrollListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private clampIntoBounds(): void {
    this.scrollTo(this.left, this.top);
  }
}
