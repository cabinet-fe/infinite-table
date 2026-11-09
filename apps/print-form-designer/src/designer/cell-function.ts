// 单元格函数（「作用方式」的 v4 替代）：任何单元格都可设置，求值发生在数据态渲染
// （预览/打印）时。载荷是判别联合（template.ts 的 FormCellFunction）：结构化聚合
// （主路径，编辑器下拉选函数选参数）在求值侧经 cellFunctionExpression 合成下方等价
// 表达式；自定义 JS 表达式原样进求值。表达式可用：
// - `agg`：模板聚合结果对象（`agg.summary['总计']`）；
// - `item`：当前条目（展开区明细行内，`item.qty * item.price`）；
// - 数据块函数：`SUM/AVG/COUNT/MIN/MAX('数据块名'[, '字段'])`、
//   `SUBTOTAL('数据块名'[, '字段'])`（小计行按当前组、合计行取全体）、
//   `GROUP(['字段'])`（当前组的展示值，缺省取首个分组字段）。
//
// 编译/求值走 transform/expr.ts 的唯一受限管线（严格模式、错误分类 compile/runtime）。
// 数据块名省略字段参数 = 取**函数格所在列**在该数据块绑定的字段（Excel 同列直觉）。
//
// 参数选择交互是 Excel 式「画布点选参数格」：选函数后在画布上点一个字段绑定格，
// 数据块引用名与字段路径由 deriveParamCell 从被点格子自动推导——展开几条就对该字段
// 的几个解析值做聚合，正是下方 SUM('明细', 'amount') 的既有求值语义，求值层不动。
import { formatAddress, type CellAddress, type CellValue } from '@infinitable/sheet'

import { evaluateExpr } from '../transform/expr'
import { resolveItemValue } from './binding'
import {
  regionRefOf,
  regionsAt,
  type CellFnName,
  type FormCellBinding,
  type FormCellFunction,
  type FormRegion,
} from './template'

/** 函数求值环境（由 data-state 按展开槽位构造） */
export interface CellFunctionEnv {
  /** 聚合结果（`agg.{name}`） */
  agg: Record<string, unknown>
  /** 当前条目（展开区明细行；小计/组头行为组内第 1 条） */
  item?: unknown
  /** SUBTOTAL 的聚合范围：小计行 = 本组条目，合计行 = 数据块全体 */
  subtotalItems?: unknown[]
  /** 当前组第 1 条（GROUP 取组值用） */
  groupFirst?: unknown
  /** 数据块首个分组字段（GROUP() 缺省字段） */
  groupField?: string
  /** 数据块名 → 该数据块循环条目（全量） */
  itemsOf: (ref: string) => unknown[]
  /** 数据块名 → 函数格所在列在该数据块绑定的字段路径（同列省略参数语义） */
  columnFieldOf: (ref: string) => string
}

/** 内置函数的实参形态（数据块名 + 可选字段路径） */
interface RegionFnArgs {
  ref: string
  field?: string
}

/** 解析数据块函数入参：首参必须是数据块名字符串 */
function regionFnArgs(name: string, args: unknown[]): RegionFnArgs {
  const [ref, field] = args
  if (typeof ref !== 'string' || ref.trim() === '') {
    throw new Error(`${name} 的第一个参数必须是数据块名，如 ${name}('明细')`)
  }
  if (field !== undefined && typeof field !== 'string') {
    throw new Error(`${name}('数据块名', 字段) 的字段参数必须是字符串`)
  }
  return { ref: ref, field }
}

/** 条目数组按字段取值后的数值集（跳过 null/undefined/非数值——与旧聚合口径一致） */
function numericValues(items: readonly unknown[], field: string): number[] {
  return items
    .map((item) => resolveItemValue(item, field))
    .filter((value): value is number => typeof value === 'number')
}

/** 字段在条目数组上有值的个数（COUNT 带 field 时的口径） */
function presentCount(items: readonly unknown[], field: string): number {
  return items.filter((item) => resolveItemValue(item, field) !== undefined).length
}

/** 全量聚合实现在 items 上（SUM/AVG/COUNT/MIN/MAX 与 SUBTOTAL 共用） */
function aggregateNumbers(
  name: string,
  items: readonly unknown[],
  field: string,
): CellValue | undefined {
  const numbers = numericValues(items, field)
  switch (name) {
    case 'SUM':
      return numbers.reduce((total, value) => total + value, 0)
    case 'AVG':
      return numbers.length === 0 ? undefined : numbers.reduce((t, v) => t + v, 0) / numbers.length
    case 'COUNT':
      return numbers.length
    case 'MIN':
      return numbers.length === 0 ? undefined : Math.min(...numbers)
    case 'MAX':
      return numbers.length === 0 ? undefined : Math.max(...numbers)
    default:
      return undefined
  }
}

