// 模板 schema 层测试（v6）：序列化 round-trip（数据块数据源、聚合函数体与类型、绑定/函数
// sidecar——结构化 fn 与自定义 expr 两形态、收紧到包围盒）、非法数据块/聚合/函数载荷
// 加载拒绝、normalizeRegions/normalizeAggregations/normalizeCellFunction 的校验口径
// （分组仅 down、行角色、agg 来源引用、引用名唯一、函数体必须 return、type 枚举、
// 空数据试跑的提交强校验/加载推导两模式、旧表达式嗅探）、v4/v5 → v6 迁移（含 type 推导）。
// 试跑能力按契约层口径注入（probeAggregationType 来自 domain/aggregation）。
import { describe, expect, test } from 'vitest'

import { FormDoc } from '../../src/domain/form-doc'
import { probeAggregationType } from '../../src/domain/aggregation'
import {
  FORM_BINDING_META_NAMESPACE,
  FORM_FUNCTION_META_NAMESPACE,
  TEMPLATE_SCHEMA_VERSION,
  formatBindingPlaceholder,
  formatFunctionPlaceholder,
  migrateTemplateToCurrent,
  normalizeAggregations,
  normalizeCellBinding,
  normalizeCellFunction,
  normalizeRegions,
  regionRefOf,
  type FormAggregation,
  type FormRegion,
  type FormTemplate,
} from '../../src/shared/template-schema'
import { ADDR, RANGE } from '../designer/testing/fixtures'

