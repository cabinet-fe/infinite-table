// 浮动对象纯几何与变换数学单源：锚点布局/反查、旋转包围盒、逆变换坐标、缩放/旋转会话状态与求值。
// 渲染与指针交互层（FloatObjectLayer）直接消费本模块，不各自维护重复数学。

import type { Region, Size } from '@infinitable/render'

import type { ResizeEdge } from '../interaction/resize-geometry'
import type { CellRef } from '../types'

/** Shift 旋转吸附步进（度） */
export const FLOAT_ROTATE_SNAP_DEG = 15
/** 变换最小尺寸（px）：夹取防止拖缩到零/负 */
export const MIN_FLOAT_TRANSFORM_SIZE = 8

/** 浮动对象格锚点（from 格 + 像素偏移 → to 格） */
export interface FloatAnchor {
  from: CellRef
  to: CellRef
  offsetX: number
  offsetY: number
}

/** 层坐标几何适配：由宿主表格提供（含表头偏移与滚动偏移），浮动几何不感知表格内部 */
export interface FloatGeometry {
  /** 格左上角在层坐标系中的位置 */
  cellOrigin(col: number, row: number): { x: number; y: number }
  cellSize(col: number, row: number): Size
  /**
   * 视口点 → 数据格（拖拽落点换算用，层坐标口径）；行列头带/空白返回 null（落点回弹）。
   * 缺省时拖拽只在层内跟随，抬起回弹（无落点换算能力）。
   */
  cellAtPoint?(x: number, y: number): CellRef | null
}

/** 浮动对象纯几何基型 */
export interface FloatObjectBase {
  id: string
  /** image 首批；chart/dom 预留（未加载内容时画占位） */
  kind: 'image' | 'chart' | 'dom'
  anchor: FloatAnchor
  /** 绝对像素尺寸；缺省时由 anchor.from → anchor.to 的格范围决定 */
  size?: Size
  /** 旋转角（顺时针度数，缺省 0）：渲染绕对象中心旋转，命中沿逆变换路径 */
  rotation?: number
}

/** 变换手柄：8 缩放（四角 + 四边中点，随对象 rotation 旋转）+ 顶部 1 旋转 */
export type FloatTransformHandle =
  | 'left-top'
  | 'center-top'
  | 'right-top'
  | 'left-middle'
  | 'right-middle'
  | 'left-bottom'
  | 'center-bottom'
  | 'right-bottom'
  | 'rotate'

/** 缩放手柄规格（名称 + 轴向符号） */
export interface FloatScaleHandleSpec {
  readonly name: Exclude<FloatTransformHandle, 'rotate'>
  readonly sx: -1 | 0 | 1
  readonly sy: -1 | 0 | 1
}

/**
 * 8 缩放手柄的位置与轴向符号：右/下缘为 +1（拖大）、左/上缘为 -1（拖大向反侧扩展）、
 * 中点 0（该轴不变）；中心位置 = ((sx+1)/2·w, (sy+1)/2·h)（局部未旋转帧）。
 */
export const SCALE_HANDLES: readonly FloatScaleHandleSpec[] = [
  { name: 'left-top', sx: -1, sy: -1 },
  { name: 'center-top', sx: 0, sy: -1 },
  { name: 'right-top', sx: 1, sy: -1 },
  { name: 'left-middle', sx: -1, sy: 0 },
  { name: 'right-middle', sx: 1, sy: 0 },
  { name: 'left-bottom', sx: -1, sy: 1 },
  { name: 'center-bottom', sx: 0, sy: 1 },
  { name: 'right-bottom', sx: 1, sy: 1 },
]

/** 缩放会话几何状态：对侧锚点（层坐标）在缩放期间保持不动，旋转角恒定 */
export interface FloatScaleState {
  readonly startX: number
  readonly startY: number
  readonly rotation: number
  readonly width0: number
  readonly height0: number
  /** 对侧锚点的层坐标（固定点） */
  readonly anchorX: number
  readonly anchorY: number
  readonly sx: -1 | 0 | 1
  readonly sy: -1 | 0 | 1
}