/** 求值结果收敛为格值：非原始类型不进格（与绑定取值同一口径） */
function toCellValue(value: unknown): CellValue | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined
}

/**
 * 求值一次单元格函数。数据态渲染逐格调用：环境（item/组上下文/数据块取数器）由
 * 调用方按展开槽位构造，本函数只负责表达式与内置函数。
 * 编译/求值失败抛 ExprError（phase 区分），由预览/打印层呈现。
 */
export function evaluateCellFunction(
  expression: string,
  env: CellFunctionEnv,
): CellValue | undefined {
  // 省略字段 = 函数格所在列在该数据块绑定的字段（columnFieldOf 取不到时抛错带指引）
  const resolveField = (args: RegionFnArgs): string => args.field ?? env.columnFieldOf(args.ref)

  const builtins: Record<string, (...args: unknown[]) => unknown> = {
    SUM: (...args) => {
      const parsed = regionFnArgs('SUM', args)
      return aggregateNumbers('SUM', env.itemsOf(parsed.ref), resolveField(parsed))
    },
    AVG: (...args) => {
      const parsed = regionFnArgs('AVG', args)
      return aggregateNumbers('AVG', env.itemsOf(parsed.ref), resolveField(parsed))
    },
    COUNT: (...args) => {
      const parsed = regionFnArgs('COUNT', args)
      if (parsed.field) return presentCount(env.itemsOf(parsed.ref), parsed.field)
      if (parsed.field === undefined && args.length === 1) return env.itemsOf(parsed.ref).length
      return presentCount(env.itemsOf(parsed.ref), resolveField(parsed))
    },
    MIN: (...args) => {
      const parsed = regionFnArgs('MIN', args)
      return aggregateNumbers('MIN', env.itemsOf(parsed.ref), resolveField(parsed))
    },
    MAX: (...args) => {
      const parsed = regionFnArgs('MAX', args)
      return aggregateNumbers('MAX', env.itemsOf(parsed.ref), resolveField(parsed))
    },
    SUBTOTAL: (...args) => {
      const parsed = regionFnArgs('SUBTOTAL', args)
      // 小计行 = 当前组条目；合计行 = 数据块全体；数据块外静态格 = 与 SUM 等价（全量）
      const items = env.subtotalItems ?? env.itemsOf(parsed.ref)
      return aggregateNumbers('SUM', items, resolveField(parsed))
    },
    GROUP: (...args) => {
      const [field] = args
      if (field !== undefined && typeof field !== 'string') {
        throw new Error("GROUP 的字段参数必须是字符串，如 GROUP('客户')")
      }
      if (env.groupFirst === undefined) {
        throw new Error('GROUP() 只能在分组数据块的组头/小计行上使用')
      }
      return resolveItemValue(env.groupFirst, field ?? env.groupField ?? '')
    },
  }

  const names = Object.keys(builtins)
  // agg/item 直接传引用：求值环境按只读约定共享（用户表达式承诺不改写入参）；
  // 也不能克隆——内置函数是闭包，本就不可结构化克隆
  const result = evaluateExpr(
    '单元格函数',
    ['agg', 'item', ...names],
    [env.agg, env.item, ...names.map((name) => builtins[name]!)],
    expression,
  )
  return toCellValue(result)
}

/** 点选参数格的推导输入：数据块序列 + 绑定/函数 sidecar 读取器（纯数据，不依赖 FormDoc） */
export interface ParamCellSource {
  regions: readonly FormRegion[]
  bindingOf: (addr: CellAddress) => FormCellBinding | undefined
  functionOf: (addr: CellAddress) => FormCellFunction | undefined
}

/** 推导结果：成功给出函数载荷参数（数据块引用名 + 字段路径）；失败给可直接展示的中文原因 */
export type ParamCellDerivation =
  | { ok: true; region: string; field: string }
  | { ok: false; reason: string }

/**
 * 从被点格子推导单元格函数的参数（数据块 + 字段）——Excel 式点选参数格的核心规则：
 * 被点格必须落在**带数据源的数据块**内，且是**字段绑定格**（画布上显示 {{字段名}}）；
 * 函数格/空格/数据块外/没绑源的数据块都失败并给出中文原因（提示条原样展示，保持点选）。
 * 成功结果直接拼进 `{ kind: 'fn', fn, region, field }`（GROUP 只取 field）。
 */
