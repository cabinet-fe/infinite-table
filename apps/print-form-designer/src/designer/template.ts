import type { SheetSnapshot } from '@infinitable/sheet'

import { probeAggregationType } from './aggregation'

/**
 * 打印单模板 JSON schema v6（数据块为唯一取数边界 + 单元格函数 + 分组 + 聚合函数体
 * 与类型体系）。
 *
 * 模板 = 数据块序列 + 聚合序列 + 画布内容快照。数据块是画布上的一个矩形 + 展开属性 +
 * 可选数据源/分组配置；**相对字段绑定只存在于绑了数据源的数据块之内**，任意单元格都
 * 可以直接引用非数组聚合（FormCellBinding 的 `agg` 形态，单据头字段不用套数据块），
 * 或设置「函数」（结构化聚合为主路径，自定义 JS 表达式为逃生舱，见 FormCellFunction）。
 *
 * 关键口径：
 * - 数据块**不需要连续覆盖画布**，也不要求存在数据块：不属于任何数据块的行列是普通静态内容。
 * - 数据块之间**不得重叠**（`normalizeRegions` 校验），且数据块引用名（`regionRefOf`）唯一。
 * - 展开属性（UI 称「列表方式」）：`down` 按份数向下复制、`right` 向右平铺；同一模板内各最多一个。
 * - **任何数据块都可以持有 `source`**（非列表的数据块带源 = 静态取第 1 条，表头区绑字段靠它）；
 *   `expand !== 'none'` 但未绑 `source` 是合法中间态：设计器随便设，渲染/打印暂按 1 份。
 * - 数据源两种：`dataset`（数据集 × 重塑表达式 × 循环路径）或 `agg`（取**数组型**聚合
 *   的返回列表做循环；非数组型聚合不能作数据块数据源，见 AggregationType）。
 * - 分组是**数据块级**配置：`groupBy`（条目内路径）+ 行角色（明细/组头/小计/合计）。
 *   分组只对 `expand: 'down'` 有意义；`summary` 行对任意纵向列表的数据块有效（明细 ×N 份
 *   后垫 1 份合计行）。
 * - 画布**没有声明尺寸**：行列数由内容包围盒推导（见 content-bounds.ts），模板不存 cols。
 *
 * 格内容/样式/合并/行高列宽/绑定与函数 sidecar 全部由 SheetSnapshot 承载——不自造
 * 第二套样式模型。纸张/边距/缩放/分页等打印配置不进模板（只在打印弹框）。
 */

/**
 * 模板 schema 版本（v6：聚合增 `type` 类型体系 + 空数据试跑校验）。
 * v4/v5 存量模板在库启动时经 migrateTemplateToCurrent 自动迁移；比 v4 更老的版本
 * 没有可用迁移路径，按 db.ts 的既有清理策略丢弃。
 */
export const TEMPLATE_SCHEMA_VERSION = 6

/**
 * v4/v5 → v6 迁移，分两段、可从任一支持版本直升：
 * - v4 → v5：聚合 expression 从单表达式改为函数体——每个表达式包一层 `return (…);`；
 * - v5 → v6：聚合补 `type`——缺省用**空数据试跑**推导（每个入参数据集传 `[]`、`agg` 传
 *   `{}` 执行函数体：返回数组 → `array`，否则 → `value`）；试跑抛错（如链式引用
 *   `agg.前序['x']` 在空 agg 下必炸）回退：被某数据块 `kind: 'agg'` 源引用 → `array`
 *   （数据块数据源不断链），否则 `value`。
 * v6 起数据块不再有 `repeat`（重复打印）字段——v4/v5 存量行携带的 repeat 在迁移时剥掉
 * （v6 文档不含 repeat）。
 * 其余字段原样保留（不丢数据）；当前版本原样返回（幂等）；比 v4 更老的版本抛错
 * （无机械迁移路径）。
 */