/** 旋转会话几何状态：中心不动，角度 = 原角 + 指针方位角差值 */
export interface FloatRotateState {
  readonly centerX: number
  readonly centerY: number
  /** 按下时指针相对中心的方位角（弧度） */
  readonly startAngle: number
  /** 按下时的对象旋转角（度） */
  readonly rotation0: number
}

/** 弧度（顺时针度数转） */
export function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** 度数归一化到 [0, 360) */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/**
 * 局部帧内矩形绕中心旋转 θ（顺时针度数）后的轴对齐包围盒（局部帧坐标）。
 * θ = 0 即原矩形；旋转内容（图片/选中环/手柄，均在旋转帧内绘制）的覆盖都以此为界。
 */
export function rotatedLocalCover(width: number, height: number, deg: number): Region {
  if (deg % 360 === 0) {
    return { x: 0, y: 0, width, height }
  }
  const rad = toRad(deg)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // 旋转后包围盒半宽/半高 = 原半边长在两轴上的投影和
  const extX = (width / 2) * Math.abs(cos) + (height / 2) * Math.abs(sin)
  const extY = (width / 2) * Math.abs(sin) + (height / 2) * Math.abs(cos)
  return {
    x: width / 2 - extX,
    y: height / 2 - extY,
    width: extX * 2,
    height: extY * 2,
  }
}

/** 缩放手柄中心（局部未旋转帧坐标）：轴向符号映射到边/角位置 */
export function scaleHandleCenter(
  sx: number,
  sy: number,
  width: number,
  height: number,
): [number, number] {
  return [((sx + 1) / 2) * width, ((sy + 1) / 2) * height]
}

/** 缩放手柄名 → 8 方向边（共享 resize 几何词汇；由 SCALE_HANDLES 轴向符号推导） */
export function floatHandleEdge(handle: Exclude<FloatTransformHandle, 'rotate'>): ResizeEdge {
  const { sx, sy } = SCALE_HANDLES.find((item) => item.name === handle)!
  const vertical = sy < 0 ? 'top' : sy > 0 ? 'bottom' : ''
  const horizontal = sx < 0 ? 'left' : sx > 0 ? 'right' : ''
  return (
    vertical && horizontal ? `${vertical}-${horizontal}` : vertical || horizontal
  ) as ResizeEdge
}

/**
 * 指针层坐标逆旋转回未旋转局部帧（旋转对象的命中/手柄判定共用）。
 * θ = 0 原样返回。
 */
export function toLocalFloatPoint(
  x: number,
  y: number,
  bounds: Region,
  rotation: number,
): { x: number; y: number } {
  if (rotation % 360 === 0) {
    return { x, y }
  }
  const rad = toRad(rotation)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  const dx = x - cx
  const dy = y - cy
  // R(θ) 的逆矩阵：[cos, sin; -sin, cos]（y 向下，θ 为顺时针度数）
  return { x: cx + dx * cos + dy * sin, y: cy - dx * sin + dy * cos }
}

/** 锚点 → 层坐标矩形：from 格原点 + 像素偏移为左上角；尺寸取 size 或 from→to 格范围 */
export function layoutFloatBounds(
  anchor: FloatAnchor,
  size: Size | undefined,
  geometry: FloatGeometry,
): Region {
  const origin = geometry.cellOrigin(anchor.from.col, anchor.from.row)
  const x = origin.x + anchor.offsetX
  const y = origin.y + anchor.offsetY
  if (size) {
    return { x, y, width: size.width, height: size.height }
  }
  const toOrigin = geometry.cellOrigin(anchor.to.col, anchor.to.row)
  const toSize = geometry.cellSize(anchor.to.col, anchor.to.row)
  return {
    x,
    y,
    width: Math.max(0, toOrigin.x + toSize.width - x),
    height: Math.max(0, toOrigin.y + toSize.height - y),
  }
}

/**
 * 按层坐标位置（对象视觉左上角）反查锚点：from 平移到落点格，落点余量写偏移
 * （负值 clamp 0），to 随 delta 平移保持跨度；落点反查无效（无 cellAtPoint 或行列头带）
 * 返回原锚点。拖拽结束与变换结束共用同一口径。
 */