describe('序列化', () => {
  test('round-trip：保存 → 加载 → 再保存等价（含数据块数据源与聚合）', () => {
    const doc = FormDoc.create(8)
    doc.sheet.setCellValue(ADDR(0, 0), '出库单')
    doc.sheet.setCellStyle(RANGE(0, 0, 0, 5), {
      font: { bold: true, size: 16 },
      align: { horizontal: 'center' },
    })
    doc.sheet.mergeCells(RANGE(0, 0, 0, 5))
    doc.setRowHeight(0, 40)
    doc.setColWidth(0, 120)
    doc.setCellBinding(ADDR(0, 1), { path: 'order_no' })
    // 旧表达式形状写入：写入即嗅探为结构化（文档内不存在未规范化载荷）
    doc.setCellFunction(ADDR(1, 1), { expression: "SUM('数据块 1')" })
    doc.setRegionSource(0, {
      kind: 'dataset',
      datasetId: 'ds1',
      expression: 'rows[0]',
      path: '[0].items',
    })
    doc.setRegionExpand(0, 'down')

    const first = doc.toTemplate('测试模板')
    const restored = FormDoc.fromTemplate(first)
    const second = restored.toTemplate('测试模板')
    expect(JSON.parse(JSON.stringify(second))).toEqual(JSON.parse(JSON.stringify(first)))

    // 关键内容逐项断言（等价性的人类可读版）
    expect(first.schemaVersion).toBe(TEMPLATE_SCHEMA_VERSION)
    expect(first.aggregations).toEqual([])
    expect(first.regions[0]!.source).toEqual({
      kind: 'dataset',
      datasetId: 'ds1',
      expression: 'rows[0]',
      path: '[0].items',
    })
    expect(restored.sheet.getDisplayValue(ADDR(0, 0))).toBe('出库单')
    expect(restored.sheet.getCellInfo(ADDR(0, 3)).kind).toBe('merged-covered')
    expect(restored.sheet.getRowHeight(0)).toBe(40)
    expect(restored.sheet.getColWidth(0)).toBe(120)
    expect(restored.getCellBinding(ADDR(0, 1))).toEqual({ path: 'order_no' })
    expect(restored.getCellFunction(ADDR(1, 1))).toEqual({
      kind: 'fn',
      fn: 'SUM',
      region: '数据块 1',
    })
    expect(restored.regions[0]!.expand).toBe('down')
  })

  test('函数 sidecar 两形态 round-trip：结构化 fn（含省字段）与自定义 expr', () => {
    const doc = FormDoc.create(8)
    doc.setCellFunction(ADDR(0, 0), { kind: 'fn', fn: 'SUM', region: '数据块 1', field: 'qty' })
    doc.setCellFunction(ADDR(1, 0), { kind: 'fn', fn: 'SUM', region: '数据块 1' })
    doc.setCellFunction(ADDR(2, 0), { kind: 'fn', fn: 'GROUP' })
    doc.setCellFunction(ADDR(3, 0), { kind: 'expr', expression: 'item.qty * item.price' })
    const restored = FormDoc.fromTemplate(doc.toTemplate('t'))
    expect(restored.getCellFunction(ADDR(0, 0))).toEqual({
      kind: 'fn',
      fn: 'SUM',
      region: '数据块 1',
      field: 'qty',
    })
    expect(restored.getCellFunction(ADDR(1, 0))).toEqual({
      kind: 'fn',
      fn: 'SUM',
      region: '数据块 1',
    })
    expect(restored.getCellFunction(ADDR(2, 0))).toEqual({ kind: 'fn', fn: 'GROUP' })
    expect(restored.getCellFunction(ADDR(3, 0))).toEqual({
      kind: 'expr',
      expression: 'item.qty * item.price',
    })
  })

  test('聚合随模板 round-trip 不丢（函数体形态 + v6 类型）', () => {
    const doc = FormDoc.create(8)
    doc.setAggregations([
      {
        name: 'list',
        type: 'array',
        params: [{ datasetId: 'ds1', varName: 'rows' }],
        expression: 'return rows',
      },
      {
        name: 'total',
        type: 'value',
        params: [{ datasetId: 'ds1', varName: 'rows' }],
        expression: 'return rows.length',
      },
    ])
    const template = doc.toTemplate('t')
    expect(template.schemaVersion).toBe(6)
    const restored = FormDoc.fromTemplate(template)
    expect(restored.aggregations).toEqual(doc.aggregations)
    expect(restored.aggregations.map((agg) => agg.type)).toEqual(['array', 'value'])
  })

  test('模板 JSON 键集：无声明 cols、无打印弹框配置', () => {
    const doc = FormDoc.create(8)
    const json = doc.toTemplate('t')
    expect(Object.keys(json).sort()).toEqual([
      'aggregations',
      'name',
      'regions',
      'schemaVersion',
      'sheet',
    ])
    for (const forbidden of ['paper', 'margin', 'scale', 'pagination', 'pageSize', 'orientation']) {
      expect(JSON.stringify(json)).not.toContain(`"${forbidden}"`)
    }
  })

  test('非法数据块（重叠）在加载时被拒绝', () => {
    const template = FormDoc.create(8).toTemplate('t')
    const overlapping: FormTemplate = {
      ...template,
      regions: [
        { startRow: 0, endRow: 2, startCol: 0, endCol: 3, expand: 'none' },
        { startRow: 2, endRow: 2, startCol: 2, endCol: 5, expand: 'none' }, // 与上一块重叠
      ],
    }
    expect(() => FormDoc.fromTemplate(overlapping)).toThrow('重叠')
  })

  test('展开未绑数据源是合法中间态：加载与 round-trip 原样保留', () => {
    const template = FormDoc.create(8).toTemplate('t')
    const noSource: FormTemplate = {
      ...template,
      regions: [{ startRow: 0, endRow: 2, startCol: 0, endCol: 7, expand: 'down' }],
    }
    const doc = FormDoc.fromTemplate(noSource)
    expect(doc.regions[0]!.expand).toBe('down')
    expect(doc.regions[0]!.source).toBeUndefined()
    expect(doc.toTemplate('t').regions[0]).toEqual({
      startRow: 0,
      endRow: 2,
      startCol: 0,
      endCol: 7,
      expand: 'down',
    })
  })

  test('schemaVersion 不符的载荷在加载时直接拒绝', () => {
    const current = FormDoc.create(8).toTemplate('t')
    // 载荷来自网络/手改 JSON，类型上不可静态保证：按 unknown 构造非法输入，断言一次即可
    const wrongVersion: unknown = { ...current, schemaVersion: 3 }
    expect(() => FormDoc.fromTemplate(wrongVersion as FormTemplate)).toThrow('schemaVersion')
  })

  test('存量 repeat（每页重复）加载宽容丢弃：不报错，再落档不含 repeat', () => {
    const template = FormDoc.create(8).toTemplate('t')
    // 旧版设计器存出的 v6 行可能带 repeat；repeat 已从模型移除，加载静默丢弃
    const legacy: unknown = {
      ...template,
      regions: [{ startRow: 0, endRow: 2, startCol: 0, endCol: 7, expand: 'none', repeat: true }],
    }
    const doc = FormDoc.fromTemplate(legacy as FormTemplate)
    expect(doc.regions[0]).toEqual({
      startRow: 0,
      endRow: 2,
      startCol: 0,
      endCol: 7,
      expand: 'none',
    })
    expect(doc.toTemplate('t').regions[0]).not.toHaveProperty('repeat')
  })
})

