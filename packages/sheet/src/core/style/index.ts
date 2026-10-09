// 样式族聚合导出（显式具名，不 `export *`）；包级公共 API 白名单见 `src/index.ts`
export {
  BORDER_SIDES,
  BORDER_STYLE_WIDTH,
  BORDER_EDGE_DEFAULTS,
  FONT_STYLE_KEYS,
  ALIGN_STYLE_KEYS,
  type BorderLineStyle,
  type BorderSide,
  type BorderEdge,
  type HorizontalAlign,
  type VerticalAlign,
  type CellFont,
  type CellAlign,
  type CellStyle,
  type StyleId,
  type CellStylePatch,
} from './types'

export { StylePool } from './style-pool'

export { composeCellStyles } from './compose'

export { buildBorderPresetItems, type BorderPreset, type BorderPresetItem } from './border-presets'
