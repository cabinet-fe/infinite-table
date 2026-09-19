// 公式函数元数据（工具栏「函数」面板与公式栏补全共用；能力面与 mini 求值器一致）。

export interface SheetFunctionMeta {
  name: string
  signature: string
  description: string
  /** 是否进入「常用」分类 */
  common: boolean
}

export const SHEET_FUNCTIONS: readonly SheetFunctionMeta[] = [
  {
    name: 'SUM',
    signature: 'SUM(number1, number2, …)',
    description: '计算所有参数的总和',
    common: true,
  },
  {
    name: 'AVERAGE',
    signature: 'AVERAGE(number1, number2, …)',
    description: '返回参数的算术平均值',
    common: true,
  },
  {
    name: 'COUNT',
    signature: 'COUNT(value1, value2, …)',
    description: '计算参数中数值的个数',
    common: true,
  },
  {
    name: 'MIN',
    signature: 'MIN(number1, number2, …)',
    description: '返回一组数值中的最小值',
    common: true,
  },
  {
    name: 'MAX',
    signature: 'MAX(number1, number2, …)',
    description: '返回一组数值中的最大值',
    common: true,
  },
]

export const FUNCTION_CATEGORIES = ['常用', '全部'] as const
