// 模板 schema 层测试：序列化 round-trip（区域数据源、绑定 sidecar、收紧到包围盒）、
// 非法区域加载拒绝、normalizeRegions 与 stripOrphanSources 的单一语义分工。
import { describe, expect, test } from 'bun:test'

import { FormDoc } from '../../src/designer/form-doc'
import {
  FORM_BINDING_META_NAMESPACE,
  normalizeRegions,
  stripOrphanSources,
  type FormRegion,
  type FormTemplate,
} from '../../src/designer/template'
import { ADDR, RANGE } from './testing/fixtures'

describe('序列化', () => {
  test('round-trip：保存 → 加载 → 再保存等价（含区域数据源）', () => {
    const doc = FormDoc.create(8)
    doc.sheet.setCellValue(ADDR(0, 0), '出库单')
    doc.sheet.setCellStyle(RANGE(0, 0, 0, 5), {
      font: { bold: true, size: 16 },
      align: { horizontal: 'center' },
    })
    doc.sheet.mergeCells(RANGE(0, 0, 0, 5))
    doc.setRowHeight(0, 40)
    doc.setColWidth(0, 120)
    doc.setCellBinding(ADDR(2, 1), { datasetId: 'ds1', path: 'orders[0].no' })
    doc.setRegionSource(0, { datasetId: 'ds1', expression: 'rows[0]', path: '[0].items' })
    doc.setRegionExpand(0, 'down')

    const first = doc.toTemplate('测试模板')
    const restored = FormDoc.fromTemplate(first)
    const second = restored.toTemplate('测试模板')
    expect(JSON.parse(JSON.stringify(second))).toEqual(JSON.parse(JSON.stringify(first)))

    // 关键内容逐项断言（等价性的人类可读版）
    expect(first.schemaVersion).toBe(3)
    expect(first.regions[0]!.source).toEqual({
      datasetId: 'ds1',
      expression: 'rows[0]',
      path: '[0].items',
    })
    expect(restored.sheet.getDisplayValue(ADDR(0, 0))).toBe('出库单')
    expect(restored.sheet.getCellInfo(ADDR(0, 3)).kind).toBe('merged-covered')
    expect(restored.sheet.getRowHeight(0)).toBe(40)
    expect(restored.sheet.getColWidth(0)).toBe(120)
    expect(restored.getCellBinding(ADDR(2, 1))).toEqual({
      datasetId: 'ds1',
      path: 'orders[0].no',
    })
    expect(restored.regions[0]!.expand).toBe('down')
  })

  test('模板 JSON 键集：无声明 cols、无打印弹框配置', () => {
    const doc = FormDoc.create(8)
    const json = doc.toTemplate('t')
    expect(Object.keys(json).sort()).toEqual(['name', 'regions', 'schemaVersion', 'sheet'])
    for (const forbidden of ['paper', 'margin', 'scale', 'pagination', 'pageSize', 'orientation']) {
      expect(JSON.stringify(json)).not.toContain(`"${forbidden}"`)
    }
  })

  test('非法区域（重叠/展开无数据源）在加载时被拒绝', () => {
    const template = FormDoc.create(8).toTemplate('t')
    const overlapping: FormTemplate = {
      ...template,
      regions: [
        { startRow: 0, endRow: 2, startCol: 0, endCol: 3, expand: 'none' },
        { startRow: 2, endRow: 2, startCol: 2, endCol: 5, expand: 'none' }, // 与上一块重叠
      ],
    }
    expect(() => FormDoc.fromTemplate(overlapping)).toThrow('重叠')

    const noSource: FormTemplate = {
      ...template,
      regions: [{ startRow: 0, endRow: 2, startCol: 0, endCol: 7, expand: 'down' }],
    }
    expect(() => FormDoc.fromTemplate(noSource)).toThrow('数据源')
  })

  test('schemaVersion 不符的载荷在加载时直接拒绝', () => {
    const current = FormDoc.create(8).toTemplate('t')
    // 载荷来自网络/手改 JSON，类型上不可静态保证：按 unknown 构造非法输入，断言一次即可
    const wrongVersion: unknown = { ...current, schemaVersion: 2 }
    expect(() => FormDoc.fromTemplate(wrongVersion as FormTemplate)).toThrow('schemaVersion')
  })
})

describe('normalizeRegions：校验 + 恒保留数据源', () => {
  test('允许空数组，且校验展开方式必须有数据源', () => {
    expect(normalizeRegions([])).toEqual([])
    expect(() =>
      normalizeRegions([{ startRow: 0, endRow: 0, startCol: 0, endCol: 0, expand: 'down' }]),
    ).toThrow('数据源')
  })

  test('数据源完整性：datasetId 不能为空', () => {
    expect(() =>
      normalizeRegions([
        {
          startRow: 0,
          endRow: 0,
          startCol: 0,
          endCol: 0,
          expand: 'down',
          source: { datasetId: '  ', path: '' },
        },
      ]),
    ).toThrow('数据集不能为空')
  })

  test('不展开区域上的数据源原样保留（编辑期过渡态）', () => {
    const regions: FormRegion[] = [
      {
        startRow: 0,
        endRow: 0,
        startCol: 0,
        endCol: 0,
        expand: 'none',
        source: { datasetId: ' ds1 ', path: '' },
      },
    ]
    expect(normalizeRegions(regions)[0]!.source).toEqual({ datasetId: 'ds1', path: '' })
  })
})

describe('stripOrphanSources：序列化/加载边界清理', () => {
  test('清掉不展开区域上的 source，展开区域原样保留', () => {
    const regions: FormRegion[] = [
      {
        startRow: 0,
        endRow: 0,
        startCol: 0,
        endCol: 0,
        expand: 'none',
        source: { datasetId: 'ds1', path: '' },
      },
      {
        startRow: 1,
        endRow: 1,
        startCol: 0,
        endCol: 0,
        expand: 'down',
        source: { datasetId: 'ds1', path: 'items' },
      },
    ]
    const stripped = stripOrphanSources(regions)
    expect(stripped[0]!.source).toBeUndefined()
    expect(stripped[1]!.source).toEqual({ datasetId: 'ds1', path: 'items' })
    // 不改入参
    expect(regions[0]!.source).toEqual({ datasetId: 'ds1', path: '' })
  })

  test('落模板时过渡态数据源被清掉，读回后也不带', () => {
    const doc = FormDoc.create(8)
    doc.setRegionSource(0, { datasetId: 'ds1', path: 'items' })
    expect(doc.regions[0]!.source).toBeDefined()
    const template = doc.toTemplate('t')
    expect(template.regions[0]!.source).toBeUndefined()
    expect(FormDoc.fromTemplate(template).regions[0]!.source).toBeUndefined()
  })
})

describe('绑定 sidecar 形状', () => {
  test('相对绑定只有 path：sidecar 原样落盘', () => {
    const template = FormDoc.create(8).toTemplate('t')
    const sheet = {
      ...template.sheet,
      meta: [{ row: 0, col: 0, namespace: FORM_BINDING_META_NAMESPACE, payload: { path: 'name' } }],
    }
    const restored = FormDoc.fromTemplate({ ...template, sheet })
    expect(restored.getCellBinding(ADDR(0, 0))).toEqual({ path: 'name' })
  })
})