export function migrateTemplateToCurrent(input: FormTemplate): FormTemplate {
  if (input.schemaVersion === TEMPLATE_SCHEMA_VERSION) return input
  if (input.schemaVersion !== 4 && input.schemaVersion !== 5) {
    throw new Error(
      `模板 schemaVersion ${String(input.schemaVersion)} 过旧：仅支持从 v4/v5 迁移到 v${TEMPLATE_SCHEMA_VERSION}`,
    )
  }
  // v4 → v5：单表达式包一层 return（中间形态不标 FormTemplate——schemaVersion 字面量还是 5）
  const v5 =
    input.schemaVersion === 4
      ? {
          ...input,
          schemaVersion: 5,
          aggregations: (input.aggregations ?? []).map((agg) => ({
            ...agg,
            expression: `return (\n${agg.expression}\n);`,
          })),
        }
      : input
  const referenced = new Set(
    (v5.regions ?? []).flatMap((region) =>
      region.source?.kind === 'agg' ? [region.source.aggName] : [],
    ),
  )
  return {
    ...v5,
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    // 存量 repeat（每页重复）宽容丢弃：设计器不再产出，加载路径同样不认
    regions: (v5.regions ?? []).map((region) => {
      const { repeat: _repeat, ...rest } = region as FormRegion & { repeat?: boolean }
      return rest
    }),
    aggregations: (v5.aggregations ?? []).map((agg) => ({
      ...agg,
      type: agg.type ?? deriveAggregationType(agg, referenced),
    })),
  }
}

/**
 * 聚合类型（v6 起 FormAggregation 必填）：
 * - `array` **数组型**：函数体返回列表，可作数据块数据源逐条打印；
 * - `value` **非数组型**：返回单个值或对象，供任意单元格直接引用。
 * 类型是否属实由「空数据试跑」验证（probeAggregationType）——提交路径强校验。
 */
export type AggregationType = 'array' | 'value'

/** 聚合类型选项（UI 分段按钮直接消费；hint 写清两类产物的用途差异） */
export const AGGREGATION_TYPE_OPTIONS: { value: AggregationType; label: string; hint: string }[] = [
  { value: 'array', label: '数组型', hint: '产出一列数据，可绑成数据块逐条打印' },
  { value: 'value', label: '非数组型', hint: '产出一个值或对象，任意单元格直接引用' },
]

/** 聚合类型展示名（报错文案与 UI 徽标共用同一口径） */
export function aggregationTypeLabel(type: AggregationType): string {
  return type === 'array' ? '数组型' : '非数组型'
}

/**
 * v5 聚合缺 `type` 的推导：空数据试跑（返回数组 → array，否则 → value）；试跑抛错
 * 回退——被数据块 `kind: 'agg'` 源引用 → array（数据源不断链），否则 value。
 */
function deriveAggregationType(
  agg: Pick<FormAggregation, 'name' | 'params' | 'expression'>,
  referencedNames: ReadonlySet<string>,
): AggregationType {
  const probe = probeAggregationType(agg.params, agg.expression)
  if (probe.ok) return probe.returns
  return referencedNames.has(agg.name) ? 'array' : 'value'
}

/** 数据块列表方式（原「展开方式」）：非列表（固定一块）/ 纵向列表 / 横向列表；模型值不变 */
export type RegionExpand = 'none' | 'down' | 'right'

/** 列表方式选项（UI select 直接消费；hint 写清行为，面板在 select 下方灰字展示） */
export const REGION_EXPAND_OPTIONS: { value: RegionExpand; label: string; hint: string }[] = [
  {
    value: 'none',
    label: '非列表（固定一块）',
    hint: '固定内容，只打印一份（适合标题、签字栏）',
  },
  {
    value: 'down',
    label: '纵向列表（一条一行）',
    hint: '每条数据向下复制一份整块（如订单明细行）',
  },
  {
    value: 'right',
    label: '横向列表（一条一列）',
    hint: '每条数据向右复制一份整块',
  },
]

/** 列表方式的展示名（非列表返回空串）；侧栏标签、绑定面板、悬停 pill 共用 */
export function regionExpandLabel(expand: RegionExpand): string {
  return expand === 'none'
    ? ''
    : (REGION_EXPAND_OPTIONS.find((option) => option.value === expand)?.label ?? '')
}

/**
 * 数据块展示名：`数据块 N · 纵向列表` / `数据块 N`（非列表不加后缀）。
 * 侧栏列表、绑定面板、选区 chip、画布悬停 pill 共用同一份文案，四处口径不会走偏。
 */
export function regionLabel(region: FormRegion, index: number): string {
  const expand = regionExpandLabel(region.expand)
  return expand ? `数据块 ${index + 1} · ${expand}` : `数据块 ${index + 1}`
}

/**
 * 数据块引用名：单元格函数里 `SUM('明细')` / 数据源 `agg` 引用用的键。
 * 自定义名优先，缺省回落「数据块 N」；normalizeRegions 保证全模板唯一。
 */
