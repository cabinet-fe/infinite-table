// 画布内建滚动条：几何换算与命中的纯函数（绘制在 sky 交互浮层、指针在交互层拦截）。
// 滚动边界唯一来源 ScrollManager——可滚动 ⟺ maxLeft/maxTop > 0；滑块行程与滚动
// 范围同构（内容 = 视口 + 滚动余量），视口口径取整个画布（含行号列/列头带），
// 比例映射不受行头/列头像素差影响。内缩边距（margin）只作用于滑块厚度方向，
// 纵向行程几何不变——拖拽/点按换算与命中语义不受主题 token 影响。

import type { ScrollbarOptions } from './types'

/** 单轴滚动状态（ScrollManager 字段子集） */
export interface ScrollbarAxisState {
  /** 滚动余量（scroll.maxLeft / maxTop） */
  maxScroll: number
  /** 视口尺寸（scroll.viewportWidth / viewportHeight） */
  viewport: number
  /** 当前偏移（scroll.left / top） */
  offset: number
}

/** 滑块几何：trackLen 同时供命中与拖拽换算（轨道起点 = 画布对应边） */
export interface ScrollbarThumbGeometry {
  trackLen: number
  thumbSize: number
  thumbPos: number
  maxScroll: number
}

/** 滑块最小长度：内容远超视口时保持可抓取 */
export const MIN_SCROLLBAR_THUMB_PX = 24

/**
 * 滑块绘制厚度：条带厚度扣除两侧内缩边距（hover/拖拽档传收窄边距即视觉变粗）；负值钳 0。
 * 仅厚度方向内缩——纵向 thumbPos/thumbSize 行程几何不变，换算语义与 token 解耦。
 */
export function scrollbarThumbThickness(size: number, margin: number): number {
  return Math.max(0, size - 2 * margin)
}

/** 单轴滚动条浮层视图：几何 + 视觉态（三态色与两档厚度在浮层按此选取） */
export interface ScrollbarAxisView {
  geometry: ScrollbarThumbGeometry
  /** 指针悬停滑块（非拖拽 pointermove 命中滑块置位） */
  hover: boolean
  /** 拖拽会话进行中（激活色 + 收窄内缩档） */
  active: boolean
}

/** options.scrollbar 归一化：false/undefined 关开与默认档位、对象形态透传策略与延时 */
export interface ScrollbarConfig {
  enabled: boolean
  visibility: 'always' | 'scrolling' | 'hover'
  /** 显式延时（缺省回落主题 scrollbarHideDelay token，运行时逐次读取） */
  hideDelay: number | undefined
  /** 可滚动轴常驻预留轨道条带（reserve: false 回悬浮式） */
  reserve: boolean
}

export function resolveScrollbarConfig(
  option: boolean | ScrollbarOptions | undefined,
): ScrollbarConfig {
  if (option === false) {
    return { enabled: false, visibility: 'always', hideDelay: undefined, reserve: false }
  }
  // 未配置缺省 'hover'：指针悬停表格内或滚动时显示，静止后隐藏
  if (option === undefined) {
    return { enabled: true, visibility: 'hover', hideDelay: undefined, reserve: true }
  }
  // 显式 true 保留旧语义：常驻
  if (option === true) {
    return { enabled: true, visibility: 'always', hideDelay: undefined, reserve: true }
  }
  return {
    enabled: true,
    visibility: option.visibility ?? 'hover',
    hideDelay: option.hideDelay,
    reserve: option.reserve ?? true,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 滑块几何：无滚动余量或轨道非正返回 null（该轴不显示、不命中） */
export function planScrollbarThumb(
  state: ScrollbarAxisState,
  trackLen: number,
): ScrollbarThumbGeometry | null {
  if (!(trackLen > 0) || !(state.viewport > 0) || !(state.maxScroll > 0)) {
    return null
  }
  const thumbSize = Math.max(
    MIN_SCROLLBAR_THUMB_PX,
    Math.round((state.viewport / (state.viewport + state.maxScroll)) * trackLen),
  )
  const ratio = clamp(state.offset / state.maxScroll, 0, 1)
  return {
    trackLen,
    thumbSize,
    thumbPos: Math.round(ratio * (trackLen - thumbSize)),
    maxScroll: state.maxScroll,
  }
}

/** 滑块拖动：指针位移（px）→ 目标滚动偏移（已按 0..maxScroll 钳制） */
export function mapScrollbarThumbDrag(
  geometry: ScrollbarThumbGeometry,
  startOffset: number,
  deltaPx: number,
): number {
  const usable = geometry.trackLen - geometry.thumbSize
  if (!(usable > 0)) return startOffset
  return clamp(startOffset + (deltaPx * geometry.maxScroll) / usable, 0, geometry.maxScroll)
}

/** 轨道点按：点按处作为滑块中心 → 目标滚动偏移（已钳制取整） */
export function mapScrollbarTrackPoint(geometry: ScrollbarThumbGeometry, pointPx: number): number {
  const usable = geometry.trackLen - geometry.thumbSize
  if (!(usable > 0)) return 0
  const ratio = clamp((pointPx - geometry.thumbSize / 2) / usable, 0, 1)
  return Math.round(ratio * geometry.maxScroll)
}

/** 滚动条命中：命中点在轨道上的投影（相对轨道起点，px）与是否落在滑块上 */
export interface ScrollbarHit {
  axis: 'vertical' | 'horizontal'
  pointPx: number
  onThumb: boolean
}

/** 滚动条拖拽会话（交互层内部状态） */
export interface ScrollbarDragSession {
  axis: 'vertical' | 'horizontal'
  startPx: number
  startOffset: number
  /** 合帧待提交的滚动目标（rAF 提交任务读取后清空；会话结束同步冲刷） */
  pendingOffset: number | undefined
}

/**
 * 命中判定：竖轴条带 = 右缘 [width-size, width) × [0, height)，横轴条带 =
 * 下缘 [0, width) × [height-size, height)；两轴皆有滑块时右下 size×size 空白角
 * 不命中（对侧条带互斥收边），单轴时该轴条带延伸到画布缘。该轴无滑块
 * （不可滚动）不命中。
 */
export function hitScrollbar(
  width: number,
  height: number,
  size: number,
  vertical: ScrollbarThumbGeometry | null,
  horizontal: ScrollbarThumbGeometry | null,
  x: number,
  y: number,
): ScrollbarHit | null {
  if (x >= width - size && y < height - (horizontal ? size : 0) && vertical) {
    const pointPx = y
    return {
      axis: 'vertical',
      pointPx,
      onThumb: pointPx >= vertical.thumbPos && pointPx < vertical.thumbPos + vertical.thumbSize,
    }
  }
  if (y >= height - size && x < width - (vertical ? size : 0) && horizontal) {
    const pointPx = x
    return {
      axis: 'horizontal',
      pointPx,
      onThumb:
        pointPx >= horizontal.thumbPos && pointPx < horizontal.thumbPos + horizontal.thumbSize,
    }
  }
  return null
}
