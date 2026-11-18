// @vitest-environment happy-dom

// App 主装配与分层集成测试：
// 1. api.ts 新增 fetchTableBundle / batchAppendRecords（含行级 errors 到 ApiError）及 createSmartApp/updateSmartApp 派生字段透传
// 2. ?entry=<tableId> 独立录入端入口分流（normal 表单表直达、advanced/404 不可用提示、返回工作台）
// 3. 数据源中心：仅原始字段求值、onColWidthChange 持久化到 SmartTableMeta.columns、ColumnManagerModal 更新 required/align
// 4. 智能表格工作区：管线传入 derivedColumns/lookupOverrides、消歧覆盖写回 SmartApp.lookupOverrides、增删改派生列写回 SmartApp.derivedColumns 并同步清理视图引用

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  ApiError,
  batchAppendRecords,
  createSmartApp,
  fetchTableBundle,
  updateSmartApp,
} from '../../src/api'
import type { SmartGridOptions, SmartGridSetDataExtra } from '../../src/canvas/smart-grid'
import type { TableBundle } from '../../src/shared/api-types'
import type { SmartApp, SmartColumn, SmartRecord, WorkspaceView } from '../../src/shared/schema'

const gridBridge = vi.hoisted(() => ({
  lastOptions: null as SmartGridOptions | null,
  lastSetData: null as {
    columns: readonly SmartColumn[]
    records: readonly SmartRecord[]
    extra?: SmartGridSetDataExtra
  } | null,
}))

vi.mock('../../src/canvas/smart-grid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/canvas/smart-grid')>()
  class MockSmartGridAdapter {
    constructor(options: SmartGridOptions) {
      gridBridge.lastOptions = options
      gridBridge.lastSetData = {
        columns: options.columns,
        records: options.records,
        extra: {
          view: options.view,
          summaries: options.summaries,
          summaryResults: options.summaryResults,
          totalCount: options.totalCount,
        },
      }
    }
    setData(
      columns: readonly SmartColumn[],
      records: readonly SmartRecord[],
      _conflictsByRow?: unknown,
      _sortRules?: unknown,
      extra?: SmartGridSetDataExtra,
    ) {
      gridBridge.lastSetData = { columns, records, extra }
    }
    setWatermark() {}
    scrollToRecord() {}
    getCellViewportRect() {
      return { x: 120, y: 140, width: 120, height: 36 }
    }
    getSelectionInfo() {
      return { ranges: [], recordIds: [], columnKeys: [], focus: null }
    }
    startEditCell() {}
    destroy() {}
  }
  return {
    ...actual,
    SmartGridAdapter: MockSmartGridAdapter,
  }
})

import { App } from '../../src/App'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface FetchCallRecord {
  method: string
  url: string
  body?: unknown
}

function makeFixtures() {
  const tables: TableBundle[] = [
    {
      meta: {
        id: 'tbl_1',
        name: '项目台账',
        kind: 'normal',
        columns: [
          { key: 'title', title: '项目名称', type: 'text', width: 140, required: true },
          { key: 'owner', title: '负责人', type: 'person', width: 110 },
          {
            key: 'amount',
            title: '合同金额',
            type: 'number',
            width: 120,
            numberFormat: 'currency',
          },
        ],
        views: [],
        summaries: { amount: 'sum' },
      },
      records: [
        { _id: 'r1', title: '一期工程', owner: '张三', amount: 10000 },
        { _id: 'r2', title: '二期工程', owner: '李四', amount: 20000 },
      ],
    },
    {
      meta: {
        id: 'tbl_emp',
        name: '员工花名册',
        kind: 'advanced',
        primaryKeyField: 'emp_id',
        sourceSqlTable: 'biz_employees',
        system: true,
        columns: [
          { key: 'emp_id', title: '工号', type: 'text', width: 100, isUniqueKey: true },
          { key: 'name', title: '姓名', type: 'person', width: 100 },
          { key: 'dept', title: '部门', type: 'text', width: 110 },
        ],
        views: [],
        summaries: {},
      },
      records: [
        { _id: 'EMP-1', emp_id: 'EMP-1', name: '张三', dept: '研发部' },
        { _id: 'EMP-2', emp_id: 'EMP-2', name: '张三', dept: '交付部' },
        { _id: 'EMP-3', emp_id: 'EMP-3', name: '李四', dept: '市场部' },
      ],
    },
  ]

  const apps: SmartApp[] = [
    {
      id: 'app_1',
      name: '项目驾驶舱',
      tableId: 'tbl_1',
      sortOrder: 0,
      derivedColumns: [
        {
          key: 'lookup_dept',
          title: '所属部门',
          type: 'lookup',
          width: 120,
          lookupConfig: {
            groupId: 'grp_emp',
            targetTableId: 'tbl_emp',
            matchRules: [{ sourceField: 'owner', targetField: 'name' }],
            targetReturnField: 'dept',
            mode: 'one',
          },
        },
        {
          key: 'formula_tax',
          title: '含税金额',
          type: 'formula',
          width: 120,
          formulaExpr: '[合同金额] * 1.06',
        },
      ],
      lookupOverrides: {},
    },
  ]

  const views: WorkspaceView[] = [
    {
      id: 'v_table',
      appId: 'app_1',
      tableId: 'tbl_1',
      name: '明细表',
      type: 'table',
      sortOrder: 0,
      filterGroup: {
        conjunction: 'and',
        conditions: [{ id: 'f1', field: 'formula_tax', operator: 'gt', value: 0 }],
      },
      quickFilterFields: ['lookup_dept'],
      sortRules: [],
      columnOrder: ['title', 'owner', 'amount', 'lookup_dept', 'formula_tax'],
      summaries: { amount: 'sum', formula_tax: 'sum' },
    },
  ]

  return { tables, apps, views }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
  })
}

