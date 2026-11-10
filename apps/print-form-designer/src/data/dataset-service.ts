// 数据集取数服务：「按 id 执行数据集 → 原始行 Map」的唯一前端取数口径。
// 数据块弹框、绑定编辑、聚合试运行、打印弹框四个消费方共用，收敛三件事：
// - 并发去重：同一时刻同 id 的请求共享同一 in-flight Promise（数据块弹框与绑定编辑
//   同屏打开时不再对同一数据集重复执行 SQL）；结算即出表，成败都不留缓存——
//   「每次全量重取」的语义（聚合试运行）靠重新调用自然达成；
// - 转换口径：executeDataset 的 QueryResult → SourceRow（toSourceRows）只在这里做，
//   消费方拿到的直接是重塑管线的入参形态；
// - 错误口径：请求失败原样抛给调用方（文案来自 data/api 的 request 层），由各消费方
//   现有 errors.ts 呈现路径显示，本服务不另造文案。
import { useEffect, useState } from 'react'

import { api, toSourceRows } from './api'
import type { SourceRow } from '../transform/reshape'
import { describeError } from '../errors'

/** 进行中的取数请求表（id → 共享 Promise）；结算后即删（见 fetchDatasetRows） */
const inflight = new Map<string, Promise<SourceRow[]>>()

/**
 * 执行单个数据集并转为原始行。并发去重：同 id 的并发调用共享同一请求；
 * 结算（无论成败）后出表——后续调用重新发起，不消费旧结果。
 */
export function fetchDatasetRows(id: string): Promise<SourceRow[]> {
  const pending = inflight.get(id)
  if (pending) return pending
  const request = api
    .executeDataset(id)
    .then(toSourceRows)
    .finally(() => {
      if (inflight.get(id) === request) inflight.delete(id)
    })
  inflight.set(id, request)
  return request
}

/**
 * 批量取数：多 id 并行，汇总为 Map。Promise.all 口径——任一失败整批拒绝，
 * 成功部分的结果不落地（与历版各组件手拼 Promise.all 的行为一致）。
 */
export async function fetchDatasetRowsBulk(
  ids: readonly string[],
): Promise<Map<string, SourceRow[]>> {
  const entries = await Promise.all(
    ids.map(async (id) => [id, await fetchDatasetRows(id)] as const),
  )
  return new Map(entries)
}

/** useDatasetRows 的状态面（rowsByDataset 按需累积记忆；错误为展示文案） */
export interface DatasetRowsState {
  /** 已取到的原始行（按 id 记忆累积、不淘汰；引用只在新增条目时变化） */
  rowsByDataset: ReadonlyMap<string, SourceRow[]>
  /** ids 中仍有未取到的数据集（缺行驱动各处「取数中」呈现） */
  loading: boolean
  /** 取数错误文案（describeError 口径；任一批次成功即清空） */
  error: string
}

/**
 * 按数据集 id 集合取数的 React 封装：缺哪个取哪个、结果按 id 累积记忆
 * （跨依赖变化不重取已缓存的 id），依赖变化/组件卸载时作废旧批次的落地。
 * 适合「增量补齐」的消费方（数据块弹框、绑定编辑）；每次点击都要全新取数的
 * 场景（聚合试运行、打印弹框打开取数）直接用 fetchDatasetRowsBulk。
 */
export function useDatasetRows(ids: readonly string[]): DatasetRowsState {
  const [rowsByDataset, setRowsByDataset] = useState<ReadonlyMap<string, SourceRow[]>>(
    () => new Map(),
  )
  const [error, setError] = useState('')
  // ids 只作依赖键使用（数组字面量每次渲染都是新引用，不能直接进 deps）
  const idsKey = ids.join('\u0000')

  useEffect(() => {
    const pending = (idsKey === '' ? [] : idsKey.split('\u0000')).filter(
      (id) => !rowsByDataset.has(id),
    )
    if (pending.length === 0) return
    let cancelled = false
    fetchDatasetRowsBulk(pending)
      .then((fetched) => {
        if (cancelled) return
        setRowsByDataset((prev) => {
          const next = new Map(prev)
          for (const [id, rows] of fetched) next.set(id, rows)
          return next
        })
        setError('')
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeError(cause))
      })
    return () => {
      cancelled = true
    }
  }, [idsKey, rowsByDataset])

  const loading = (idsKey === '' ? [] : idsKey.split('\u0000')).some(
    (id) => !rowsByDataset.has(id),
  )
  return { rowsByDataset, loading, error }
}