export function regionRefOf(region: FormRegion, index: number): string {
  return region.name?.trim() || `数据块 ${index + 1}`
}

/**
 * 数据块展开驱动：数据集（或聚合结果）× 重塑表达式 × 循环列表路径。
 *
 * 与单元格绑定完全独立——数据块里可以一个绑定都没有（数据块照样按份复制），
 * 反过来数据块里绑定的字段名也不会影响份数。
 */
export type RegionSource =
  | {
      /** 数据集来源 */
      kind: 'dataset'
      /** 目标数据集 id（必填非空） */
      datasetId: string
      /**
       * 数据集重塑表达式：以 `rows` 为唯一入参的 JS 表达式，求值结果即该数据集的
       * 取数形态；缺省 = 原始行数组直接作形态。预览与打印共用唯一重塑管线求值。
       */
      expression?: string
      /** 相对数据集形态的循环数组路径：`items` / `[0].items` / `''`（形态根即数组） */
      path: string
    }
  | {
      /** 聚合来源：取数组型聚合 `agg.{aggName}` 的返回列表做循环（value 型不可作数据块源） */
      kind: 'agg'
      aggName: string
      path: string
    }

/**
 * 数据块内行的渲染角色（分组语义；键为模板绝对行号，缺省 `detail`）。
 * - `detail`：按数据份数逐条复制（默认）；
 * - `groupHeader` / `groupFooter`：每组渲染一次（组头/小计行；绑定格取组内第 1 条，
 *   函数格可用 `SUBTOTAL` / `GROUP` 取组值）——要求数据块配置了 `groupBy`；
 * - `summary`：全部份数之后垫底渲染一次（合计行），任意纵向列表的数据块可用。
 */
export type RegionRowRole = 'detail' | 'groupHeader' | 'groupFooter' | 'summary'

/** 行角色选项（右键菜单与数据块弹框共用；顺序即菜单顺序）。hint 是「这行打印什么」的白话说明 */
export const REGION_ROW_ROLES: { value: RegionRowRole; label: string; hint: string }[] = [
  { value: 'detail', label: '明细行', hint: '每条数据占一行（默认）' },
  { value: 'groupHeader', label: '组头行', hint: '每组开头一行，显示分组名（如客户名）' },
  { value: 'groupFooter', label: '小计行', hint: '每组末尾一行，显示这一组的小计' },
  { value: 'summary', label: '合计行', hint: '所有组结束后的一行，显示总计' },
]

/** 行角色展示名（detail 返回空串，与展开方式的展示名口径一致） */
export function regionRowRoleLabel(role: RegionRowRole): string {
  return role === 'detail' ? '' : (REGION_ROW_ROLES.find((r) => r.value === role)?.label ?? '')
}

/** 数据块某行的角色（不在数据块内或未标记 → detail） */
export function regionRowRoleOf(region: FormRegion, row: number): RegionRowRole {
  return region.rowRoles?.find((entry) => entry.row === row)?.role ?? 'detail'
}

/**
 * 数据块：画布上的矩形 + 展开属性（闭区间，行列均为 0 基）。
 */
export interface FormRegion {
  startRow: number
  endRow: number
  startCol: number
  endCol: number
  expand: RegionExpand
  /** 数据块名（缺省按序号显示「数据块 N」；空字符串视为未命名） */
  name?: string
  /** 展开驱动源：可后绑（未绑时列表的数据块暂按 1 份渲染）；非列表的数据块也可带源（静态取第 1 条） */
  source?: RegionSource
  /** 分组字段（条目内相对路径，按声明序组成组键）；仅 `expand === 'down'` 可配置 */
  groupBy?: string[]
  /** 行角色标记（模板绝对行号；只在数据块内行上有效，规范化时自动剔除越界行） */
  rowRoles?: { row: number; role: RegionRowRole }[]
}

/**
 * 聚合：把一个或多个数据集的原始行经 JS 函数体加工成任意结构，挂到 `agg.{name}`。
 * 函数体形参 = `params` 按序声明的变量名（各收一个数据集的原始行数组），外加恒定
 * 的 `agg`（前序聚合的结果对象，按声明序求值）；必须 return 返回结果。
 * 返回值形态由 `type` 声明（数组型 = 列表，非数组型 = 单个值/对象），提交时经
 * 空数据试跑验证声明属实（见 normalizeAggregations 的 submit 模式）。
 */