const mountedRoots: Array<{ unmount: () => void; container: HTMLElement }> = []

function mountApp() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(App))
  })
  const handle = {
    container,
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
  mountedRoots.push(handle)
  return handle
}

beforeEach(() => {
  gridBridge.lastOptions = null
  gridBridge.lastSetData = null
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  while (mountedRoots.length > 0) {
    mountedRoots.pop()!.unmount()
  }
  vi.restoreAllMocks()
})

describe('api.ts 客户端契约', () => {
  test('fetchTableBundle、batchAppendRecords（保留行级 errors）与 create/updateSmartApp 透传派生字段', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        const method = (init?.method ?? 'GET').toUpperCase()
        const rawBody = typeof init?.body === 'string' ? init.body : ''
        if (url === '/api/tables/tbl_1' && method === 'GET') {
          return jsonResponse(makeFixtures().tables[0])
        }
        if (url === '/api/tables/tbl_1/records/batch' && method === 'POST') {
          return jsonResponse(
            {
              message: '批量校验失败：第 1 行存在错误',
              errors: [
                {
                  rowIndex: 0,
                  field: 'title',
                  columnTitle: '项目名称',
                  message: '项目名称为必填项',
                },
              ],
            },
            400,
          )
        }
        if (url === '/api/apps' && method === 'POST') {
          const body = JSON.parse(rawBody) as Record<string, unknown>
          return jsonResponse(
            {
              app: { id: 'app_new', sortOrder: 1, ...body },
              defaultView: {
                id: 'v_new',
                appId: 'app_new',
                tableId: body.tableId,
                name: '数据明细视图',
                type: 'table',
                sortOrder: 0,
                filterGroup: { conjunction: 'and', conditions: [] },
                quickFilterFields: [],
                sortRules: [],
              },
            },
            201,
          )
        }
        if (url === '/api/apps/app_1' && method === 'PATCH') {
          const body = JSON.parse(rawBody) as Record<string, unknown>
          return jsonResponse({ app: { ...makeFixtures().apps[0], ...body } })
        }
        return jsonResponse({ message: 'Not Found' }, 404)
      },
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const bundle = await fetchTableBundle('tbl_1')
    expect(bundle.meta.id).toBe('tbl_1')

    await expect(batchAppendRecords('tbl_1', [{ title: '' }])).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      errors: [
        { rowIndex: 0, field: 'title', columnTitle: '项目名称', message: '项目名称为必填项' },
      ],
    })
    let caught: unknown
    try {
      await batchAppendRecords('tbl_1', [{ title: '' }])
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).errors).toHaveLength(1)

    const derivedColumns = makeFixtures().apps[0]!.derivedColumns!
    const lookupOverrides = { r1: { grp_emp: 'EMP-2' } }
    const created = await createSmartApp({
      name: '新建应用',
      tableId: 'tbl_1',
      derivedColumns,
      lookupOverrides,
    })
    expect(created.app.derivedColumns).toHaveLength(2)
    expect(created.app.lookupOverrides).toEqual(lookupOverrides)

    const updated = await updateSmartApp('app_1', {
      derivedColumns: derivedColumns.slice(0, 1),
      lookupOverrides,
    })
    expect(updated.derivedColumns).toHaveLength(1)
    expect(updated.lookupOverrides).toEqual(lookupOverrides)
  })
})

