import { ceil, contains, equals, spread, union } from '../region'
import type { Invalidation, LayerKind, Region } from '../types'

/** cell 失效区域四边外扩像素数（防增量补画边缘残影） */
const CELL_SPREAD = 10
/** band 数量上限，超过则升级为 full（整层重绘） */
const MAX_BANDS = 8

/** 层的重绘计划：整层重绘，或逐 region 增量补画 */
export type RepaintPlan = { full: true } | { full: false; regions: Region[] }

/** 各层消费策略：帧末按层语义把失效队列收敛为重绘计划 */
type Consumption = 'band-full-only' | 'regions' | 'always-full'

const LAYER_CONSUMPTION: Record<LayerKind, Consumption> = {
  // L0 仅响应 band/full（网格线/斑马纹不因单格内容变化）
  ground: 'band-full-only',
  // L1 逐 region clearRect + 重画相交内容
  body: 'regions',
  // L2 同 L1
  media: 'regions',
  // L3 响应一切但整层重画自身（便宜）
  sky: 'always-full',
}

/**
 * 失效队列：按层收集三档失效并合并，帧末 drain 出该层的重绘计划。
 * 合并语义：cell 归一化（双包围盒 union + 扩边 + 像素对齐）；band 吸收被其
 * 完全包含的 cell（仅相交不吸收——行号带等窄 band 与大 cell 重叠 10px 时，
 * cell 的重绘区域远大于 band，按相交吸收会丢掉 band 外的重绘）；band 数超上限
 * 升级 full；full 吸收一切。
 */
export class InvalidationQueue {
  private full = false
  /** cell 登记项：raw 为像素对齐原始脏区（band 吸收判定用），region 为扩边登记区（重绘计划用） */
  private cells: { raw: Region; region: Region }[] = []
  private bands: Region[] = []

  constructor(private readonly kind: LayerKind) {}

  push(inv: Invalidation): void {
    if (inv.type === 'full') {
      this.full = true
      this.cells = []
      this.bands = []
      return
    }
    if (this.full) {
      return
    }
    if (inv.type === 'cell') {
      // 吸收判定按扩边前的原始区（band 覆盖真实脏区即可）；登记区仍扩边防残影
      const raw = ceil(this.cellUnion(inv))
      const region = spread(raw, CELL_SPREAD)
      if (this.bands.some((band) => contains(band, raw))) {
        return
      }
      if (!this.cells.some((cell) => equals(cell.region, region))) {
        this.cells.push({ raw, region })
      }
      return
    }
    const band = ceil(inv.region)
    // 新 band 只吸收被其完全包含（按原始脏区）的 cell；仅相交的 cell 保留自身重绘
    this.cells = this.cells.filter((cell) => !contains(band, cell.raw))
    if (!this.bands.some((b) => equals(b, band))) {
      this.bands.push(band)
    }
    if (this.bands.length > MAX_BANDS) {
      this.full = true
      this.cells = []
      this.bands = []
    }
  }

  /** 取出本层重绘计划并重置队列；本帧无需重绘返回 null */
  drain(): RepaintPlan | null {
    const plan = this.plan()
    this.full = false
    this.cells = []
    this.bands = []
    return plan
  }

  private plan(): RepaintPlan | null {
    if (!this.full && this.cells.length === 0 && this.bands.length === 0) {
      return null
    }
    const consumption = LAYER_CONSUMPTION[this.kind]
    if (consumption === 'always-full') {
      return { full: true }
    }
    if (this.full) {
      return { full: true }
    }
    if (consumption === 'band-full-only') {
      return this.bands.length > 0 ? { full: false, regions: [...this.bands] } : null
    }
    return { full: false, regions: [...this.bands, ...this.cells.map((cell) => cell.region)] }
  }

  private cellUnion(inv: { region: Region; prevRegion?: Region }): Region {
    return inv.prevRegion ? union(inv.region, inv.prevRegion) : inv.region
  }
}
