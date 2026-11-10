// 数据集取数服务测试：并发同 id 去重（同一时刻只执行一次数据集）、多 id 并行、
// QueryResult → 原始行的转换口径、错误传播与「结算后出表」的重取语义。
// api 层（data/api.ts 的 request）最终走全局 fetch——测试打桩 globalThis.fetch，
// 不碰模块注册表；由此连带锁住 api 层的错误文案口径（message → 状态码回落）。
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { QueryResult } from '../../src/shared/api-types'
import { fetchDatasetRows, fetchDatasetRowsBulk } from '../../src/data/dataset-service'

/** 成功响应：QueryResult JSON（Response 最小形态，api.request 只读 ok/status/json） */
const okResponse = (result: QueryResult): Response =>
  ({ ok: true, status: 200, json: async () => result }) as unknown as Response

/** 失败响应：服务端 message 文案（api.request 的错误口径） */
const errorResponse = (message: string, status = 500): Response =>
  ({ ok: false, status, json: async () => ({ message }) }) as unknown as Response

/** 断言 promise 以指定 message 拒绝（bun:test 的 expect().rejects 返回类型不含 Promise，lint 不认 await） */
const expectReject = async (promise: Promise<unknown>, message: string): Promise<void> => {
  try {
    await promise
  } catch (error) {
    expect((error as Error).message).toBe(message)
    return
  }
  throw new Error(`应抛出「${message}」但成功返回`)
}

/** 数据集 id → 可编程响应；未编排的 id 是测试编排失误，直接炸出来 */
const responses = new Map<string, () => Promise<Response>>()

/** 请求 URL 里的数据集 id（/api/datasets/{id}/execute） */
const datasetIdOfUrl = (url: string): string => {
  const hit = /\/api\/datasets\/([^/]+)\/execute$/.exec(url)
  if (!hit) throw new Error(`不是数据集执行请求：${url}`)
  return hit[1]!
}

const fetchMock = mock(async (input: string | URL | Request): Promise<Response> => {
  return responses.get(datasetIdOfUrl(String(input)))!()
})

const realFetch = globalThis.fetch
globalThis.fetch = fetchMock as unknown as typeof fetch

afterAll(() => {
  globalThis.fetch = realFetch
})

beforeEach(() => {
  responses.clear()
  fetchMock.mockClear()
})

describe('取数与转换口径', () => {
  test('QueryResult（columns + 行值数组）→ 列名到值的行对象', async () => {
    responses.set(
      'ds1',
      async () => okResponse({ columns: ['no', 'qty'], rows: [['A1', 2], ['A2', 5]] }),
    )
    expect(await fetchDatasetRows('ds1')).toEqual([
      { no: 'A1', qty: 2 },
      { no: 'A2', qty: 5 },
    ])
  })

  test('多 id 并行：各执行一次并汇总为 Map', async () => {
    responses.set('a', async () => okResponse({ columns: ['x'], rows: [[1]] }))
    responses.set('b', async () => okResponse({ columns: ['y'], rows: [[2]] }))
    responses.set('c', async () => okResponse({ columns: ['z'], rows: [[3]] }))
    const rowsByDataset = await fetchDatasetRowsBulk(['a', 'b', 'c'])
    expect(rowsByDataset.get('a')).toEqual([{ x: 1 }])
    expect(rowsByDataset.get('b')).toEqual([{ y: 2 }])
    expect(rowsByDataset.get('c')).toEqual([{ z: 3 }])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('并发去重', () => {
  test('同时请求同一数据集只执行一次，共享同一结算结果', async () => {
    let release!: (result: QueryResult) => void
    // 用门闩挂住首个请求：第二个调用必须发生在结算之前，才算真正的并发
    const gate = new Promise<QueryResult>((resolve) => (release = resolve))
    responses.set('ds1', () => gate.then(okResponse))
    const first = fetchDatasetRows('ds1')
    const second = fetchDatasetRows('ds1')
    release({ columns: ['name'], rows: [['甲']] })
    const [rowsA, rowsB] = await Promise.all([first, second])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(rowsA).toEqual([{ name: '甲' }])
    expect(rowsB).toBe(rowsA)
  })

  test('同一批内重复的 id 也只执行一次', async () => {
    responses.set('a', async () => okResponse({ columns: ['x'], rows: [[1]] }))
    const rowsByDataset = await fetchDatasetRowsBulk(['a', 'a'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(rowsByDataset.get('a')).toEqual([{ x: 1 }])
  })
})

describe('错误传播', () => {
  test('任一数据集失败 → 整批拒绝，文案来自服务端 message', async () => {
    responses.set('a', async () => okResponse({ columns: ['x'], rows: [[1]] }))
    responses.set('bad', async () => errorResponse('数据集不存在', 404))
    await expectReject(fetchDatasetRowsBulk(['a', 'bad']), '数据集不存在')
  })

  test('无 message 的失败响应回落状态码文案', async () => {
    responses.set(
      'bad',
      async () => ({ ok: false, status: 502, json: async () => null }) as unknown as Response,
    )
    await expectReject(fetchDatasetRows('bad'), '请求失败（502）')
  })
})

describe('结算后出表（不留缓存）', () => {
  test('失败后重新调用会再次执行；成功同样不缓存', async () => {
    let fail = true
    responses.set(
      'ds1',
      async () => (fail ? errorResponse('SQL 报错') : okResponse({ columns: ['n'], rows: [[1]] })),
    )
    await expectReject(fetchDatasetRows('ds1'), 'SQL 报错')
    fail = false
    expect(await fetchDatasetRows('ds1')).toEqual([{ n: 1 }])
    // 「试运行每次全量重取」的口径：成功的请求也不留缓存，下次调用重新执行
    await fetchDatasetRowsBulk(['ds1'])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
