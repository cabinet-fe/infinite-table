// 单轮求值批次的查找索引缓存：为 VLOOKUP / HLOOKUP / MATCH 的精确匹配提供 O(1) 哈希索引，
// 同一批重算内复用，批次结束即销毁（不跨编辑持久化，避免缓存失效维护成本）。

import type { RangeRef } from './address'
import type { FormulaError } from './errors'

/** 精确查找索引：首列/首行归一化值 → 0 基相对偏移（保持首次命中语义） */
export interface ExactLookupIndex {
  /** 归一化键（文本已转大写，数字/布尔保留原值类型，空格不入表）→ 首次出现的 0 基偏移 */
  readonly map: Map<string | number | boolean, number>
  /** 若索引构建过程中在某偏移处遇到错误值，则记录首个错误（未命中前传播） */
  readonly error?: FormulaError
}

/** 构造向量缓存键（含有效表名、方向与一维坐标区间） */
export function buildLookupVectorKey(
  sheet: string | undefined,
  ref: RangeRef,
  along: 'column' | 'row',
): string {
  const sheetPart = sheet === undefined ? '-' : `${sheet.length}#${sheet}`
  return along === 'column'
    ? `${sheetPart}|c|${ref.startCol}|${ref.startRow}:${ref.endRow}`
    : `${sheetPart}|r|${ref.startRow}|${ref.startCol}:${ref.endCol}`
}

/**
 * 批内查找索引缓存：由宿主（如 FormulaEngine.evaluateDirty）按求值批次创建并传入
 * FormulaEvaluateOptions.lookupCache；批内多个 VLOOKUP / HLOOKUP / MATCH 共享同一套首列/首行索引。
 */
export class FormulaLookupCache {
  private readonly exactIndices = new Map<string, ExactLookupIndex>()

  getExactIndex(key: string): ExactLookupIndex | undefined {
    return this.exactIndices.get(key)
  }

  setExactIndex(key: string, index: ExactLookupIndex): void {
    this.exactIndices.set(key, index)
  }

  clear(): void {
    this.exactIndices.clear()
  }
}