export function deriveParamCell(source: ParamCellSource, addr: CellAddress): ParamCellDerivation {
  const where = formatAddress(addr)
  const fieldHint = '请点数据块里绑了字段的格子（画布上显示 {{字段名}} 的那种）'
  const region = regionsAt(source.regions, addr.row, addr.col)
  if (!region) {
    return { ok: false, reason: `「${where}」不在任何数据块里：${fieldHint}` }
  }
  if (!region.source) {
    return {
      ok: false,
      reason: `「${where}」所在的数据块还没有数据源：先在「数据块」tab 配置数据源，再点一个绑了字段的格子`,
    }
  }
  if (source.functionOf(addr)) {
    return { ok: false, reason: `「${where}」是函数格，不能当参数：${fieldHint}` }
  }
  const binding = source.bindingOf(addr)
  if (!binding) {
    return { ok: false, reason: `「${where}」没有绑定字段：${fieldHint}` }
  }
  if (binding.path.trim() === '') {
    // 空路径 = 条目本身，函数的字段参数必须是具体路径（normalize 会把空串当省略）
    return { ok: false, reason: `「${where}」绑的是条目本身（空路径）：请点绑了具体字段的格子` }
  }
  return {
    ok: true,
    region: regionRefOf(region, source.regions.indexOf(region)),
    field: binding.path,
  }
}

/** 函数名的中文展示名（目录一份口径；点选提示条与面板共用） */
export function cellFnLabel(name: CellFnName): string {
  return CELL_FUNCTION_CATALOG.find((item) => item.name === name)?.label ?? name
}

/** 目录条目形态：region = 数据块函数（模板恰好一个数据块时可预填数据块名）、
 *  fn = 普通函数、ref = 变量引用（只进帮助浮层，不做插入 pill） */
export type CellFunctionDocKind = 'region' | 'fn' | 'ref'

/** 目录条目的展示元数据（pills 与帮助浮层共用一份口径，与求值逻辑无关） */
export interface CellFunctionDoc {
  kind: CellFunctionDocKind
  /** 函数名 / 引用名（插入口） */
  name: string
  /** 完整签名（帮助浮层展示） */
  signature: string
  /** 中文名（pill 文案） */
  label: string
  /** 一句话说明（悬浮即文档；含省略字段参数时的口径） */
  title: string
  /** 示例（帮助浮层展示） */
  example: string
}

/** 内置函数 / 引用的说明清单（函数编辑器 pills 与帮助浮层共用一份口径） */
export const CELL_FUNCTION_CATALOG: CellFunctionDoc[] = [
  {
    kind: 'region',
    name: 'SUM',
    signature: "SUM('数据块'[, '字段'])",
    label: '求和',
    title: '对数据块某字段求和；选函数后到画布上点参数格，数据块与字段自动带出',
    example: "SUM('明细', 'amount')",
  },
  {
    kind: 'region',
    name: 'AVG',
    signature: "AVG('数据块'[, '字段'])",
    label: '平均',
    title: '对数据块某字段求平均（只统计数值）；选函数后到画布上点参数格',
    example: "AVG('明细', 'price')",
  },
  {
    kind: 'region',
    name: 'COUNT',
    signature: "COUNT('数据块'[, '字段'])",
    label: '计数',
    title: '统计数据块条数；选函数后到画布上点参数格（带字段时统计该字段有值的条数）',
    example: "COUNT('明细')",
  },
  {
    kind: 'region',
    name: 'MIN',
    signature: "MIN('数据块'[, '字段'])",
    label: '最小值',
    title: '取数据块某字段的最小值（只统计数值）；选函数后到画布上点参数格',
    example: "MIN('明细', 'price')",
  },
  {
    kind: 'region',
    name: 'MAX',
    signature: "MAX('数据块'[, '字段'])",
    label: '最大值',
    title: '取数据块某字段的最大值（只统计数值）；选函数后到画布上点参数格',
    example: "MAX('明细', 'price')",
  },
  {
    kind: 'region',
    name: 'SUBTOTAL',
    signature: "SUBTOTAL('数据块'[, '字段'])",
    label: '小计',
    title: '小计行按当前组求和、合计行取数据块全体；选函数后到画布上点参数格',
    example: "SUBTOTAL('明细', 'qty')",
  },
  {
    kind: 'fn',
    name: 'GROUP',
    signature: "GROUP(['字段'])",
    label: '分组值',
    title: '取当前组的展示值（组头/小计行用）；选函数后到画布上点参数格带出字段',
    example: "GROUP('customer')",
  },
  {
    kind: 'ref',
    name: 'item',
    signature: 'item.字段',
    label: '当前条目',
    title: '列表明细行内取当前条目的字段（可写计算列，如 数量 × 单价）',
    example: 'item.qty * item.price',
  },
  {
    kind: 'ref',
    name: 'agg',
    signature: "agg.变量名['键']",
    label: '聚合结果',
    title: '取「聚合」tab 配置的结果变量（试运行后可复制引用）',
    example: "agg.summary['总计']",
  },
]