export interface FormAggregation {
  /** 聚合变量名（挂载键 `agg.{name}`；全模板唯一） */
  name: string
  /** 入参声明：数据集 × 形参变量名（顺序即传参顺序） */
  params: { datasetId: string; varName: string }[]
  /**
   * 聚合类型（v6 起必填；v5 旧档缺省由迁移/加载路径推导补齐）：`array` 返回列表可作
   * 数据块数据源；`value` 返回单个值或对象供单元格直接引用。
   */
  type: AggregationType
  /** JS 函数体（语句序列，必须 return 返回结果；严格模式求值，返回值即 `agg.{name}`） */
  expression: string
}

/**
 * 格级字段绑定的 cell-meta sidecar 载荷形状（判别联合两种形态）。
 * 存储在 `FORM_BINDING_META_NAMESPACE` 命名空间下，随 SheetSnapshot.meta 序列化。
 *
 * - 相对绑定（无 kind，块内主路径）：**只能落在绑了数据源的数据块之内**——`path` 是
 *   条目内相对字段（`item_name`、`customer.name`，`''` 表示条目本身就是该格的值），
 *   数据源继承所在数据块 `source`。列表的数据块按份数取值；非列表（带源）的数据块
 *   取循环数组第 1 条；
 * - 聚合引用（`kind: 'agg'）：直接引用**非数组聚合**的返回值——任意单元格可设（数据
 *   块外的单据头字段不用套数据块），`path` 是聚合结果内的取值路径（`a.b` 嵌套下钻，
 *   `''` = 值本身），求值只看聚合环境、与所在数据块无关。
 *
 * 两种绑定都与函数互斥（写入绑定即清函数，见 FormDoc.setCellBinding）。
 */
export type FormCellBinding = FormCellRelativeBinding | FormCellAggBinding

/** 相对绑定：条目内相对路径，数据源继承所在数据块 */
export interface FormCellRelativeBinding {
  /** 取数路径：条目内相对路径（点分段字符串，不允许 `[]` 循环标记；`''` = 条目本身） */
  path: string
}

/** 聚合引用绑定：取非数组聚合 `agg.{aggName}` 的返回值（`path` 空串 = 值本身） */
export interface FormCellAggBinding {
  kind: 'agg'
  /** 目标聚合名（聚合重命名时联动改写） */
  aggName: string
  /** 聚合结果内的取值路径（点分段字符串；`''` = 聚合值本身，仅原始类型进格） */
  path: string
}

/** 聚合引用绑定判定（sidecar 扫描/求值分流共用；对意外脏载荷安全返回 false） */
export function isAggBinding(payload: unknown): payload is FormCellAggBinding {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { kind?: unknown }).kind === 'agg'
  )
}

/**
 * 规范化/校验单元格绑定载荷（加载与写入共用同一条口径）：
 * - 相对绑定（无 kind）：`path` 字符串（空串 = 条目本身）；
 * - 聚合引用（kind: 'agg'）：`aggName` 非空、`path` 可空（空串 = 聚合值本身）。
 * 引用的聚合不存在**不在**此校验（删除聚合可能留下悬空引用，求值按 miss → 空处理）。
 * 非法载荷抛错（fromTemplate 整模板拒绝，不静默吞）。
 */
export function normalizeCellBinding(payload: unknown): FormCellBinding {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('绑定载荷必须是对象')
  }
  const input = payload as Record<string, unknown>
  if (input.kind === undefined) {
    if (typeof input.path !== 'string') throw new Error('绑定载荷缺少 path 字符串')
    return { path: input.path.trim() }
  }
  if (input.kind === 'agg') {
    const aggName = typeof input.aggName === 'string' ? input.aggName.trim() : ''
    if (aggName === '') throw new Error('聚合引用的聚合名不能为空')
    const path = typeof input.path === 'string' ? input.path.trim() : ''
    return { kind: 'agg', aggName, path }
  }
  throw new Error(`绑定载荷 kind 非法：${String(input.kind)}（可用：agg）`)
}

/** 绑定 sidecar 的 cell-meta namespace（区别于 sheet 内建的 cell-image/cell-link） */
export const FORM_BINDING_META_NAMESPACE = 'form-binding'

/** 以数据块为实参的六个聚合函数名（GROUP 不带数据块参数，单列一个形状） */
export type RegionFnName = 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX' | 'SUBTOTAL'

/** 结构化函数名全集（「选择函数」下拉与 normalize 校验共用；求值实现见 cell-function.ts） */
export type CellFnName = RegionFnName | 'GROUP'

