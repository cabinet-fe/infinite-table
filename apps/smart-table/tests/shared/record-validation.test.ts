// 前后端单源记录校验测试：required 必填、number/progress/date/checkbox/link 类型校验与批量行级错误收集。
import { describe, expect, it } from 'vitest'
import {
  isRecordValueEmpty,
  validateAndCoerceCellValue,
  validateBatchRecords,
  validateRecordForCreate,
  validateRecordPatch,
} from '../../src/shared/record-validation'
import type { SmartColumn } from '../../src/shared/schema'

const COLUMNS: SmartColumn[] = [
  { key: 'code', title: '项目编号', type: 'text', width: 120, required: true },
  { key: 'amount', title: '合同金额', type: 'number', width: 120, required: true },
  { key: 'progress', title: '进度', type: 'progress', width: 100 },
  { key: 'due_date', title: '交付日期', type: 'date', width: 120, required: true },
  { key: 'verified', title: '已核验', type: 'checkbox', width: 80 },
  { key: 'doc', title: '文档链接', type: 'link', width: 120 },
  {
    key: 'lookup_dept',
    title: '部门',
    type: 'lookup',
    width: 100,
    required: true, // 派生列不参与录入校验
  },
]

describe('record-validation', () => {
  it('isRecordValueEmpty 正确识别空串、null、undefined 与空链接对象，false 视为非空', () => {
    expect(isRecordValueEmpty(null)).toBe(true)
    expect(isRecordValueEmpty(undefined)).toBe(true)
    expect(isRecordValueEmpty('   ')).toBe(true)
    expect(isRecordValueEmpty({ url: '  ', text: '' }, { type: 'link' })).toBe(true)
    expect(isRecordValueEmpty(false, { type: 'checkbox' })).toBe(false)
    expect(isRecordValueEmpty(0, { type: 'number' })).toBe(false)
    expect(isRecordValueEmpty({ url: 'https://a.com', text: '' }, { type: 'link' })).toBe(false)
  })

  it('validateAndCoerceCellValue 校验必填与 number/progress/date/checkbox 类型及归一化', () => {
    // required 空值报错
    expect(validateAndCoerceCellValue(COLUMNS[0]!, '  ')).toEqual({
      valid: false,
      message: '项目编号为必填项',
    })
    expect(validateAndCoerceCellValue(COLUMNS[1]!, null)).toEqual({
      valid: false,
      message: '合同金额为必填项',
    })

    // number / progress 归一化与非法数值拒绝
    expect(validateAndCoerceCellValue(COLUMNS[1]!, ' 12500.5 ')).toEqual({
      valid: true,
      value: 12500.5,
    })
    expect(validateAndCoerceCellValue(COLUMNS[1]!, 'abc')).toEqual({
      valid: false,
      message: '请输入有效数值',
    })
    expect(validateAndCoerceCellValue(COLUMNS[2]!, '150')).toEqual({
      valid: true,
      value: 100,
    })
    expect(validateAndCoerceCellValue(COLUMNS[2]!, '-5')).toEqual({
      valid: true,
      value: 0,
    })
    expect(validateAndCoerceCellValue(COLUMNS[2]!, '')).toEqual({
      valid: true,
      value: null,
    })

    // date 严格校验日历有效性与格式归一化
    expect(validateAndCoerceCellValue(COLUMNS[3]!, '2025/3/5')).toEqual({
      valid: true,
      value: '2025-03-05',
    })
    expect(validateAndCoerceCellValue(COLUMNS[3]!, '2025-02-30').valid).toBe(false)
    expect(validateAndCoerceCellValue(COLUMNS[3]!, 'invalid').valid).toBe(false)

    // checkbox 布尔解析与非法值拒绝
    expect(validateAndCoerceCellValue(COLUMNS[4]!, 'true')).toEqual({ valid: true, value: true })
    expect(validateAndCoerceCellValue(COLUMNS[4]!, '否')).toEqual({ valid: true, value: false })
    expect(validateAndCoerceCellValue(COLUMNS[4]!, 'maybe').valid).toBe(false)

    // 派生列跳过校验
    expect(validateAndCoerceCellValue(COLUMNS[6]!, null)).toEqual({ valid: true, value: null })
  })

  it('validateRecordForCreate 检查全量必填并剔除派生列；validateRecordPatch 仅校验传入字段', () => {
    const createErr = validateRecordForCreate(COLUMNS, {
      code: 'PRJ-1',
      lookup_dept: '应该被剔除',
    })
    expect(createErr.valid).toBe(false)
    expect(createErr.errors.map((e) => e.field)).toEqual(['amount', 'due_date'])

    const createOk = validateRecordForCreate(COLUMNS, {
      code: 'PRJ-1',
      amount: '8800',
      due_date: '2026/5/1',
      verified: '1',
      lookup_dept: '研发部',
    })
    expect(createOk.valid).toBe(true)
    expect(createOk.record).toEqual({
      code: 'PRJ-1',
      amount: 8800,
      due_date: '2026-05-01',
      verified: true,
    })

    // patch 只改 progress 不触发 code/amount/due_date 的缺省报错；但如果显式把 required 列置空则报错
    const patchOk = validateRecordPatch(COLUMNS, { progress: '80' })
    expect(patchOk.valid).toBe(true)
    expect(patchOk.record).toEqual({ progress: 80 })

    const patchClearRequired = validateRecordPatch(COLUMNS, { code: '  ' })
    expect(patchClearRequired.valid).toBe(false)
    expect(patchClearRequired.errors[0]).toMatchObject({ field: 'code', columnTitle: '项目编号' })
  })

  it('validateBatchRecords 全量收集跨行跨列错误并输出归一化记录', () => {
    const res = validateBatchRecords(COLUMNS, [
      { code: 'P-1', amount: '1000', due_date: '2026-01-15', progress: '50' },
      { code: '', amount: 'not_num', due_date: '2026-02-30' },
      { code: 'P-3', amount: 2000 },
    ])

    expect(res.valid).toBe(false)
    expect(res.errors).toEqual([
      { rowIndex: 1, field: 'code', columnTitle: '项目编号', message: '项目编号为必填项' },
      { rowIndex: 1, field: 'amount', columnTitle: '合同金额', message: '请输入有效数值' },
      {
        rowIndex: 1,
        field: 'due_date',
        columnTitle: '交付日期',
        message: '请输入有效日期（格式 YYYY-MM-DD）',
      },
      { rowIndex: 2, field: 'due_date', columnTitle: '交付日期', message: '交付日期为必填项' },
    ])

    const validRes = validateBatchRecords(COLUMNS, [
      { code: 'P-1', amount: '1000', due_date: '2026/1/15' },
      { code: 'P-2', amount: 2500, due_date: '2026-02-01', verified: '是' },
    ])
    expect(validRes.valid).toBe(true)
    expect(validRes.errors).toEqual([])
    expect(validRes.records).toEqual([
      { code: 'P-1', amount: 1000, due_date: '2026-01-15' },
      { code: 'P-2', amount: 2500, due_date: '2026-02-01', verified: true },
    ])
  })
})