describe('normalizeRegions：校验 + 数据源/分组口径', () => {
  test('允许空数组；展开方式未绑数据源是合法中间态（原样保留）', () => {
    expect(normalizeRegions([])).toEqual([])
    expect(
      normalizeRegions([{ startRow: 0, endRow: 0, startCol: 0, endCol: 0, expand: 'down' }]),
    ).toEqual([{ startRow: 0, endRow: 0, startCol: 0, endCol: 0, expand: 'down' }])
  })

  test('数据源完整性：datasetId 不能为空；agg 来源必须存在', () => {
    expect(() =>
      normalizeRegions([
        {
          startRow: 0,
          endRow: 0,
          startCol: 0,
          endCol: 0,
          expand: 'down',
          source: { kind: 'dataset', datasetId: '  ', path: '' },
        },
      ]),
    ).toThrow('数据集不能为空')
    expect(() =>
      normalizeRegions([
        {
          startRow: 0,
          endRow: 0,
          startCol: 0,
          endCol: 0,
          expand: 'down',
          source: { kind: 'agg', aggName: 'nope', path: '' },
        },
      ]),
    ).toThrow('聚合不存在')
  })

  test('不展开的数据块上的数据源原样保留（静态取第 1 条语义）', () => {
    const regions: FormRegion[] = [
      {
        startRow: 0,
        endRow: 0,
        startCol: 0,
        endCol: 0,
        expand: 'none',
        source: { kind: 'dataset', datasetId: ' ds1 ', path: '' },
      },
    ]
    expect(normalizeRegions(regions)[0]!.source).toEqual({
      kind: 'dataset',
      datasetId: 'ds1',
      path: '',
    })
  })

  test('分组仅支持纵向列表；组头/小计行要求已配分组字段', () => {
    const base = {
      startRow: 0,
      endRow: 1,
      startCol: 0,
      endCol: 0,
      expand: 'down' as const,
      source: { kind: 'dataset' as const, datasetId: 'ds1', path: '' },
    }
    expect(() => normalizeRegions([{ ...base, expand: 'right', groupBy: ['a'] }])).toThrow(
      '纵向列表',
    )
    expect(() =>
      normalizeRegions([
        {
          ...base,
          rowRoles: [{ row: 0, role: 'groupFooter' }],
        },
      ]),
    ).toThrow('组头/小计行')
    // 配了分组字段即合法，且越界角色行被剔除
    const ok = normalizeRegions([
      {
        ...base,
        groupBy: ['customer'],
        rowRoles: [
          { row: 0, role: 'groupFooter' },
          { row: 9, role: 'summary' }, // 越界 → 剔除
        ],
      },
    ])
    expect(ok[0]!.rowRoles).toEqual([{ row: 0, role: 'groupFooter' }])
  })

  test('数据块引用名唯一（自定义名与缺省「数据块 N」撞车也要拒绝）', () => {
    expect(() =>
      normalizeRegions([
        { startRow: 0, endRow: 0, startCol: 0, endCol: 0, expand: 'none', name: '数据块 2' },
        { startRow: 1, endRow: 1, startCol: 0, endCol: 0, expand: 'none' },
      ]),
    ).toThrow('引用名重复')
    // 显式命名互不冲突即合法
    const ok = normalizeRegions([
      { startRow: 0, endRow: 0, startCol: 0, endCol: 0, expand: 'none', name: '明细' },
      { startRow: 1, endRow: 1, startCol: 0, endCol: 0, expand: 'none' },
    ])
    expect(regionRefOf(ok[0]!, 0)).toBe('明细')
    expect(regionRefOf(ok[1]!, 1)).toBe('数据块 2')
  })
})