/**
 * 格级函数的 cell-meta sidecar 载荷（「作用方式」的替代），判别联合两种形态：
 * - `fn`（主路径）：结构化聚合 `FN('数据块'[, '字段'])`，编辑器下拉选函数 + 选参数即得；
 * - `expr`（逃生舱）：自定义受限 JS 表达式（`item` / `agg` / 六函数可用，
 *   语义同旧表达式），编辑器显式「应用」提交。
 *
 * 任何单元格都可设置；求值与占位符展示共用 `cellFunctionExpression` 的合成口径。
 */
export type FormCellFunction = FormCellRegionFn | FormCellGroupFn | FormCellExpr

/** 结构化数据块聚合：对某数据块的某字段做 SUM/AVG/…；字段省略 = 跟随本列绑定字段 */
export interface FormCellRegionFn {
  kind: 'fn'
  fn: RegionFnName
  /** 目标数据块引用名（regionRefOf 的键；数据块重命名时联动改写） */
  region: string
  /** 目标字段（条目内路径）；省略 = 函数格所在列在该数据块绑定的字段（COUNT 省略 = 计条数） */
  field?: string
}

/** 结构化分组值：取函数格所在分组区的当前组展示值（分组语境由求值环境给出，不带数据块参数） */
export interface FormCellGroupFn {
  kind: 'fn'
  fn: 'GROUP'
  /** 组值字段；省略 = 数据块首个分组字段 */
  field?: string
}

/** 自定义 JS 表达式：`item.qty * item.price`、`agg.summary['总计']` 等（受限求值） */
export interface FormCellExpr {
  kind: 'expr'
  expression: string
}

/**
 * v5 早期的旧载荷形状（只有 expression、无 kind）。仅为兼容旧调用方保留：
 * 写入（setCellFunction）与加载（fromTemplate）都经 normalizeCellFunction 嗅探
 * 转换，文档内与落盘载荷不会再是这个形状。
 */
export interface LegacyFormCellFunction {
  expression: string
}

/** 函数 sidecar 的 cell-meta namespace */
export const FORM_FUNCTION_META_NAMESPACE = 'form-function'

/** fn 枚举校验集合（normalizeCellFunction 报错文案与校验共用） */
const REGION_FN_NAMES: readonly RegionFnName[] = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'SUBTOTAL']

/** 旧表达式可嗅探为结构化的形态：`FN('数据块')` / `FN('数据块', '字段')` */
const REGION_FN_SNIFF = /^(SUM|AVG|COUNT|MIN|MAX|SUBTOTAL)\s*\(\s*'([^']*)'\s*(?:,\s*'([^']*)'\s*)?\)$/

/** 同上，GROUP 家族：`GROUP()` / `GROUP('字段')` */
const GROUP_FN_SNIFF = /^GROUP\s*\(\s*(?:'([^']*)'\s*)?\)$/

/** 可选字段参数的收敛：非空字符串 trim 后带上，其余（含 '' / undefined）视为省略 */
function optionalField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * 旧表达式载荷（只有 expression 字符串、无 kind——v5 早期形态）的嗅探转换：
 * 恰好是 `FN('数据块'[, '字段'])` / `GROUP(['字段'])` 单次调用的 → 结构化 `fn`；
 * 其余（复合表达式、item/agg 引用、空数据块名等）→ `expr` 原样保留，语义不变。
 */
function sniffLegacyExpression(expression: unknown): FormCellFunction {
  if (typeof expression !== 'string') throw new Error('函数载荷缺少 expression 字符串')
  const source = expression.trim()
  if (source === '') throw new Error('函数表达式不能为空')
  const regionMatch = REGION_FN_SNIFF.exec(source)
  if (regionMatch && regionMatch[2] !== '') {
    const field = optionalField(regionMatch[3])
    return field
      ? { kind: 'fn', fn: regionMatch[1] as RegionFnName, region: regionMatch[2]!, field }
      : { kind: 'fn', fn: regionMatch[1] as RegionFnName, region: regionMatch[2]! }
  }
  const groupMatch = GROUP_FN_SNIFF.exec(source)
  if (groupMatch) {
    const field = optionalField(groupMatch[1])
    return field ? { kind: 'fn', fn: 'GROUP', field } : { kind: 'fn', fn: 'GROUP' }
  }
  return { kind: 'expr', expression: source }
}

