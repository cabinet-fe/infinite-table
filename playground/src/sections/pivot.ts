// 透视表演示区：PivotGrid（@infinitable/pivot——平级领域引擎经引擎装配协议接入 table
// 引擎的参考形态）。行方向为多列树形布局：每个行维度独占一列，同组单元格跨行合并，
// 点击组格左缘展开图标折叠/展开（折叠组收敛为自带聚合值的单行载体；collapsible 可
// 配置为始终平铺），点击组格其余区域高亮从命中维度列起的整行带；列维度表头点击
// 高亮列组 × 全部数据行、数据格点击高亮自身（无拖选/填充柄/边框——引擎交互选区
// 关闭，选区即纯填充领域高亮）；列方向为多级
// 表头：初始即两级列维度（年份/月份，日期层级示例）+ 度量标题行（引擎冻结行落地，
// 表头区行维度列按维度分列）；双击数值格下钻明细记录；行/列维度与度量全部可运行时
// 勾选、排序与改聚合方式，结构原地落地不重建实例；水印为协议插件（TablePlugin 收
// EngineAssembly）跨引擎挂载的证明面。控件面（维度/度量配置区）由 PivotPage 以
// shadcn 渲染，经 demo.pivot 领域 API 驱动。容器撑满卡片宽（ResizeObserver 跟随
// 视口调整引擎尺寸）；冒烟模式锁固定几何保像素断言确定性。

import {
  PivotGrid,
  type PivotDimension,
  type PivotMeasure,
  type PivotRecord,
} from '@infinitable/pivot'
import { createWatermarkPlugin, type WatermarkHandle } from '@infinitable/plugins'

import { isSmokeMode, resolveDpr } from '../mount'

/** 多级表头行 / 折叠载体（小计）/ 总计行底色（冒烟像素断言锚点，转售 pivot 包常量） */
export {
  PIVOT_GRAND_BACKGROUND as PIVOT_GRAND_BG,
  PIVOT_HEADER_BACKGROUND as PIVOT_HEADER_BG,
  PIVOT_SUBTOTAL_BACKGROUND as PIVOT_SUBTOTAL_BG,
} from '@infinitable/pivot'

// ---- 演示维度与断言锚点（smoke 像素/行为断言共用单一事实源） ----

/** 记录数（48 条，i%3 / floor(i/3)%3 / floor(i/9)%3 轮转三维度；年月由 i 推导） */
export const PIVOT_RECORD_COUNT = 48
/** 初始形态：行维度 2 层全展开 → 9 leaf + 1 总计（展开组无自有行） */
export const PIVOT_INITIAL_ROW_COUNT = 10
/** 初始度量数（金额和 + 记录数） */
export const PIVOT_INITIAL_MEASURE_COUNT = 2
/** 初始列维度叶子路径数（年 2 值 × 月 2 值） */
export const PIVOT_COLUMN_PATH_COUNT = 4
/** 表头行数（列维度 2 层 + 度量行） */
export const PIVOT_HEADER_ROW_COUNT = 3
/** 初始合并区数：行维度标题竖条 2 + 年份层 2 + 月份层 4 + 状态列跨行组 3 + 总计行头 1 */
export const PIVOT_INITIAL_MERGE_COUNT = 12
/** 折叠一级首个组（已完成）后可见行数：1 载体 + 6 leaf + 1 总计 */
export const PIVOT_COLLAPSED_ROW_COUNT = 8
/** 单层行维度（状态）形态：3 leaf + 1 总计 */
export const PIVOT_SINGLE_LEVEL_ROW_COUNT = 4

/** row0 = 已完成×中 leaf × 2024年/7月：成员 i∈{4,13}，金额和与记录数 */
export const PIVOT_LEAF_AMOUNT = 829
export const PIVOT_LEAF_COUNT = 2
/** 折叠组（已完成）载体 × 2024年/7月：成员 i∈{1,4,13,16}，金额和与记录数 */
export const PIVOT_GROUP_AMOUNT = 1658
export const PIVOT_GROUP_COUNT = 4
/** 总计行 × 2024年/7月（首个列路径）：12 条、金额和 */
export const PIVOT_GRAND_FIRST_AMOUNT = 4974
export const PIVOT_GRAND_FIRST_COUNT = 12
/** 总计行 × 2025年/8月（末个列路径）：12 条 */
export const PIVOT_GRAND_LAST_COUNT = 12
/** 度量直排（无列维度）总计行金额和 */
export const PIVOT_GRAND_AMOUNT_TOTAL = 25836

