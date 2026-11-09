// 数据集重塑转换器：数据集原始行经用户 JS 表达式重塑为任意嵌套形态的唯一前端管线。
// 预览（数据态渲染）与打印（PrintSource 适配）都只经 reshapeRows 取重塑数据，
// 不给第二套重塑路径留口。纯前端模块，不依赖后端。
//
// 受限求值的编译/求值实现在 expr.ts（v4 起与聚合、单元格函数共用同一管线）；
// 本文件只保留重塑专属的错误类型与入口。求值环境按只读约定共享：入参按引用
// 传入，不做防御性拷贝——用户表达式承诺不做原地改写。
import { evaluateExpr } from './expr'

/** 数据集原始行：SQL 结果的一行（列名 → 值） */
export type SourceRow = Record<string, unknown>

/**
 * 数据集重塑定义：expression 为 JS 表达式，以 `rows` 为唯一入参，
 * 求值结果即重塑后的数据形态（任意嵌套对象/数组）。
 */
export interface TransformDefinition {
  expression: string
}

/** 转换器错误：compile 为表达式编译失败，runtime 为求值期抛错；供绑定编辑与预览 UI 呈现 */
export class TransformError extends Error {
  readonly phase: 'compile' | 'runtime'

  constructor(phase: 'compile' | 'runtime', message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TransformError'
    this.phase = phase
  }
}

/**
 * 唯一重塑管线入口：数据集原始行 + 用户 JS 表达式定义 → 任意嵌套形态
 * （含嵌套二级数组的构造与取数）。预览与打印共用本入口，重复调用同输入同输出。
 */
export function reshapeRows(definition: TransformDefinition, rows: SourceRow[]): unknown {
  if (!definition.expression.trim()) {
    throw new TransformError('compile', '重塑表达式为空')
  }
  try {
    return evaluateExpr('重塑表达式', ['rows'], [rows], definition.expression)
  } catch (error) {
    const phase = (error as { phase?: 'compile' | 'runtime' }).phase ?? 'runtime'
    throw new TransformError(phase, (error as Error).message, { cause: error })
  }
}
