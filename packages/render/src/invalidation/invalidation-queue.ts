import { ceil, contains, equals, spread, union } from '../region'
import type { Invalidation, LayerConsumption, Region } from '../types'

/** region 失效区域四边外扩像素数（防增量补画边缘残影） */
const REGION_SPREAD = 10
/** band 数量上限，超过则升级为 full（整层重绘） */
const MAX_BANDS = 8

/** 层的重绘计划：整层重绘，或逐 region 增量补画 */
export type RepaintPlan = { full: true } | { full: false; regions: Region[] }

/**
 * 失效队列：按层收集三档失效并合并，帧末按建层方注入的消费策略
 * （LayerOpts.consumption）drain 出该层的重绘计划。
 * 合并语义：region 归一化（双包围盒 union + 扩边 + 像素对齐）；band 吸收被其
 * 完全包含的 region（仅相交不吸收——窄 band 与大 region 重叠边缘时，
 * region 的重绘区域远大于 band，按相交吸收会丢掉 band 外的重绘）；band 数超上限
 * 升级 full；full 吸收一切。
 */
export class InvalidationQueue {
  private full = false
  /** region 登记项：raw 为像素对齐原始脏区（band 吸收判定用），region 为扩边登记区（重绘计划用） */
  private regions: { raw: Region; region: Region }[] = []
  private bands: Region[] = []

  constructor(private readonly consumption: LayerConsumption) {}

  push(inv: Invalidation): void {
    if (inv.type === 'full') {
      this.full = true
      this.regions = []
      this.bands = []
      return
    }
    if (this.full) {
      return
    }
    if (inv.type === 'region') {
      // 吸收判定按扩边前的原始区（band 覆盖真实脏区即可）；登记区仍扩边防残影
      const raw = ceil(this.regionUnion(inv))
      const region = spread(raw, REGION_SPREAD)
      if (this.bands.some((band) => contains(band, raw))) {
        return
      }
      if (!this.regions.some((entry) => equals(entry.region, region))) {
        this.regions.push({ raw, region })
      }
      return
    }
    const band = ceil(inv.region)
    // 新 band 只吸收被其完全包含（按原始脏区）的 region；仅相交的 region 保留自身重绘
    this.regions = this.regions.filter((entry) => !contains(band, entry.raw))
    if (!this.bands.some((b) => equals(b, band))) {
      this.bands.push(band)
    }
    if (this.bands.length > MAX_BANDS) {
      this.full = true
      this.regions = []
      this.bands = []
    }
  }

  /** 取出本层重绘计划并重置队列；本帧无需重绘返回 null */
  drain(): RepaintPlan | null {
    const plan = this.plan()
    this.full = false
    this.regions = []
    this.bands = []
    return plan
  }

  private plan(): RepaintPlan | null {
    if (!this.full && this.regions.length === 0 && this.bands.length === 0) {
      return null
    }
    if (this.consumption === 'always-full') {
      return { full: true }
    }
    if (this.full) {
      return { full: true }
    }
    if (this.consumption === 'band-full-only') {
      return this.bands.length > 0 ? { full: false, regions: [...this.bands] } : null
    }
    return { full: false, regions: [...this.bands, ...this.regions.map((entry) => entry.region)] }
  }

  private regionUnion(inv: { region: Region; prevRegion?: Region }): Region {
    return inv.prevRegion ? union(inv.region, inv.prevRegion) : inv.region
  }
}
