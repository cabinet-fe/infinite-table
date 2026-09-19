// sheet 区内联图标库（16×16 线性风格，stroke currentColor）：
// 对齐 ultra-ui 工具栏的视觉形态，但不依赖 @veltra/icons（demo 零外部 UI 依赖）。

/** 图标名 → SVG 内部标记（外层 svg 由 icon() 统一包裹） */
const ICONS: Record<string, string> = {
  undo: '<path d="M3.5 6.5h6.3a3.6 3.6 0 0 1 0 7.2H6.2"/><path d="M6.2 3.6 3.2 6.5l3 3"/>',
  redo: '<path d="M12.5 6.5H6.2a3.6 3.6 0 0 0 0 7.2h2.6"/><path d="M9.8 3.6l3 2.9-3 3"/>',
  border: '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M8 2.5v11M2.5 8h11"/>',
  fill: '<path d="m7.6 2.4 5 5-4.6 4.6a1.9 1.9 0 0 1-2.7 0L3 9.7a1.9 1.9 0 0 1 0-2.7z"/><path d="M3.4 8.3h7.3"/><path d="M13.6 10.6c.7.9.8 1.9 0 2.4-.7.4-1.6-.1-1.8-1.1-.1-.7.8-1.6.8-1.6z" fill="currentColor" stroke="none"/>',
  merge:
    '<rect x="2.5" y="3.5" width="11" height="9" rx="1"/><path d="M8 3.5v9" stroke-dasharray="2 1.6"/><path d="M5.6 8h4.8m0 0-1.5-1.5M10.4 8 8.9 9.5"/>',
  unmerge:
    '<rect x="2.5" y="3.5" width="11" height="9" rx="1"/><path d="M8 3.5v9"/><path d="M6.2 8H3.6m0 0 1.4-1.4M3.6 8 5 9.4M9.8 8h2.6m0 0-1.4-1.4M12.4 8 11 9.4"/>',
  bold: '<path d="M4.5 3h4a2.75 2.75 0 0 1 0 5.5h-4zm0 5.5h4.7a2.75 2.75 0 0 1 0 5.5h-4.7z"/>',
  italic: '<path d="M6.5 3h5M4.5 13h5M9.8 3 6.2 13"/>',
  underline: '<path d="M4.5 3v4.5a3.5 3.5 0 0 0 7 0V3"/><path d="M3 14h10"/>',
  strikethrough:
    '<path d="M3 8h10"/><path d="M5 5.2C5 4 6.4 3.2 8 3.2c1.5 0 3 .7 3 2M5.2 10.5c.5 1.4 1.8 2.3 3.4 2.3 1.5 0 3-.8 3.2-2.2"/>',
  'font-color': '<path d="M4 13 8 3l4 10M5.4 9.8h5.2"/>',
  'font-size': '<path d="M2.2 12.5 5.2 4l3 8.5M3.2 9.8h4M10.2 13.5 12 8.8l1.8 4.7M10.9 11.8h2.2"/>',
  'align-left': '<path d="M3 4h10M3 8h6.5M3 12h9"/>',
  'align-center': '<path d="M3 4h10M4.75 8h6.5M3.5 12h9"/>',
  'align-right': '<path d="M3 4h10M6.5 8h6.5M4 12h9"/>',
  'valign-top': '<path d="M4.5 3v10M8 3v6.5M11.5 3v10"/>',
  'valign-middle': '<path d="M4.5 3v10M8 5.5v5M11.5 3v10"/>',
  'valign-bottom': '<path d="M4.5 3v10M8 6.5v6.5M11.5 3v10"/>',
  wrap: '<path d="M3 3.5h10M3 7h6.5a2.7 2.7 0 0 1 0 5.4H7"/><path d="m8.8 10.2-2.3 2.2 2.3 2.2"/>',
  search: '<circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3.3 3.3"/>',
  functions:
    '<path d="M6.7 3.3c-1.6 0-2.4 1-2.4 2.3V13"/><path d="M4.1 7.2h3.1"/><path d="m9.3 6.2 4.4 5.6M13.7 6.2 9.3 11.8"/>',
  image:
    '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><circle cx="5.6" cy="6" r="1.1"/><path d="m3 11 2.6-2.6 2.2 2.2 2.4-2.4L13.5 11"/>',
  import: '<path d="M8 2.5v7.5"/><path d="m5 7 3 3 3-3"/><path d="M3 13.5h10"/>',
  export: '<path d="M8 10V2.5"/><path d="m5 5 3-3 3 3"/><path d="M3 13.5h10"/>',
  arrowLeft: '<path d="M10 3.5 5.5 8l4.5 4.5"/>',
  arrowRight: '<path d="M6 3.5 10.5 8 6 12.5"/>',
  close: '<path d="m4 4 8 8M12 4l-8 8"/>',
  check: '<path d="m3.5 8.5 3 3 6-7"/>',
  caret: '<path d="m4 6 4 4 4-4"/>',
}

/** 包一层 16×16 svg；extraAttrs 附加属性（如 stroke-width 覆盖） */
export function icon(name: string): string {
  const body = ICONS[name]
  if (!body) {
    throw new Error(`未知图标：${name}`)
  }
  return (
    `<svg class="sheet-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" ` +
    'stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" ' +
    `aria-hidden="true">${body}</svg>`
  )
}
