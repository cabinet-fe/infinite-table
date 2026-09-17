import { ceil, equals, intersects, spread, union } from '../region'
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
 * 合并语义：cell 归一化（双包围盒 union + 扩边 + 像素对齐）；band 吸收相交 cell；
 * band 数超上限升级 full；full 吸收一切。
 */
export class InvalidationQueue {
  private full = false
  private cells: Region[] = []
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
      const region = ceil(spread(this.cellUnion(inv), CELL_SPREAD))
      // band 吸收相交 cell
      if (this.bands.some((band) => intersects(band, region))) {
        return
      }
      if (!this.cells.some((cell) => equals(cell, region))) {
        this.cells.push(region)
      }
      return
    }
    const band = ceil(inv.region)
    // 新 band 吸收已登记的相交 cell
    this.cells = this.cells.filter((cell) => !intersects(band, cell))
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
    return { full: false, regions: [...this.bands, ...this.cells] }
  }

  private cellUnion(inv: { region: Region; prevRegion?: Region }): Region {
    return inv.prevRegion ? union(inv.region, inv.prevRegion) : inv.region
  }
}
