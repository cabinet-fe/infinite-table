// grid 公共类型：几何/滚动向词汇（格坐标、内建滚动条配置），自 core types.ts 随迁；
// 表格领域类型（数据供给、列定义、事件载荷等）留在消费侧。

/** 格坐标引用（图片加载窗口、浮动对象锚点共用） */
export interface CellRef {
  col: number
  row: number
}

/** 滚动条形态：'canvas' 画布内建（sky 浮层绘制，缺省旧语义）；'native' 浏览器原生滚动条 */
export type ScrollbarMode = 'canvas' | 'native'

/** 内建滚动条配置（ListTableOptions.scrollbar 的对象形态） */
export interface ScrollbarOptions {
  /**
   * 滚动条形态（缺省 'canvas'，旧语义完全保留）：
   * - 'canvas'：画布内建滚动条——sky 浮层绘制 + 右/下缘条带指针拦截（现状路径）；
   * - 'native'：浏览器原生滚动条——引擎在挂载容器内装配真实 DOM 滚动容器
   *   （overflow 滚动 + `scrollbar-gutter: stable`），滚动条由浏览器原生渲染、
   *   不自建 thumb/track，外观/显隐/触控板惯性/辅助功能完全随 OS。此形态下：
   *   visibility/hideDelay/reserve 不适用（原生滚动条显隐随 OS，给出即忽略）；
   *   gutter 预留由滚动容器布局扣除（横向/纵向含右下角 corner 独立预留、
   *   永不覆盖内容），视口口径改取滚动容器 clientWidth/clientHeight（已含扣除）；
   *   画布滚动条不再绘制、右/下缘条带不再拦截指针；引擎滚动状态（ScrollManager）
   *   与原生容器双向同步，scrollTo/scrollBy/键盘导航等程序化滚动照常可用。
   */
  mode?: ScrollbarMode
  /**
   * 显示策略：'hover' 悬停表格内或滚动时显示（缺省，静止 hideDelay 后隐藏）；
   * 'scrolling' 滚动或滚动条交互（拖拽/点按/悬停）时显示，静止 hideDelay 后隐藏；
   * 'always' 常驻（旧 true 语义）（参照 VTable scrollStyle.visible）。
   * 仅 canvas 形态适用（native 形态下忽略）。
   */
  visibility?: 'always' | 'scrolling' | 'hover'
  /**
   * 'scrolling'/'hover' 档静止后隐藏延时（ms）；缺省回落主题 interaction.scrollbarHideDelay。
   * 仅 canvas 形态适用（native 形态下忽略）。
   */
  hideDelay?: number
  /**
   * 预留轨道区：true（缺省）在可滚动轴的画布右/下缘常驻预留一条 scrollbarSize 宽的
   * 轨道条带（轨道底色 + 滑块绘制其上，表格内容不再被滚动条遮挡，桌面 Excel 观感）；
   * false 回悬浮式（滑块浮在内容之上，旧语义）。
   * 仅 canvas 形态适用（native 形态下 gutter 由滚动容器布局扣除）。
   */
  reserve?: boolean
}
