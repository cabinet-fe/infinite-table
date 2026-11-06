// 数据集重塑转换器（P7）：数据集原始行经用户 JS 表达式重塑为任意嵌套形态的唯一前端管线。
// 预览（P6 数据态渲染）与打印（P8 PrintSource 适配）都只经 reshapeRows 取重塑数据，
// 不给第二套重塑路径留口。纯前端模块，不依赖后端。
//
// 受限求值口径（按任务书）：new Function 包裹 + 明确入参白名单——表达式体内唯一入参是
// `rows`（数据集原始行数组），严格模式求值（this 为 undefined、未声明赋值直接抛错）。
// 这是同源用户自写表达式的受限求值，不是硬安全沙箱，不引入更重的隔离机制。
// 纯函数口径：每次求值对入参做深拷贝，表达式对 rows 的原地改动不影响调用方数据与重复求值。
import { describeError } from '../errors'

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

/** 编译表达式：函数体只在调用时执行，构造期即暴露语法错误 */
function compileExpression(expression: string): (rows: SourceRow[]) => unknown {
  // 受限求值口径即任务书点名的 new Function 包裹（见文件头注），非隐式 eval 误用
  // oxlint-disable-next-line typescript/no-implied-eval
  return new Function('rows', `"use strict";\nreturn (\n${expression}\n);`) as (
    rows: SourceRow[],
  ) => unknown
}

/**
 * 唯一重塑管线入口：数据集原始行 + 用户 JS 表达式定义 → 任意嵌套形态
 * （含嵌套二级数组的构造与取数）。预览与打印共用本入口，重复调用同输入同输出。
 */
export function reshapeRows(definition: TransformDefinition, rows: SourceRow[]): unknown {
  if (!definition.expression.trim()) {
    throw new TransformError('compile', '重塑表达式为空')
  }
  let evaluate: (rows: SourceRow[]) => unknown
  try {
    evaluate = compileExpression(definition.expression)
  } catch (error) {
    throw new TransformError('compile', `重塑表达式编译失败：${describeError(error)}`, {
      cause: error,
    })
  }
  try {
    return evaluate(structuredClone(rows))
  } catch (error) {
    throw new TransformError('runtime', `重塑表达式求值失败：${describeError(error)}`, {
      cause: error,
    })
  }
}
