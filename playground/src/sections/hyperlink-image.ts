// 超链接与图片能力演示区：引擎按格超链接、图片嵌入单元格、浮动图片右键不穿透。
// ① 单元格超链接：sheet 模型 cell-link 载荷经 SheetGrid 自动接线（宿主不传 hook）——
//    setCellLink 命中格自动蓝字下划线 + 悬停 pointer 光标 + hover/leave/单击事件；
//    openCellLinkOnClick 关闭，打开行为由宿主（页面状态行）接管展示。
// ② 图片嵌入单元格：sheet.setCellImage 写模型，SheetGrid 自动接线 media 渲染通道（宿主
//    不传 hook）；contain/fill 缩放切换、插入/删除行列后图随格平移，按格查询 API 扫描定位。
// ③ 浮动图片右键：contextmenu 浮动层优先路由——右键命中浮动图派发携带图片 id 的浮动
//    对象右键事件（不穿透），对照普通格右键仍走单元格右键事件。
// 零网络资源：图片为内联 SVG data URL（引擎默认加载器直接命中，无需注入 loader）。
// 用户可见控件（按钮与状态行）由 HyperlinkImagePage 以 shadcn 组件承担。

import { Sheet, SheetGrid, type CellLinkPayload, type ImageFitMode } from '@infinitable/sheet'

// ---- ① 单元格超链接（Sheet 模型 + SheetGrid 自动接线） ----

const LINK_COL_COUNT = 4
/** 表内标题行 + 数据行（门面带缺省字母列头，列名作第 0 行表内标题） */
const LINK_HEADER_ROWS = 1
const LINK_DATA_ROWS = 8
/** 演示列宽（名称/链接/说明/备注） */
const LINK_COL_WIDTH = 130
/** 页面「设置/清除链接」按钮的目标格 */
export const LINK_TARGET = { col: 1, row: 5 } as const
/** 按钮写入的演示链接（URL 为伪协议展示形态，宿主接管打开时不真实跳转） */
const DEMO_LINK: CellLinkPayload = { url: 'demo://open/hyperlink-guide', text: '超链接使用指南' }
/** 预置链接格：链接列多格可悬停/单击观察 */
const PRESET_LINKS: ReadonlyArray<{ col: number; row: number; link: CellLinkPayload }> = [
  { col: 1, row: 1, link: { url: 'demo://open/docs', text: '引擎文档' } },
  { col: 1, row: 3, link: { url: 'demo://open/changelog', text: '更新日志' } },
]
/** 演示列名（第 0 行表内标题与数据格默认标签共用） */
const LINK_TITLES = ['名称', '链接', '说明', '备注'] as const

export interface LinkDemoState {
  /** 目标格当前是否有链接 */
  hasLink: boolean
}

export interface LinkDemo {
  container: HTMLElement
  grid: SheetGrid
  sheet: Sheet
  /** 向 LINK_TARGET 写入演示链接（格文本随链接显示文本更新） */
  setLink(): void
  /** 清除 LINK_TARGET 链接（格文本回落默认值） */
  clearLink(): void
  /** 当前状态（页面按钮驱动后刷新展示） */
  getState(): LinkDemoState
}

function mountLinkDemo(section: HTMLElement): LinkDemo {
  const container = document.createElement('div')
  container.className = 'table-mount'
  container.style.width = '578px'
  container.style.height = '284px'
  section.appendChild(container)

  const defaultText = (col: number, row: number): string => `${LINK_TITLES[col] ?? '列'}-${row}`

  const sheet = new Sheet('link-demo')
  // 第 0 行作列名标题行（对齐原列头观感，数据格从第 1 行起）
  for (let col = 0; col < LINK_COL_COUNT; col++) {
    sheet.setCellValue({ row: 0, col }, LINK_TITLES[col] ?? `列${col}`)
    sheet.setColWidth(col, LINK_COL_WIDTH)
  }
  sheet.setCellStyle(
    { start: { row: 0, col: 0 }, end: { row: 0, col: LINK_COL_COUNT - 1 } },
    { font: { bold: true } },
  )
  // 预置链接格：格文本 = 链接显示文本，链接载荷走模型命令通道（可 undo、随结构平移）
  for (const { col, row, link } of PRESET_LINKS) {
    sheet.setCellValue({ row, col }, link.text ?? link.url)
    sheet.setCellLink({ row, col }, { url: link.url, text: link.text })
  }

  const grid = new SheetGrid({
    container,
    sheet,
    rows: LINK_HEADER_ROWS + LINK_DATA_ROWS,
    cols: LINK_COL_COUNT,
    width: 578,
    height: 284,
    // 固定网格：演示尺寸可控
    growOnScroll: false,
    // 默认打开关闭：单击事件由页面状态行接管展示（真实宿主可在此打开 URL）
    openCellLinkOnClick: false,
  })

  return {
    container,
    grid,
    sheet,
    setLink: () => {
      sheet.setCellValue(LINK_TARGET, DEMO_LINK.text ?? DEMO_LINK.url)
      grid.setCellLink(LINK_TARGET, { url: DEMO_LINK.url, text: DEMO_LINK.text })
    },
    clearLink: () => {
      grid.clearCellLink(LINK_TARGET)
      sheet.setCellValue(LINK_TARGET, defaultText(LINK_TARGET.col, LINK_TARGET.row))
    },
    getState: () => ({ hasLink: sheet.getCellLink(LINK_TARGET) != null }),
  }
}