describe('normalizeAggregations：名字/形参/函数体/type 校验', () => {
  const base: FormAggregation = { name: 'a', type: 'value', params: [], expression: 'return 1' }
  /** 缺 type 的 v5 旧载荷（载荷来自网络/手改 JSON，类型上按 unknown 构造） */
  const withoutType = (agg: Omit<FormAggregation, 'type'>): FormAggregation =>
    agg as unknown as FormAggregation
  /** 引用了某聚合的数据块序列（推导回退判定用） */
  const referencing = (aggName: string): FormRegion[] => [
    {
      startRow: 0,
      endRow: 0,
      startCol: 0,
      endCol: 0,
      expand: 'down',
      source: { kind: 'agg', aggName, path: '' },
    },
  ]

  test('名字非空且唯一', () => {
    expect(() => normalizeAggregations([{ ...base, name: ' ' }])).toThrow('名字不能为空')
    expect(() => normalizeAggregations([base, { ...base, name: 'a' }])).toThrow('名字重复')
  })

  test('形参：数据集非空、变量名是合法标识符、不与保留名/彼此冲突', () => {
    expect(() =>
      normalizeAggregations([{ ...base, params: [{ datasetId: '', varName: 'x' }] }]),
    ).toThrow('未选数据集')
    expect(() =>
      normalizeAggregations([{ ...base, params: [{ datasetId: 'd', varName: '1x' }] }]),
    ).toThrow('标识符')
    expect(() =>
      normalizeAggregations([{ ...base, params: [{ datasetId: 'd', varName: 'agg' }] }]),
    ).toThrow('保留名')
    expect(() =>
      normalizeAggregations([
        {
          ...base,
          params: [
            { datasetId: 'd', varName: 'x' },
            { datasetId: 'd2', varName: 'x' },
          ],
        },
      ]),
    ).toThrow('变量名重复')
  })

  test('函数体非空', () => {
    expect(() => normalizeAggregations([{ ...base, expression: ' ' }])).toThrow('函数体不能为空')
  })

  test('函数体必须 return 返回结果（关键字检查，不做作用域级分析）', () => {
    expect(() => normalizeAggregations([{ ...base, expression: 'rows' }])).toThrow(
      '函数体必须 return 返回结果',
    )
    expect(() => normalizeAggregations([{ ...base, expression: 'const a = 1' }])).toThrow(
      '函数体必须 return',
    )
  })

  test('type 枚举合法：非法值两模式都拒绝（坏数据不静默吞）', () => {
    expect(() =>
      normalizeAggregations([{ ...base, type: 'list' } as unknown as FormAggregation]),
    ).toThrow('类型非法')
    expect(() =>
      normalizeAggregations([{ ...base, type: null } as unknown as FormAggregation]),
    ).toThrow('类型非法')
  })

  test('提交模式（submit）强校验：试跑抛错 / 返回形态与声明不一致都拒绝，报错带聚合名', () => {
    expect(() =>
      normalizeAggregations([{ ...base, type: 'array', expression: 'return 1' }], {
        mode: 'submit',
        probe: probeAggregationType,
      }),
    ).toThrow('聚合「a」声明为数组型，但空数据试跑返回了非数组')
    expect(() =>
      normalizeAggregations([{ ...base, type: 'value', expression: 'return []' }], {
        mode: 'submit',
        probe: probeAggregationType,
      }),
    ).toThrow('聚合「a」声明为非数组型，但空数据试跑返回了数组')
    expect(() =>
      normalizeAggregations([{ ...base, type: 'value', expression: "return agg.台账['x']" }], {
        mode: 'submit',
        probe: probeAggregationType,
      }),
    ).toThrow('聚合「a」用空数据试跑失败')
    // 声明与试跑一致即通过，type 原样保留
    expect(
      normalizeAggregations([{ ...base, type: 'array', expression: 'return []' }], {
        mode: 'submit',
        probe: probeAggregationType,
      }),
    ).toEqual([{ name: 'a', type: 'array', params: [], expression: 'return []' }])
  })

  test('提交模式缺 type：先推导再落档（推导失败同样拒绝，不给坏函数体开口子）', () => {
    expect(
      normalizeAggregations([withoutType({ name: 'a', params: [], expression: 'return []' })], {
        mode: 'submit',
        probe: probeAggregationType,
      }),
    ).toEqual([{ name: 'a', type: 'array', params: [], expression: 'return []' }])
    expect(() =>
      normalizeAggregations(
        [withoutType({ name: 'a', params: [], expression: 'return agg.前序.x' })],
        { mode: 'submit', probe: probeAggregationType },
      ),
    ).toThrow('聚合「a」用空数据试跑失败')
  })

  test('加载模式（缺省）只推导不卡：缺 type 试跑推导，推导失败按引用回退', () => {
    // 推导成功：返回数组 → array，返回值/对象 → value
    expect(
      normalizeAggregations([withoutType({ name: 'a', params: [], expression: 'return []' })], {
        probe: probeAggregationType,
      }),
    ).toEqual([{ name: 'a', type: 'array', params: [], expression: 'return []' }])
    expect(
      normalizeAggregations([withoutType({ name: 'a', params: [], expression: 'return 1' })], {
        probe: probeAggregationType,
      }),
    ).toEqual([{ name: 'a', type: 'value', params: [], expression: 'return 1' }])
    // 推导抛错（链式引用空 agg）：被数据块 agg 源引用 → array，无引用 → value
    const chained = withoutType({ name: 'a', params: [], expression: 'return agg.前序.x' })
    expect(
      normalizeAggregations([chained], {
        regions: referencing('a'),
        probe: probeAggregationType,
      }),
    ).toEqual([{ name: 'a', type: 'array', params: [], expression: 'return agg.前序.x' }])
    expect(normalizeAggregations([chained], { probe: probeAggregationType })).toEqual([
      { name: 'a', type: 'value', params: [], expression: 'return agg.前序.x' },
    ])
  })

  test('加载模式声明即信任：不试跑、不与实际比对（旧档加载不被卡）', () => {
    expect(normalizeAggregations([{ ...base, type: 'array', expression: 'return 1' }])).toEqual([
      { name: 'a', type: 'array', params: [], expression: 'return 1' },
    ])
  })
})