export function resolveAnchorAt(
  anchor: FloatAnchor,
  x: number,
  y: number,
  geometry: FloatGeometry,
): FloatAnchor {
  const hit = geometry.cellAtPoint?.(x, y) ?? null
  if (!hit) {
    return anchor
  }
  const origin = geometry.cellOrigin(hit.col, hit.row)
  const dCol = hit.col - anchor.from.col
  const dRow = hit.row - anchor.from.row
  return {
    from: { col: hit.col, row: hit.row },
    to: { col: anchor.to.col + dCol, row: anchor.to.row + dRow },
    offsetX: Math.max(0, Math.round(x - origin.x)),
    offsetY: Math.max(0, Math.round(y - origin.y)),
  }
}

/** 构建缩放会话几何状态（计算并固定对侧锚点的层坐标） */
export function createFloatScaleState(
  handle: Exclude<FloatTransformHandle, 'rotate'>,
  bounds: Region,
  rotation: number,
  startX: number,
  startY: number,
): FloatScaleState | null {
  const def = SCALE_HANDLES.find((item) => item.name === handle)
  if (!def) {
    return null
  }
  const au = def.sx > 0 ? 0 : def.sx < 0 ? 1 : 0.5
  const av = def.sy > 0 ? 0 : def.sy < 0 ? 1 : 0.5
  const rad = toRad(rotation)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const ax = au * bounds.width - bounds.width / 2
  const ay = av * bounds.height - bounds.height / 2
  return {
    startX,
    startY,
    rotation,
    width0: bounds.width,
    height0: bounds.height,
    anchorX: bounds.x + bounds.width / 2 + ax * cos - ay * sin,
    anchorY: bounds.y + bounds.height / 2 + ax * sin + ay * cos,
    sx: def.sx,
    sy: def.sy,
  }
}

/**
 * 缩放跟随计算：指针位移逆旋转到对象坐标系，对侧锚点保持不动；
 * Shift 拖角等比（取两轴缩放比大者），宽高夹取到 minSize。
 */
export function computeScaledBounds(
  state: FloatScaleState,
  x: number,
  y: number,
  shiftKey: boolean,
  minSize = MIN_FLOAT_TRANSFORM_SIZE,
): Region {
  const dxTotal = x - state.startX
  const dyTotal = y - state.startY
  const rad = toRad(state.rotation)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = dxTotal * cos + dyTotal * sin
  const dy = -dxTotal * sin + dyTotal * cos
  let width = state.width0 + state.sx * dx
  let height = state.height0 + state.sy * dy
  if (shiftKey && state.sx !== 0 && state.sy !== 0) {
    const k = Math.max(width / state.width0, height / state.height0)
    width = state.width0 * k
    height = state.height0 * k
  }
  width = Math.max(minSize, Math.round(width))
  height = Math.max(minSize, Math.round(height))
  // 新中心 = 固定锚点 − R(θ)·(锚点相对新中心的局部向量)；左上角随之定
  const au = state.sx > 0 ? 0 : state.sx < 0 ? 1 : 0.5
  const av = state.sy > 0 ? 0 : state.sy < 0 ? 1 : 0.5
  const ax = au * width - width / 2
  const ay = av * height - height / 2
  const cx = state.anchorX - (ax * cos - ay * sin)
  const cy = state.anchorY - (ax * sin + ay * cos)
  return {
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
  }
}

/** 构建旋转会话几何状态 */
export function createFloatRotateState(
  bounds: Region,
  rotation0: number,
  startX: number,
  startY: number,
): FloatRotateState {
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  return {
    centerX,
    centerY,
    startAngle: Math.atan2(startY - centerY, startX - centerX),
    rotation0,
  }
}

/** 旋转跟随计算：角度 = 原角 + 指针方位角差值，Shift 吸附步进，量化 0.01° 后归一化 [0, 360) */
export function computeRotatedDeg(
  state: FloatRotateState,
  x: number,
  y: number,
  shiftKey: boolean,
  snapDeg = FLOAT_ROTATE_SNAP_DEG,
): number {
  const angle = Math.atan2(y - state.centerY, x - state.centerX)
  let deg = state.rotation0 + ((angle - state.startAngle) * 180) / Math.PI
  if (shiftKey) {
    deg = Math.round(deg / snapDeg) * snapDeg
  }
  return normalizeDeg(Math.round(deg * 100) / 100)
}
