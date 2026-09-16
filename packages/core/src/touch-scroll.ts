// 触控滚动：触点跟踪与惯性滚动（吸收 vtable 触控滚动补丁行为）。
// 触点取最近 4 个采样，松手时按首末点差求初速度；惯性按 16ms 基准帧以摩擦系数衰减，
// 双轴速度都低于阈值时停止。

/** 触点采样 */
export interface TouchPoint {
  readonly x: number;
  readonly y: number;
  readonly timestamp: number;
}

/** 触控滚动的位移增量（内容滚动方向：手指上滑内容下移为负增量） */
export interface ScrollDelta2D {
  readonly dx: number;
  readonly dy: number;
}

/** 惯性初速度（px/ms，方向同触点移动方向） */
export interface InertiaVelocity {
  readonly vx: number;
  readonly vy: number;
}

const MAX_TRACK_POINTS = 4;
/** 惯性停止阈值（px/ms，同 vtable 0.05） */
const STOP_SPEED = 0.05;
/** 摩擦系数（同 vtable 0.95，按 16ms 基准帧幂次衰减） */
const DEFAULT_FRICTION = 0.95;

/** 触点跟踪器：start/move/end 一段触摸手势，move 产出滚动增量，end 产出惯性初速度 */
export class TouchScrollTracker {
  private points: TouchPoint[] = [];

  get tracking(): boolean {
    return this.points.length > 0;
  }

  start(x: number, y: number, timestamp: number): void {
    this.points = [{ x, y, timestamp }];
  }

  /** 记录移动点并返回相对上一采样点的内容滚动增量；未在跟踪时返回 null */
  move(x: number, y: number, timestamp: number): ScrollDelta2D | null {
    const prev = this.points[this.points.length - 1];
    if (!prev) {
      return null;
    }
    this.push({ x, y, timestamp });
    return { dx: prev.x - x, dy: prev.y - y };
  }

  /** 结束手势：按最近采样的首末点求惯性初速度；采样不足时返回 null */
  end(x: number, y: number, timestamp: number): InertiaVelocity | null {
    this.push({ x, y, timestamp });
    const first = this.points[0];
    const last = this.points[this.points.length - 1];
    this.points = [];
    if (!first || !last || first === last) {
      return null;
    }
    const dt = last.timestamp - first.timestamp;
    if (dt <= 0) {
      return null;
    }
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
  }

  cancel(): void {
    this.points = [];
  }

  private push(point: TouchPoint): void {
    if (this.points.length >= MAX_TRACK_POINTS) {
      this.points.shift();
    }
    this.points.push(point);
  }
}

/**
 * 惯性滚动器：以初速度起步，每帧按摩擦系数衰减并回调滚动增量（内容方向，与触点反向），
 * 双轴速度均低于阈值时停止。帧调度与时间源可注入（测试用同步帧泵）。
 */
export class InertiaScroller {
  private vx = 0;
  private vy = 0;
  private friction = DEFAULT_FRICTION;
  private lastTime = 0;
  private running = false;
  private readonly tick = () => this.step();

  constructor(
    private readonly scrollBy: (dx: number, dy: number) => void,
    private readonly requestFrame: (task: () => void) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** 启动惯性滚动；已在运行时以新速度重启 */
  start(velocity: InertiaVelocity, friction = DEFAULT_FRICTION): void {
    this.vx = velocity.vx;
    this.vy = velocity.vy;
    this.friction = friction;
    this.lastTime = this.now();
    if (!this.running) {
      this.running = true;
      this.requestFrame(this.tick);
    }
  }

  stop(): void {
    this.running = false;
  }

  private step(): void {
    if (!this.running) {
      return;
    }
    const now = this.now();
    const dt = now - this.lastTime;
    this.lastTime = now;
    const decay = Math.pow(this.friction, dt / 16);
    const nextVx = this.vx * decay;
    const nextVy = this.vy * decay;
    // 位移取帧内平均速度（梯形近似），方向与触点移动相反
    const dx = (-(this.vx + nextVx) / 2) * dt;
    const dy = (-(this.vy + nextVy) / 2) * dt;
    if (Math.abs(nextVx) <= STOP_SPEED && Math.abs(nextVy) <= STOP_SPEED) {
      this.running = false;
      return;
    }
    this.vx = nextVx;
    this.vy = nextVy;
    this.scrollBy(dx, dy);
    this.requestFrame(this.tick);
  }
}