describe('v4/v5 → v6 迁移（migrateTemplateToCurrent）', () => {
  /** v5 模板：聚合缺 type（v6 之前没有该字段；载荷按 unknown 构造） */
  function v5Template(
    aggregations: Omit<FormAggregation, 'type'>[],
    regions: FormRegion[] = [],
  ): FormTemplate {
    const current = FormDoc.create(8).toTemplate('t')
    return {
      ...current,
      schemaVersion: 5,
      regions,
      aggregations,
    } as unknown as FormTemplate
  }

  /** v4 模板：聚合 expression 还是单表达式（载荷来自库内旧行，类型上按 unknown 构造） */
  function v4Template(aggregations: FormTemplate['aggregations']): FormTemplate {
    const current = FormDoc.create(8).toTemplate('t')
    return { ...current, schemaVersion: 4, aggregations } as unknown as FormTemplate
  }

  test('v4 聚合单表达式包一层 return (…) 并推导 type，其余字段原样保留', () => {
    const v4 = v4Template([
      {
        name: 'order',
        params: [{ datasetId: 'd1', varName: 'orders' }],
        expression: 'orders.slice(0, 1)',
      } as unknown as FormTemplate['aggregations'][number],
    ])
    const migrated = migrateTemplateToCurrent(v4, probeAggregationType)
    expect(migrated.schemaVersion).toBe(TEMPLATE_SCHEMA_VERSION)
    // orders 传空数组 → slice 结果是数组 → 试跑推导 array
    expect(migrated.aggregations).toEqual([
      {
        name: 'order',
        params: [{ datasetId: 'd1', varName: 'orders' }],
        type: 'array',
        expression: 'return (\norders.slice(0, 1)\n);',
      },
    ])
    expect(migrated.regions).toEqual(v4.regions)
    expect(migrated.sheet).toEqual(v4.sheet)
  })

  test('v5 缺 type：空数据试跑推导（返回数组 → array，返回值/对象 → value）', () => {
    const migrated = migrateTemplateToCurrent(
      v5Template([
        { name: 'list', params: [], expression: 'return []' },
        { name: 'total', params: [], expression: 'return 1' },
        { name: 'overview', params: [], expression: 'return { n: 1 }' },
      ]),
      probeAggregationType,
    )
    expect(migrated.schemaVersion).toBe(TEMPLATE_SCHEMA_VERSION)
    expect(migrated.aggregations.map((agg) => agg.type)).toEqual(['array', 'value', 'value'])
  })

  test('v5 缺 type 且试跑抛错（链式引用空 agg）：按数据块引用回退，不断链不卡加载', () => {
    // 被数据块 agg 源引用 → 回退 array；无引用 → 回退 value
    const regions: FormRegion[] = [
      {
        startRow: 0,
        endRow: 0,
        startCol: 0,
        endCol: 0,
        expand: 'down',
        source: { kind: 'agg', aggName: '台账', path: '' },
      },
    ]
    const migrated = migrateTemplateToCurrent(
      v5Template(
        [
          { name: '台账', params: [], expression: 'return [...agg.明细.values()]' },
          { name: '总览', params: [], expression: 'return agg.台账.length' },
        ],
        regions,
      ),
      probeAggregationType,
    )
    expect(migrated.aggregations.map((agg) => agg.type)).toEqual(['array', 'value'])
  })

  test('迁移结果可直接按 v6 加载（含 type 与 return 校验），再迁移幂等', () => {
    const migrated = migrateTemplateToCurrent(
      v4Template([
        {
          name: 'a',
          params: [],
          expression: '1',
        } as unknown as FormTemplate['aggregations'][number],
      ]),
      probeAggregationType,
    )
    const doc = FormDoc.fromTemplate(migrated)
    expect(doc.aggregations[0]!.expression).toBe('return (\n1\n);')
    expect(doc.aggregations[0]!.type).toBe('value')
    expect(migrateTemplateToCurrent(migrated)).toEqual(migrated)
  })

  test('v5 数据块携带的 repeat 迁移时剥掉：v6 文档不含 repeat', () => {
    const regions: FormRegion[] = [
      {
        startRow: 0,
        endRow: 1,
        startCol: 0,
        endCol: 3,
        expand: 'none',
        repeat: true,
        name: '表头',
      } as unknown as FormRegion,
    ]
    const migrated = migrateTemplateToCurrent(v5Template([], regions))
    expect(migrated.regions[0]).toEqual({
      startRow: 0,
      endRow: 1,
      startCol: 0,
      endCol: 3,
      expand: 'none',
      name: '表头',
    })
    expect(migrated.regions[0]).not.toHaveProperty('repeat')
  })

  test('比 v4 更老的版本抛错（无可迁移路径）', () => {
    const current = FormDoc.create(8).toTemplate('t')
    const tooOld = { ...current, schemaVersion: 3 } as unknown as FormTemplate
    expect(() => migrateTemplateToCurrent(tooOld)).toThrow('schemaVersion')
  })
})