/** 维度池（行/列维度勾选候选；年份/月份演示多级列维度表头） */
export const PIVOT_DIMENSIONS: readonly PivotDimension[] = [
  { key: 'status', title: '状态', width: 110 },
  { key: 'priority', title: '优先级', width: 100 },
  { key: 'category', title: '类别', width: 120 },
  { key: 'year', title: '年份', width: 90 },
  { key: 'month', title: '月份', width: 90 },
]

/** 度量池（度量勾选候选；标题随聚合方式由页面联动更新） */
export const PIVOT_MEASURES: readonly PivotMeasure[] = [
  { key: 'qty-sum', title: '数量和', field: 'qty', agg: 'sum', width: 110 },
  { key: 'amount-sum', title: '金额和', field: 'amount', agg: 'sum', width: 130 },
  { key: 'rating-avg', title: '评分均', field: 'rating', agg: 'avg', width: 110 },
  { key: 'record-count', title: '记录数', field: '', agg: 'count', width: 100 },
]

const STATUS_VALUES = ['进行中', '已完成', '待启动'] as const
const PRIORITY_VALUES = ['高', '中', '低'] as const
const CATEGORY_VALUES = ['办公用品', '家居生活', '数码电器'] as const
const YEAR_VALUES = ['2024年', '2025年'] as const
const MONTH_VALUES = ['7月', '8月'] as const

/** 记录 i 的取值（确定性：无随机） */
function pivotRecord(i: number): PivotRecord {
  return {
    status: STATUS_VALUES[i % 3]!,
    priority: PRIORITY_VALUES[Math.floor(i / 3) % 3]!,
    category: CATEGORY_VALUES[Math.floor(i / 9) % 3]!,
    year: YEAR_VALUES[Math.floor(i / 24)]!,
    month: MONTH_VALUES[Math.floor((i % 12) / 6)]!,
    qty: (i % 4) + 1,
    amount: ((i * 37) % 900) + 100,
    rating: ((i * 7) % 10) / 10,
  }
}

const PIVOT_RECORDS: readonly PivotRecord[] = Array.from({ length: PIVOT_RECORD_COUNT }, (_, i) =>
  pivotRecord(i),
)

export interface PivotDemo {
  container: HTMLElement
  /** 透视表领域引擎（维度/度量/折叠与结构查询 API；冒烟与页面控件共用） */
  pivot: PivotGrid
  /** 水印插件句柄（已挂引擎，enabled false；开关经 updateConfig） */
  watermark: WatermarkHandle
  /** 收尾：解绑尺寸跟随并销毁引擎（页面卸载用） */
  dispose: () => void
}

export function mountPivot(root: HTMLElement): PivotDemo {
  const section = document.createElement('section')
  root.appendChild(section)

  const container = document.createElement('div')
  container.className = 'table-mount'
  if (isSmokeMode()) {
    // 冒烟锁固定几何：像素断言确定性（列可见窗口/滚动条形态随宽度变化）
    container.style.width = '760px'
    container.style.height = '480px'
  } else {
    // 撑满卡片宽：引擎尺寸取容器实宽（构造时 clientWidth），随后 ResizeObserver 跟随
    container.style.width = '100%'
    container.style.height = '520px'
  }
  section.appendChild(container)

  const pivot = new PivotGrid({
    container,
    dpr: resolveDpr(),
    dimensions: PIVOT_DIMENSIONS,
    measures: PIVOT_MEASURES,
    records: PIVOT_RECORDS,
    rowDimensions: ['status', 'priority'],
    // 初始即两级列维度（年份/月份）：演示多级表头
    columnDimensions: ['year', 'month'],
    activeMeasures: ['amount-sum', 'record-count'],
  })
  const watermark = createWatermarkPlugin({ enabled: false, text: 'infinitable 透视表' })
  pivot.use(watermark)
  // 视口/布局变化 → 引擎原地 resize（滚动位置与高亮保留）
  const observer = new ResizeObserver(() => {
    pivot.getTable().resize(container.clientWidth, container.clientHeight)
  })
  observer.observe(container)

  return {
    container,
    pivot,
    watermark,
    dispose: () => {
      observer.disconnect()
      pivot.destroy()
    },
  }
}
