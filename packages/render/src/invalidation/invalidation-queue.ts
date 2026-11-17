import { ceil, clip, contains, equals, intersects, spread, union } from '../region'
import type { Invalidation, LayerConsumption, Region } from '../types'

/** region 失效区域四边外扩像素数（防增量补画边缘残影） */
const REGION_SPREAD = 10
/** band 数量上限，超过则升级为 full（整层重绘） */
const MAX_BANDS = 8
/** region 数量上限，超过则升级为 full（避免大量零散脏区逐一遍历场景树） */
const MAX_REGIONS = 24

/** 层的重绘计划：整层重绘，或逐 region 增量补画 */
export type RepaintPlan = { full: true } | { full: false; regions: Region[] }

/** 计算 a \ b（矩形差集），将最多 4 块互不相交的正面积子矩形追加到 out */
function subtractRectInto(a: Region, b: Region, out: Region[]): void {
  const ix = clip(a, b)
  if (!ix) {
    out.push(a)
    return
  }
  const aRight = a.x + a.width
  const aBottom = a.y + a.height
  const ixRight = ix.x + ix.width
  const ixBottom = ix.y + ix.height

  // 上条带（全宽）
  if (ix.y > a.y) {
    out.push({ x: a.x, y: a.y, width: a.width, height: ix.y - a.y })
  }
  // 下条带（全宽）
  if (ixBottom < aBottom) {
    out.push({ x: a.x, y: ixBottom, width: a.width, height: aBottom - ixBottom })
  }
  // 左条带（仅夹在 ix 垂直高度内，与上下条带严格不相交）
  if (ix.x > a.x) {
    out.push({ x: a.x, y: ix.y, width: ix.x - a.x, height: ix.height })
  }
  // 右条带（仅夹在 ix 垂直高度内）
  if (ixRight < aRight) {
    out.push({ x: ixRight, y: ix.y, width: aRight - ixRight, height: ix.height })
  }
}

/** 将多个 band 拆解为两两不相交的矩形集（并集与原 bands 完全等价，消除对角滚动交叉角重复绘制） */
function decomposeDisjointBands(bands: readonly Region[]): Region[] {
  const disjoint: Region[] = []
  for (const band of bands) {
    let pieces: Region[] = [band]
    for (const existing of disjoint) {
      const next: Region[] = []
      for (const piece of pieces) {
        subtractRectInto(piece, existing, next)
      }
      pieces = next
      if (pieces.length === 0) {
        break
      }
    }
    for (const piece of pieces) {
      disjoint.push(piece)
    }
  }
  return disjoint
}

/**
 * 失效队列：按层收集三档失效并合并，帧末按建层方注入的消费策略
 * （LayerOpts.consumption）drain 出该层的重绘计划。
 * 合并语义：region 归一化（双包围盒 union + 扩边 + 像素对齐）并与重叠/包含的既有 region 合并，
 * 超上限（MAX_REGIONS）升级 full；band 吸收被其完全包含的 region（仅相交不吸收——窄 band 与
 * 大 region 重叠边缘时，region 的重绘区域远大于 band，按相交吸收会丢掉 band 外的重绘）；
 * 多 band 在 plan() 拆解为两两不相交矩形，避免对角滚动重复重绘交叉角；band 数超上限升级 full；
 * full 吸收一切。
 */
export class InvalidationQueue {
  private full = false
  /** region 登记项：raw 为像素对齐原始脏区（band 吸收判定用），region 为扩边登记区（重绘计划用） */
  private regions: { raw: Region; region: Region }[] = []
  private bands: Region[] = []

  constructor(private readonly consumption: LayerConsumption) {}

  push(inv: Invalidation): void {
    if (inv.type === 'full') {
      this.upgradeToFull()
      return
    }
    if (this.full) {
      return
    }
    if (inv.type === 'region') {
      this.pushRegion(inv)
      return
    }
    this.pushBand(inv.region)
  }

  /** 取出本层重绘计划并重置队列；本帧无需重绘返回 null */
  drain(): RepaintPlan | null {
    const plan = this.plan()
    this.full = false
    this.regions = []
    this.bands = []
    return plan
  }

  private upgradeToFull(): void {
    this.full = true
    this.regions = []
    this.bands = []
  }

  private pushRegion(inv: { region: Region; prevRegion?: Region }): void {
    // 吸收判定按扩边前的原始区（band 覆盖真实脏区即可）；登记区仍扩边防残影
    let nextRaw = ceil(this.regionUnion(inv))
    let nextRegion = spread(nextRaw, REGION_SPREAD)
    if (this.bands.some((band) => contains(band, nextRaw))) {
      return
    }
    if (this.regions.some((entry) => equals(entry.region, nextRegion))) {
      return
    }
    // 级联合并重叠或包含的已有 region（含新 region 桥接两个原有离散 region 的情况）
    let merged = true
    while (merged) {
      merged = false
      for (let i = this.regions.length - 1; i >= 0; i--) {
        const entry = this.regions[i]!
        if (
          intersects(entry.region, nextRegion) ||
          contains(entry.region, nextRegion) ||
          contains(nextRegion, entry.region)
        ) {
          nextRaw = union(entry.raw, nextRaw)
          nextRegion = union(entry.region, nextRegion)
          this.regions.splice(i, 1)
          merged = true
        }
      }
    }
    if (this.bands.some((band) => contains(band, nextRaw))) {
      return
    }
    this.regions.push({ raw: nextRaw, region: nextRegion })
    if (this.regions.length > MAX_REGIONS) {
      this.upgradeToFull()
    }
  }

  private pushBand(rawBand: Region): void {
    const band = ceil(rawBand)
    // 新 band 只吸收被其完全包含（按原始脏区）的 region；仅相交的 region 保留自身重绘
    this.regions = this.regions.filter((entry) => !contains(band, entry.raw))
    if (this.bands.some((b) => contains(b, band))) {
      return
    }
    this.bands = this.bands.filter((b) => !contains(band, b))
    this.bands.push(band)
    if (this.bands.length > MAX_BANDS) {
      this.upgradeToFull()
    }
  }

  private disjointBands(): Region[] {
    // 0-band 与 1-band 快路径保持零拆解开销
    if (this.bands.length <= 1) {
      return [...this.bands]
    }
    return decomposeDisjointBands(this.bands)
  }

  private plan(): RepaintPlan | null {
    if (!this.full && this.regions.length === 0 && this.bands.length === 0) {
      return null
    }
    if (this.consumption === 'always-full' || this.full) {
      return { full: true }
    }
    if (this.consumption === 'band-full-only') {
      return this.bands.length > 0 ? { full: false, regions: this.disjointBands() } : null
    }
    const bands = this.disjointBands()
    if (this.regions.length === 0) {
      return { full: false, regions: bands }
    }
    const regions = this.regions.map((entry) => entry.region)
    return { full: false, regions: bands.length === 0 ? regions : [...bands, ...regions] }
  }

  private regionUnion(inv: { region: Region; prevRegion?: Region }): Region {
    return inv.prevRegion ? union(inv.region, inv.prevRegion) : inv.region
  }
}