// ---- ② 图片嵌入单元格（Sheet 模型 + SheetGrid 自动接线渲染通道） ----

const EMBED_ROWS = 14
const EMBED_COLS = 8
/** 嵌入图初始锚点（按钮重新插入时也回到该格） */
export const EMBED_IMAGE_START = { row: 3, col: 2 } as const
/** 嵌入图扫描行列数上限（插入行列后模型行列数增长，扫描范围封顶防失控） */
const EMBED_SCAN_ROW_CAP = 100

/** 嵌入图源（内联 SVG data URL）：96×64 位图，contain/fill 两种 fit 下形变可辨 */
const EMBED_IMAGE_SRC = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64" viewBox="0 0 96 64">' +
    '<rect width="96" height="64" fill="#dbeafe"/>' +
    '<circle cx="28" cy="26" r="12" fill="#2563eb"/>' +
    '<rect x="48" y="16" width="32" height="20" fill="#1d4ed8"/>' +
    '<text x="8" y="54" font-size="11" fill="#1e3a8a">cell-image</text>' +
    '</svg>',
)}`

export interface EmbedDemoState {
  /** 嵌入图当前坐标（按格查询 API 扫描所得；无图为 null） */
  image: { row: number; col: number } | null
  /** 当前缩放模式 */
  fit: ImageFitMode
}

export interface EmbedDemo {
  container: HTMLElement
  grid: SheetGrid
  sheet: Sheet
  /** 插入/移除嵌入图（无图时插到 EMBED_IMAGE_START，有图时移除） */
  toggleImage(): void
  /** 切换缩放模式并写回模型（同 src 换 fit 原地生效） */
  setFit(fit: ImageFitMode): void
  /** 在图所在行上方插入一行（图随格下移；无图为无操作） */
  insertRowAboveImage(): void
  /** 删除图上方一行（图随格上移；图在第 0 行或无图为无操作） */
  deleteRowAboveImage(): void
  /** 在图所在列左侧插入一列（图随格右移；无图为无操作） */
  insertColLeftOfImage(): void
  /** 删除图左侧一列（图随格左移；图在第 0 列或无图为无操作） */
  deleteColLeftOfImage(): void
  /** 当前状态（图坐标 + fit；页面状态行展示） */
  getState(): EmbedDemoState
}

function mountEmbedDemo(section: HTMLElement): EmbedDemo {
  const container = document.createElement('div')
  container.className = 'table-mount'
  container.style.width = '700px'
  container.style.height = '434px'
  section.appendChild(container)

  const sheet = new Sheet('embed-demo')
  // 行标签（第 0 列）：插入/删除行后随数据平移，与嵌入图同向移动可对照
  for (let row = 0; row < EMBED_ROWS; row++) {
    sheet.setCellValue({ row, col: 0 }, `第 ${row} 行`)
  }
  sheet.setCellImage(EMBED_IMAGE_START, { src: EMBED_IMAGE_SRC, fit: 'contain' })

  const grid = new SheetGrid({
    container,
    sheet,
    rows: EMBED_ROWS,
    cols: EMBED_COLS,
    width: 700,
    height: 434,
    // 固定网格：插入行不触发动机扩容，平移观察范围可控
    growOnScroll: false,
  })

  /** 按格查询 API 扫描定位嵌入图（ultra-ui 判定「该格有嵌入图」的同一通道） */
  const findImage = (): { row: number; col: number } | null => {
    const rowCap = Math.min(sheet.rows, EMBED_SCAN_ROW_CAP)
    const colCap = Math.min(sheet.cols, EMBED_SCAN_ROW_CAP)
    for (let row = 0; row < rowCap; row++) {
      for (let col = 0; col < colCap; col++) {
        if (sheet.hasCellImage({ row, col })) return { row, col }
      }
    }
    return null
  }
  const currentFit = (): ImageFitMode => {
    const at = findImage()
    return (at && sheet.getCellImage(at)?.fit) || 'contain'
  }

  return {
    container,
    grid,
    sheet,
    toggleImage: () => {
      const at = findImage()
      if (at) {
        sheet.setCellImage(at, null)
        return
      }
      sheet.setCellImage(EMBED_IMAGE_START, { src: EMBED_IMAGE_SRC, fit: currentFit() })
    },
    setFit: (fit) => {
      const at = findImage()
      if (at) sheet.setCellImage(at, { src: EMBED_IMAGE_SRC, fit })
    },
    insertRowAboveImage: () => {
      const at = findImage()
      if (at) sheet.insertRows(at.row, 1)
    },
    deleteRowAboveImage: () => {
      const at = findImage()
      if (at && at.row > 0) sheet.deleteRows(at.row - 1, 1)
    },
    insertColLeftOfImage: () => {
      const at = findImage()
      if (at) sheet.insertCols(at.col, 1)
    },
    deleteColLeftOfImage: () => {
      const at = findImage()
      if (at && at.col > 0) sheet.deleteCols(at.col - 1, 1)
    },
    getState: () => ({ image: findImage(), fit: currentFit() }),
  }
}

// ---- ③ 浮动图片右键不穿透（Sheet 模型浮动图 + 引擎浮动层优先路由） ----

const FLOAT_MENU_ROWS = 10
const FLOAT_MENU_COLS = 6
/** 浮动图源（内联 SVG data URL）：与嵌入图区分配色的示意图片 */
const FLOAT_MENU_SRC = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="96" viewBox="0 0 160 96">' +
    '<rect width="160" height="96" fill="#fef3c7" stroke="#d97706" stroke-width="2"/>' +
    '<path d="M16 72 C48 12, 96 108, 144 32" fill="none" stroke="#d97706" stroke-width="3"/>' +
    '<text x="12" y="20" font-size="12" fill="#92400e">float-image</text>' +
    '</svg>',
)}`