/**
 * 规范化/校验单元格函数载荷（加载与写入共用同一条口径）：
 * - 旧形状（无 kind）走 sniffLegacyExpression 嗅探；
 * - `fn` 形状：fn 在枚举内、数据块函数的数据块名非空、字段可省略（空串视为省略）；
 * - `expr` 形状：表达式非空。非法载荷抛错（fromTemplate 整模板拒绝，不静默吞）。
 */
export function normalizeCellFunction(payload: unknown): FormCellFunction {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('函数载荷必须是对象')
  }
  const input = payload as Record<string, unknown>
  if (input.kind === undefined) return sniffLegacyExpression(input.expression)
  if (input.kind === 'fn') {
    if (input.fn === 'GROUP') {
      const field = optionalField(input.field)
      return field ? { kind: 'fn', fn: 'GROUP', field } : { kind: 'fn', fn: 'GROUP' }
    }
    if (typeof input.fn !== 'string' || !REGION_FN_NAMES.includes(input.fn as RegionFnName)) {
      throw new Error(
        `函数名非法：${String(input.fn)}（可用：${REGION_FN_NAMES.join(' / ')} / GROUP）`,
      )
    }
    const region = typeof input.region === 'string' ? input.region.trim() : ''
    if (region === '') throw new Error(`${String(input.fn)} 的数据块不能为空`)
    const field = optionalField(input.field)
    const fn = input.fn as RegionFnName
    return field ? { kind: 'fn', fn, region, field } : { kind: 'fn', fn, region }
  }
  if (input.kind === 'expr') {
    const expression = typeof input.expression === 'string' ? input.expression.trim() : ''
    if (expression === '') throw new Error('函数表达式不能为空')
    return { kind: 'expr', expression }
  }
  throw new Error(`函数载荷 kind 非法：${String(input.kind)}（可用：fn / expr）`)
}

/**
 * 函数载荷 → 表达式字符串：结构化按 `FN('数据块'[, '字段'])` / `GROUP(['字段'])` 合成，
 * 自定义原样返回。画布占位符 / 绑定清单标签（formatFunctionPlaceholder）与数据态
 * 求值（data-state → evaluateCellFunction）共用同一合成口径，显示与求值永不走样。
 */
export function cellFunctionExpression(fn: FormCellFunction): string {
  if (fn.kind === 'expr') return fn.expression
  if (fn.fn === 'GROUP') return fn.field ? `GROUP('${fn.field}')` : 'GROUP()'
  return fn.field ? `${fn.fn}('${fn.region}', '${fn.field}')` : `${fn.fn}('${fn.region}')`
}

/** 数据块式打印单模板（后端 REST 持久化的 JSON 形态） */
export interface FormTemplate {
  schemaVersion: typeof TEMPLATE_SCHEMA_VERSION
  name: string
  /** 数据块序列（界面称「数据块」，模板 JSON 键为 `regions`；顺序即侧栏顺序，与画布位置无关；可为空数组） */
  regions: FormRegion[]
  /** 聚合序列（按声明序求值，后序可用前序结果）；可为空数组 */
  aggregations: FormAggregation[]
  /** 画布内容快照：值/样式池/合并/行高列宽/行列默认样式/cell-meta（含绑定/函数 sidecar） */
  sheet: SheetSnapshot
}

/** 绑定 → 画布占位符文本（配置态显示；数据只在打印预览/打印时渲染） */
export function formatBindingPlaceholder(binding: FormCellBinding): string {
  if (isAggBinding(binding)) {
    return binding.path ? `{{agg.${binding.aggName}.${binding.path}}}` : `{{agg.${binding.aggName}}}`
  }
  return `{{${binding.path}}}`
}

/** 函数 → 画布占位符文本（与绑定占位符同族，数据态渲染时被求值替换） */
export function formatFunctionPlaceholder(fn: FormCellFunction): string {
  return `{{${cellFunctionExpression(fn)}}}`
}

/** 数据源 → 展示用的数据集 id（agg 来源返回聚合名；无源返回空串） */
export function regionSourceLabel(source: RegionSource | undefined): string {
  if (!source) return ''
  return source.kind === 'dataset' ? source.datasetId : `agg.${source.aggName}`
}

/** JS 标识符校验（聚合形参变量名用） */
export function isIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
}

/**
 * 规范化/校验数据块序列：不越界（非负）、不重叠、start ≤ end、列表方式合法、数据源
 * 完整、引用名唯一、分组与行角色只在纵向列表的数据块上有效、角色行落在数据块内。
 *
 * 编辑期与持久化期共用同一条口径（v4 起不再清理「非列表的数据块上的 source」——它有
 * 明确语义：静态取第 1 条）。
 */