describe('App.tsx 入口分流与三层隔离集成', () => {
  function setupWorkspaceFetch() {
    const state = makeFixtures()
    const calls: FetchCallRecord[] = []
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        const method = (init?.method ?? 'GET').toUpperCase()
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        calls.push({ method, url, body })

        if (url === '/api/tables' && method === 'GET') {
          return jsonResponse({ tables: state.tables })
        }
        if (url === '/api/tables/tbl_1' && method === 'GET') {
          return jsonResponse(state.tables[0])
        }
        if (url === '/api/tables/tbl_emp' && method === 'GET') {
          return jsonResponse(state.tables[1])
        }
        if (url === '/api/apps' && method === 'GET') {
          return jsonResponse({ apps: state.apps })
        }
        if (url === '/api/views' && method === 'GET') {
          return jsonResponse({ views: state.views })
        }
        if (url === '/api/tables/tbl_1/meta' && method === 'PUT') {
          const nextMeta = (body as { meta: TableBundle['meta'] }).meta
          state.tables[0] = { ...state.tables[0]!, meta: nextMeta }
          return jsonResponse({ meta: nextMeta })
        }
        if (url === '/api/apps/app_1' && method === 'PATCH') {
          state.apps[0] = { ...state.apps[0]!, ...(body as Partial<SmartApp>) }
          return jsonResponse({ app: state.apps[0] })
        }
        if (url === '/api/views/v_table' && method === 'PATCH') {
          state.views[0] = { ...state.views[0]!, ...(body as Partial<WorkspaceView>) }
          return jsonResponse({ view: state.views[0] })
        }
        return jsonResponse({ message: '表不存在' }, 404)
      },
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    return { state, calls }
  }

  test('?entry=<normalTableId> 仅拉取单表进入 EntryWorkspace，返回工作台后清理参数并加载完整工作台', async () => {
    window.history.replaceState(null, '', '/?entry=tbl_1')
    const { calls } = setupWorkspaceFetch()

    const { container } = mountApp()
    await flushAsync()

    // 仅请求单表接口，不请求 /api/apps、/api/views、/api/tables
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /api/tables/tbl_1'])
    expect(container.textContent).toContain('项目台账')
    expect(container.textContent).toContain('数据录入端')
    expect(container.querySelector('[aria-label="智能表格"]')).toBeNull()
    expect(container.querySelector('[aria-label="数据源中心"]')).toBeNull()

    // 点击「工作台」返回主工作台
    const backBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('工作台'),
    )!
    act(() => {
      backBtn.click()
    })
    await flushAsync()

    expect(window.location.search).toBe('')
    expect(calls.some((c) => c.url === '/api/apps')).toBe(true)
    expect(calls.some((c) => c.url === '/api/views')).toBe(true)
    expect(container.textContent).toContain('项目驾驶舱')
  })

  test('?entry=<advancedTableId> 与不存在表展示不可用提示与返回工作台入口', async () => {
    window.history.replaceState(null, '', '/?entry=tbl_emp')
    setupWorkspaceFetch()

    const firstMount = mountApp()
    await flushAsync()

    expect(firstMount.container.textContent).toContain('独立数据录入端不可用')
    expect(firstMount.container.textContent).toContain('SQL 主数据表')
    expect(firstMount.container.textContent).toContain('返回工作台')
    firstMount.unmount()

    window.history.replaceState(null, '', '/?entry=tbl_missing')
    const secondMount = mountApp()
    await flushAsync()
    expect(secondMount.container.textContent).toContain('独立数据录入端不可用')
    expect(secondMount.container.textContent).toContain('返回工作台')
  })

  test('SmartApp 管线运行派生列与消歧锁定并持久化到 SmartApp，删除派生列同步清理视图引用', async () => {
    const { state, calls } = setupWorkspaceFetch()
    const { container } = mountApp()
    await flushAsync()

    // 1) SmartApp 管线产出包含原始列 + 派生列，且按 lookupOverrides/VLOOKUP 求值
    const gridCols = gridBridge.lastSetData?.columns ?? []
    expect(gridCols.map((c) => c.key)).toEqual([
      'title',
      'owner',
      'amount',
      'lookup_dept',
      'formula_tax',
    ])
    const r1 = gridBridge.lastSetData?.records.find((r) => r._id === 'r1')
    expect(r1?.formula_tax).toBeCloseTo(10600)

    // 2) 重名消歧覆盖持久化到 SmartApp.lookupOverrides（不写表记录）
    const lookupCol = gridCols.find((c) => c.key === 'lookup_dept')!
    const conflict = gridBridge.lastOptions?.conflictsByRow?.get('r1')?.get('grp_emp')
    expect(conflict).toBeDefined()
    act(() => {
      gridBridge.lastOptions?.onConflictClick?.({
        record: r1!,
        column: lookupCol,
        conflict: conflict!,
        rect: { x: 100, y: 120, width: 120, height: 32 },
      })
    })

    const candidateBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('交付部'),
    )!
    await act(async () => {
      candidateBtn.click()
    })
    await flushAsync()

    const appPatchCall = calls.find((c) => c.method === 'PATCH' && c.url === '/api/apps/app_1')
    expect(appPatchCall?.body).toEqual({
      lookupOverrides: { r1: { grp_emp: 'EMP-2' } },
    })
    expect(calls.some((c) => c.url.includes('/records/'))).toBe(false)
    expect(gridBridge.lastSetData?.records.find((r) => r._id === 'r1')?.lookup_dept).toBe('交付部')

    // 3) SmartApp 内增删派生列写回 SmartApp.derivedColumns，删除同步清理视图引用，且不写表结构
    const manageBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('派生列管理'),
    )!
    act(() => {
      manageBtn.click()
    })
    expect(container.textContent).toContain('底层数据源原始列（只读')

    const deleteFormulaBtn = container.querySelector(
      'button[aria-label="删除派生列 含税金额"]',
    ) as HTMLButtonElement
    act(() => {
      deleteFormulaBtn.click()
    })
    const confirmDeleteBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '删除字段',
    )!
    await act(async () => {
      confirmDeleteBtn.click()
    })
    await flushAsync()

    expect(state.apps[0]!.derivedColumns?.map((c) => c.key)).toEqual(['lookup_dept'])
    expect(calls.some((c) => c.url === '/api/tables/tbl_1/meta')).toBe(false)
    // 视图中对该公式列的筛选、列序、汇总引用已同步清理
    expect(state.views[0]!.filterGroup.conditions).toHaveLength(0)
    expect(state.views[0]!.columnOrder).not.toContain('formula_tax')
    expect(state.views[0]!.summaries).not.toHaveProperty('formula_tax')

    // 3b) SmartApp 内新增公式列持久化到 SmartApp.derivedColumns，不修改源表结构
    const addFormulaBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('新增公式列'),
    )!
    act(() => {
      addFormulaBtn.click()
    })
    const formulaTitleInput = container.querySelector('#st-add-col-title') as HTMLInputElement
    const formulaExprInput = container.querySelector('#st-formula-expr') as HTMLInputElement
    act(() => {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      desc?.set?.call(formulaTitleInput, '净额')
      formulaTitleInput.dispatchEvent(new Event('input', { bubbles: true }))
      formulaTitleInput.dispatchEvent(new Event('change', { bubbles: true }))
      desc?.set?.call(formulaExprInput, '[合同金额] * 0.9')
      formulaExprInput.dispatchEvent(new Event('input', { bubbles: true }))
      formulaExprInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const addColForm = container
      .querySelector('#st-add-col-title')
      ?.closest('form') as HTMLFormElement
    await act(async () => {
      addColForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flushAsync()

    expect(
      state.apps[0]!.derivedColumns?.some((c) => c.title === '净额' && c.type === 'formula'),
    ).toBe(true)
    expect(calls.some((c) => c.url === '/api/tables/tbl_1/meta')).toBe(false)

    // 4) 从 SmartApp 跳转数据源中心：仅运行原始字段、暴露录入页按钮、拖拽列宽与字段配置写回 SmartTableMeta.columns
    const jumpDsBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '数据源',
    )!
    act(() => {
      jumpDsBtn.click()
    })
    await flushAsync()

    expect(gridBridge.lastSetData?.columns.map((c) => c.key)).toEqual(['title', 'owner', 'amount'])
    expect(container.textContent).toContain('打开录入页')
    expect(container.textContent).toContain('复制录入链接')

    const amountCol = state.tables[0]!.meta.columns.find((c) => c.key === 'amount')!
    await act(async () => {
      gridBridge.lastOptions?.onColWidthChange?.({
        column: amountCol,
        columnKey: 'amount',
        colIndex: 2,
        width: 215,
      })
    })
    await flushAsync()

    const metaPutCall = calls.find((c) => c.method === 'PUT' && c.url === '/api/tables/tbl_1/meta')
    expect(metaPutCall).toBeDefined()
    expect(state.tables[0]!.meta.columns.find((c) => c.key === 'amount')?.width).toBe(215)

    // 数据源中心字段管理修改 required / align 持久化到 SmartTableMeta.columns
    const dsColMgrBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('字段管理'),
    )!
    act(() => {
      dsColMgrBtn.click()
    })
    const ownerReqCheckbox = container.querySelector(
      'input[aria-label="负责人 必填"]',
    ) as HTMLInputElement
    await act(async () => {
      ownerReqCheckbox.click()
    })
    await flushAsync()
    expect(state.tables[0]!.meta.columns.find((c) => c.key === 'owner')?.required).toBe(true)
  })
})
