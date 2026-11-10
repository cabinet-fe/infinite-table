// 聚合执行器（v5 起函数体；v6 增类型体系）：把一个或多个数据集的原始行经 JS 函数体
// 加工成任意结构，结果挂到 `agg.{name}`。设计定位：替代 ureport 式 DSL——数据集先在
// 这里被加工成方便取的结构，单元格函数与数据块数据源再按 `agg.name['xxx']` 直接消费。
//
// 求值顺序 = 声明序：后序聚合的入参 `agg` 里已经有前序结果（可链式加工）。
// 编译/求值走 transform/expr.ts 的函数体管线（严格模式、必须 return；入参按
// 只读约定共享）。聚合类型（array/value）的推导与提交校验共用 probeAggregationType
// 的空数据试跑——契约层（shared/template-schema.ts）的 normalize/迁移路径经
// AggregationTypeProber 注入本实现，不反向 import 本模块。
import type { SourceRow } from '../transform/reshape'
import { ExprError, evaluateFunctionBody } from '../transform/expr'
import { describeError } from '../errors'
import type { AggregationTypeProbe, FormAggregation } from '../shared/template-schema'

/** 聚合结果对象：`agg.{name}` 的运行时形态 */
export type AggregationResults = Record<string, unknown>

/**
 * 跑一遍全部聚合：数据集原始行 → 各聚合函数体 → `agg` 对象。
 * 未取到行的数据集按空数组入参（不静默跳过——函数体的形状契约保持稳定）。
 * 任一聚合失败抛 ExprError（message 带「聚合「名」」前缀），由调用方呈现。
 */
export function runAggregations(
  aggregations: readonly FormAggregation[],
  rowsByDataset: ReadonlyMap<string, SourceRow[]>,
): AggregationResults {
  const agg: AggregationResults = {}
  for (const definition of aggregations) {
    const argNames = [...definition.params.map((param) => param.varName), 'agg']
    const args: unknown[] = [
      ...definition.params.map((param) => rowsByDataset.get(param.datasetId) ?? []),
      agg,
    ]
    agg[definition.name] = evaluateFunctionBody(
      `聚合「${definition.name}」`,
      argNames,
      args,
      definition.expression,
    )
  }
  return agg
}

/**
 * 空数据试跑（类型推导与提交校验共用）：每个入参数据集传 `[]`、`agg` 传 `{}`，
 * 执行函数体一次——不抛错且返回形态与声明类型一致，即空数据集下打印也不会炸。
 * 链式引用（`agg.台账['x']`）在空 agg 下抛错属预期：报错引导防御式写法
 * （`(agg.台账 ?? {})['x'] ?? 0`）。纯同步、无副作用。
 */
export function probeAggregationType(
  params: readonly { varName: string }[],
  body: string,
): AggregationTypeProbe {
  const argNames = [...params.map((param) => param.varName), 'agg']
  const args: unknown[] = [...params.map(() => []), {}]
  try {
    const value = evaluateFunctionBody('空数据试跑', argNames, args, body)
    return { ok: true, returns: Array.isArray(value) ? 'array' : 'value' }
  } catch (cause) {
    if (cause instanceof ExprError) {
      // 去掉 what 前缀只留「编译/求值失败：原因」；引用了前序聚合的运行期错误附防御式引导
      const reason = cause.message.replace(/^空数据试跑/, '')
      return {
        ok: false,
        error:
          cause.phase === 'runtime' && /\bagg\s*[.[]/.test(body)
            ? `${reason}（引用前序聚合请写防御式，如 (agg.台账 ?? {})['x'] ?? 0）`
            : reason,
      }
    }
    return { ok: false, error: describeError(cause) }
  }
}