describe('sidecar 形状与函数载荷 normalize', () => {
  test('相对绑定只有 path：sidecar 原样落盘', () => {
    const template = FormDoc.create(8).toTemplate('t')
    const sheet = {
      ...template.sheet,
      meta: [{ row: 0, col: 0, namespace: FORM_BINDING_META_NAMESPACE, payload: { path: 'name' } }],
    }
    const restored = FormDoc.fromTemplate({ ...template, sheet })
    expect(restored.getCellBinding(ADDR(0, 0))).toEqual({ path: 'name' })
  })

  test('聚合引用绑定（kind:"agg"）round-trip 不丢；占位符 {{agg.名[.路径]}}', () => {
    const template = FormDoc.create(8).toTemplate('t')
    const sheet = {
      ...template.sheet,
      meta: [
        {
          row: 0,
          col: 0,
          namespace: FORM_BINDING_META_NAMESPACE,
          payload: { kind: 'agg', aggName: 'head', path: 'customer.name' },
        },
        {
          row: 1,
          col: 0,
          namespace: FORM_BINDING_META_NAMESPACE,
          payload: { kind: 'agg', aggName: '总计', path: '' },
        },
      ],
    }
    const restored = FormDoc.fromTemplate({ ...template, sheet })
    expect(restored.getCellBinding(ADDR(0, 0))).toEqual({
      kind: 'agg',
      aggName: 'head',
      path: 'customer.name',
    })
    expect(restored.getCellBinding(ADDR(1, 0))).toEqual({ kind: 'agg', aggName: '总计', path: '' })
    expect(formatBindingPlaceholder(restored.getCellBinding(ADDR(0, 0))!)).toBe(
      '{{agg.head.customer.name}}',
    )
    expect(formatBindingPlaceholder(restored.getCellBinding(ADDR(1, 0))!)).toBe('{{agg.总计}}')
  })

  test('normalizeCellBinding：相对 path 字符串 / agg 名非空 / kind 枚举外的非法载荷拒绝', () => {
    expect(normalizeCellBinding({ path: ' a ' })).toEqual({ path: 'a' })
    expect(normalizeCellBinding({ kind: 'agg', aggName: ' head ', path: ' a.b ' })).toEqual({
      kind: 'agg',
      aggName: 'head',
      path: 'a.b',
    })
    expect(normalizeCellBinding({ kind: 'agg', aggName: 'head', path: '' })).toEqual({
      kind: 'agg',
      aggName: 'head',
      path: '',
    })
    expect(() => normalizeCellBinding({ kind: 'agg', aggName: '  ', path: '' })).toThrow(
      '聚合名不能为空',
    )
    expect(() => normalizeCellBinding({ kind: 'ref', path: '' })).toThrow('kind 非法')
    expect(() => normalizeCellBinding({})).toThrow('path')
    expect(() => normalizeCellBinding('x')).toThrow('必须是对象')
  })

  test('旧载荷（只有 expression、无 kind）加载时嗅探转换，占位符格式不变', () => {
    const template = FormDoc.create(8).toTemplate('t')
    const sheet = {
      ...template.sheet,
      meta: [
        {
          row: 0,
          col: 0,
          namespace: FORM_FUNCTION_META_NAMESPACE,
          payload: { expression: "SUM('数据块 1', 'qty')" },
        },
        {
          row: 1,
          col: 0,
          namespace: FORM_FUNCTION_META_NAMESPACE,
          payload: { expression: 'item.qty * item.price' },
        },
      ],
    }
    const restored = FormDoc.fromTemplate({ ...template, sheet })
    expect(restored.getCellFunction(ADDR(0, 0))).toEqual({
      kind: 'fn',
      fn: 'SUM',
      region: '数据块 1',
      field: 'qty',
    })
    // 不可迁移的表达式原样保留为 expr；可迁移的合成同一占位符文本
    expect(restored.getCellFunction(ADDR(1, 0))).toEqual({
      kind: 'expr',
      expression: 'item.qty * item.price',
    })
    expect(formatFunctionPlaceholder(restored.getCellFunction(ADDR(0, 0))!)).toBe(
      "{{SUM('数据块 1', 'qty')}}",
    )
  })

  test('新形状字段的收敛：field 空串视为省略、region 前后空白剔除', () => {
    expect(normalizeCellFunction({ kind: 'fn', fn: 'SUM', region: ' 明细 ', field: '  ' })).toEqual(
      { kind: 'fn', fn: 'SUM', region: '明细' },
    )
    expect(normalizeCellFunction({ kind: 'fn', fn: 'GROUP', field: '客户' })).toEqual({
      kind: 'fn',
      fn: 'GROUP',
      field: '客户',
    })
    expect(normalizeCellFunction({ kind: 'expr', expression: ' 1 + 1 ' })).toEqual({
      kind: 'expr',
      expression: '1 + 1',
    })
  })

  test('非法载荷拒绝：fn 枚举外 / region 空 / expr 空表达式 / kind 未知', () => {
    expect(() => normalizeCellFunction({ kind: 'fn', fn: 'MEDIAN', region: '明细' })).toThrow(
      '函数名非法',
    )
    expect(() => normalizeCellFunction({ kind: 'fn', fn: 'SUM', region: '  ' })).toThrow(
      '数据块不能为空',
    )
    expect(() => normalizeCellFunction({ kind: 'expr', expression: ' ' })).toThrow('不能为空')
    expect(() => normalizeCellFunction({ kind: 'calc', expression: '1' })).toThrow('kind 非法')
    expect(() => normalizeCellFunction('SUM(1)')).toThrow('必须是对象')
  })

  test('非法函数载荷在模板加载时整包拒绝（不静默吞坏数据）', () => {
    const template = FormDoc.create(8).toTemplate('t')
    const sheet = {
      ...template.sheet,
      meta: [
        {
          row: 0,
          col: 0,
          namespace: FORM_FUNCTION_META_NAMESPACE,
          payload: { kind: 'fn', fn: 'TOTAL', region: 'x' },
        },
      ],
    }
    expect(() => FormDoc.fromTemplate({ ...template, sheet })).toThrow('函数名非法')
  })
})