export function normalizeRegions(
  regions: readonly FormRegion[],
  aggregations: readonly FormAggregation[] = [],
): FormRegion[] {
  const normalized = regions.map((region, index) => {
    const label = `数据块 ${index + 1}`
    if (region.startRow > region.endRow) {
      throw new Error(`${label}行范围非法：起始 ${region.startRow} > 结束 ${region.endRow}`)
    }
    if (region.startCol > region.endCol) {
      throw new Error(`${label}列范围非法：起始 ${region.startCol} > 结束 ${region.endCol}`)
    }
    if (region.startRow < 0 || region.startCol < 0) {
      throw new Error(`${label}范围非法：不能为负数`)
    }
    if (region.expand !== 'none' && region.expand !== 'down' && region.expand !== 'right') {
      throw new Error(`${label}列表方式非法：${String(region.expand)}`)
    }
    const source = region.source
    if (source) {
      if (source.kind === 'dataset' && source.datasetId.trim() === '') {
        throw new Error(`${label}数据源不完整：数据集不能为空`)
      }
      if (source.kind === 'agg' && !aggregations.some((agg) => agg.name === source.aggName)) {
        throw new Error(`${label}数据源引用的聚合不存在：${source.aggName}`)
      }
    }
    if (region.groupBy && region.expand !== 'down') {
      throw new Error(`${label}分组只支持「纵向列表（一条一行）」的数据块`)
    }
    const groupBy = region.groupBy?.map((path) => path.trim()).filter((path) => path !== '')
    const rowRoles = region.rowRoles?.filter(
      (entry) => entry.row >= region.startRow && entry.row <= region.endRow,
    )
    const needsGroup = rowRoles?.some(
      (entry) => entry.role === 'groupHeader' || entry.role === 'groupFooter',
    )
    if (needsGroup && (!groupBy || groupBy.length === 0)) {
      throw new Error(`${label}设置了组头/小计行，必须先配置分组字段`)
    }
    const name = region.name?.trim()
    // 逐字段重建：存量载荷里被移除的字段（如旧版 repeat）在此自然丢弃，不报错
    const next: FormRegion = {
      startRow: region.startRow,
      endRow: region.endRow,
      startCol: region.startCol,
      endCol: region.endCol,
      expand: region.expand,
      ...(name ? { name } : {}),
    }
    if (region.source) {
      next.source =
        region.source.kind === 'dataset'
          ? {
              kind: 'dataset',
              datasetId: region.source.datasetId.trim(),
              ...(region.source.expression?.trim()
                ? { expression: region.source.expression.trim() }
                : {}),
              path: region.source.path,
            }
          : { kind: 'agg', aggName: region.source.aggName.trim(), path: region.source.path }
    }
    if (groupBy?.length) next.groupBy = groupBy
    if (rowRoles?.length) {
      next.rowRoles = rowRoles.map((entry) => ({ row: entry.row, role: entry.role }))
    }
    return next
  })
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      if (regionsOverlap(normalized[i]!, normalized[j]!)) {
        throw new Error(`数据块 ${i + 1} 与数据块 ${j + 1} 重叠：一个格子不能属于两个数据块`)
      }
    }
  }
  const refs = new Set<string>()
  normalized.forEach((region, index) => {
    const ref = regionRefOf(region, index)
    if (refs.has(ref)) {
      throw new Error(`数据块引用名重复：${ref}（函数与聚合靠它引用数据块，必须唯一）`)
    }
    refs.add(ref)
  })
  return normalized
}

/** normalizeAggregations 的模式与推导上下文（提交强校验 / 加载宽松推导两条路径） */
export interface NormalizeAggregationsOptions {
  /**
   * - `submit`（用户提交路径，setAggregations）：**空数据试跑强校验**——试跑抛错、或
   *   返回形态与声明类型不一致即抛错，坏函数体进不了文档（也保证打印时空数据集不炸）；
   * - `load`（缺省；加载/迁移/保存路径）：**不卡**——声明了类型就信任，缺 type 用试跑
   *   推导，推导失败按回退补齐（见 options.regions），保证旧档与「先建骨架再补内容」
   *   的工作流能加载。
   */
  mode?: 'load' | 'submit'
  /** 推导回退判定用的数据块序列（取 `kind: 'agg'` 源引用的聚合名集合）；缺省视为无引用 */
  regions?: readonly FormRegion[]
}

