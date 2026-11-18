// 引擎装配协议：多类平级引擎（表格 / sheet / 透视 / 甘特）的公共装配契约。
// 纯类型包：零运行时代码、零 @infinitable/grid 实现依赖，只依赖 @infinitable/render
// 的窄接口与本包内的网格纯值类型，实现由各引擎自行落地。

import type { RenderContext, RenderHost, Size } from '@infinitable/render'

import type { GridDataModel, GridReadView, WritableGridDataModel } from './grid'
import type { EnginePlugin } from './plugin'

/** 0 基单元格坐标 */
export interface CellAddress {
  col: number
  row: number
}

/** 引擎外框样式 token */
export interface EngineFrameStyle {
  /** 外框线宽（CSS 像素）；0 不绘制 */
  lineWidth: number
  /** 外框线色 */
  color: string
  /** 是否绘制外框阴影 */
  shadow: boolean
}

/** 引擎滚动条交互样式 token */
export interface EngineScrollbarTokens {
  scrollbarThumb: string
  scrollbarThumbHover: string
  scrollbarThumbActive: string
  scrollbarRadius: number
  scrollbarSize: number
  scrollbarTrackColor: string
  scrollbarMargin: number
  scrollbarMarginHover: number
  scrollbarHideDelay: number
}

/** 引擎协议层主题契约（中立基底，不绑定具体网格样式分区） */
export interface EngineTheme {
  underlayBackgroundColor: string
  frameStyle: EngineFrameStyle
  interaction: EngineScrollbarTokens
}

/** 引擎协议层主题覆写参数（深覆盖合并） */
export interface EngineThemeOverride {
  underlayBackgroundColor?: string
  frameStyle?: Partial<EngineFrameStyle>
  interaction?: Partial<EngineScrollbarTokens>
}

/** 整层绘制槽位：underlay（内容之下）| overlay（内容之上） */
export type PainterSlot = 'underlay' | 'overlay'

/** 整层绘制回调：每次层重绘时以层上下文与视口尺寸调用 */
export type LayerPainter = (ctx: RenderContext, viewport: Size) => void

/** 整层绘制器注册描述符（支持多插件有序叠加与独立注销） */
export interface PainterRegistration {
  readonly id: string
  readonly slot: PainterSlot
  readonly order?: number
  readonly paint: LayerPainter
}

/** 引擎可选能力集合（按需探测，取代核心装配体上的领域特例） */
export interface EngineCapabilities {
  readonly gridRead?: GridReadView
  readonly gridData?: GridDataModel
  readonly writableGridData?: WritableGridDataModel
}

/**
 * 引擎装配协议（中立本体）：任何引擎装配进宿主的公共路径——
 * 渲染宿主 + 视口尺寸 + 主题 + painter 注册槽位 + 插件槽位 + 生命周期 + 可选能力探测。
 */
export interface EngineAssembly {
  /** 渲染宿主（画布面）：层创建 / 失效提交 / 帧调度 / 文本测量 */
  readonly host: RenderHost
  /** 当前视口宽（CSS 像素） */
  readonly width: number
  /** 当前视口高（CSS 像素） */
  readonly height: number
  /** 调整引擎视口尺寸（CSS 像素） */
  resize(width: number, height: number): void
  /** 当前生效主题 */
  getTheme(): EngineTheme
  /** 运行时更新主题（深覆盖合并） */
  updateTheme(override: EngineThemeOverride): void
  /** 注册整层绘制器；返回注销函数 */
  registerPainter(registration: PainterRegistration): () => void
  /** 注册插件并立即挂载；返回卸载函数 */
  use(plugin: EnginePlugin): () => void
  /** 卸载已注册插件（按实例或插件名） */
  unuse(plugin: EnginePlugin | string): void
  /** 销毁引擎：卸载全部插件、解绑事件、回收渲染资源（幂等） */
  destroy(): void
  /** 引擎可选能力集合 */
  readonly capabilities?: EngineCapabilities
}