export interface FloatMenuDemo {
  container: HTMLElement
  grid: SheetGrid
  /** 浮动图模型 id（右键事件载荷对照用） */
  getImageId(): string
}

function mountFloatMenuDemo(section: HTMLElement): FloatMenuDemo {
  const container = document.createElement('div')
  container.className = 'table-mount'
  container.style.width = '540px'
  container.style.height = '322px'
  section.appendChild(container)

  const sheet = new Sheet('float-menu-demo')
  for (let row = 0; row < FLOAT_MENU_ROWS; row++) {
    sheet.setCellValue({ row, col: 0 }, `第 ${row} 行`)
    sheet.setCellValue({ row, col: 4 }, `值-${row}`)
  }
  // 浮动图锚定 (1,2)~(3,4)：与普通格对照，右键图上出浮动对象事件、格上出单元格事件
  const imageId = sheet.insertImage({
    data: new Uint8Array(0),
    type: 'svg',
    src: FLOAT_MENU_SRC,
    anchor: {
      from: { col: 1, row: 2, offsetX: 8, offsetY: 8 },
      to: { col: 3, row: 5 },
    },
    title: '浮动图片（右键我）',
  })

  const grid = new SheetGrid({
    container,
    sheet,
    rows: FLOAT_MENU_ROWS,
    cols: FLOAT_MENU_COLS,
    width: 540,
    height: 322,
    growOnScroll: false,
  })

  return { container, grid, getImageId: () => imageId }
}

// ---- 演示区装配 ----

export interface HyperlinkImageDemo {
  link: LinkDemo
  embed: EmbedDemo
  floatMenu: FloatMenuDemo
}

export function mountHyperlinkImage(root: HTMLElement): HyperlinkImageDemo {
  const section = document.createElement('section')
  root.appendChild(section)
  /** 组内子场景标题（样式由 global.css 的 section h3 规则承担） */
  const addHeading = (text: string): void => {
    const heading = document.createElement('h3')
    heading.textContent = text
    section.appendChild(heading)
  }

  addHeading('单元格超链接（悬停手型 / 单击宿主接管）')
  const link = mountLinkDemo(section)

  addHeading('图片嵌入单元格（contain/fill 缩放 · 随行列平移）')
  const embed = mountEmbedDemo(section)

  addHeading('浮动图片右键（不穿透单元格）')
  const floatMenu = mountFloatMenuDemo(section)

  return { link, embed, floatMenu }
}