/**
 * 规范化/校验聚合序列：名字非空且唯一、形参变量名是合法 JS 标识符且互不冲突
 * （也不得占用 `agg`）、函数体非空且含 return（简单关键字检查，不做作用域级分析）、
 * `type` 必填且枚举合法（array 数组型 / value 非数组型）。
 *
 * 空数据试跑按模式分流（见 NormalizeAggregationsOptions）：提交路径缺 type 时先推导
 * 再强校验（推导失败同样拒绝），加载/迁移路径缺 type 只推导、失败回退不卡。
 * 试跑相关报错都带聚合名（`聚合「名」…`）。
 */
export function normalizeAggregations(
  aggregations: readonly FormAggregation[],
  options: NormalizeAggregationsOptions = {},
): FormAggregation[] {
  const strict = options.mode === 'submit'
  const referencedNames = new Set(
    (options.regions ?? []).flatMap((region) =>
      region.source?.kind === 'agg' ? [region.source.aggName] : [],
    ),
  )
  const names = new Set<string>()
  return aggregations.map((agg, index) => {
    const label = `聚合 ${index + 1}`
    const name = agg.name.trim()
    if (!name) throw new Error(`${label}名字不能为空`)
    if (names.has(name)) throw new Error(`${label}名字重复：${name}`)
    names.add(name)
    const varNames = new Set<string>()
    const params = agg.params.map((param, paramIndex) => {
      if (param.datasetId.trim() === '') {
        throw new Error(`${label}入参 ${paramIndex + 1} 未选数据集`)
      }
      const varName = param.varName.trim()
      if (!isIdentifier(varName)) {
        throw new Error(`${label}入参变量名非法：${varName || '（空）'}（须是 JS 标识符）`)
      }
      if (varName === 'agg') throw new Error(`${label}入参变量名不能用保留名 agg`)
      if (varNames.has(varName)) throw new Error(`${label}入参变量名重复：${varName}`)
      varNames.add(varName)
      return { datasetId: param.datasetId.trim(), varName }
    })
    const expression = agg.expression.trim()
    if (!expression) throw new Error(`${label}函数体不能为空`)
    if (!/\breturn\b/.test(expression)) {
      throw new Error(`${label}函数体必须 return 返回结果`)
    }
    // type：载荷来自网络/手改 JSON，按 unknown 收敛——undefined = 缺省待推导，
    // 其余值必须在枚举内（坏数据两模式都拒绝，与数据块校验口径一致）
    const rawType: unknown = (agg as { type?: unknown }).type
    let type: AggregationType | undefined
    if (rawType === 'array' || rawType === 'value') type = rawType
    else if (rawType !== undefined) {
      throw new Error(`${label}类型非法：${String(rawType)}（可用：array 数组型 / value 非数组型）`)
    }
    // 空数据试跑：提交路径必跑（强校验）；加载路径仅在缺 type 时跑（推导），声明即信任
    if (strict || type === undefined) {
      const probe = probeAggregationType(params, expression)
      if (!probe.ok) {
        if (strict) {
          throw new Error(`聚合「${name}」用空数据试跑失败：${probe.error}`)
        }
        // 宽松路径推导失败：回退（被数据块引用 → array，否则 value），不卡加载
        type = referencedNames.has(name) ? 'array' : 'value'
      } else if (type === undefined) {
        type = probe.returns
      } else if (type !== probe.returns) {
        throw new Error(
          `聚合「${name}」声明为${aggregationTypeLabel(type)}，但空数据试跑返回了${
            probe.returns === 'array' ? '数组' : '非数组'
          }`,
        )
      }
    }
    return { name, params, type, expression }
  })
}

/** 数据块矩形内命中判定（画布底色、绑定面板判断当前格属于哪个数据块） */
export function regionsAt(
  regions: readonly FormRegion[],
  row: number,
  col: number,
): FormRegion | undefined {
  return regions.find(
    (region) =>
      row >= region.startRow &&
      row <= region.endRow &&
      col >= region.startCol &&
      col <= region.endCol,
  )
}

/** 两矩形是否重叠（闭区间；数据块创建/改范围时的重叠判定与规范化共用） */
export function regionsOverlap(a: FormRegion, b: FormRegion): boolean {
  return (
    a.startRow <= b.endRow &&
    a.endRow >= b.startRow &&
    a.startCol <= b.endCol &&
    a.endCol >= b.startCol
  )
}
