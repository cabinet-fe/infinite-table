// 样式工具栏（对标 ultra-ui sheet-toolbar）：图标按钮 + 分组分隔线 + 弹层面板。
// 组序：历史（撤销/重做）| 单元格（边框/填充色/合并/拆分）| 文本（粗斜下删/字色/字号/六向对齐/换行）
//      | 编辑（查找/函数）| 插入（图片）| 文件（导入/导出）。
// 写路径统一走 Store 格级样式 + resolveCellStyle hook + batchUpdate 收敛刷新。

import { normalizeRange, type CellStyle, type ListTable } from '@infinite-table/core'

import type { SheetStore, UndoStack } from '@infinite-table/plugins'

import { FUNCTION_CATEGORIES, SHEET_FUNCTIONS } from './functions'
import { createFindReplace, type FindReplaceHandle } from './find-replace'
import { icon } from './icons'
import { closeActivePopup, isPopupAnchoredTo, openAnchoredPopup } from './popup'
import { mergeBounds, unmergeAt } from './ops'
import type { SheetBookBundle } from './book'
import type { CSVHandle } from './csv'

/** 填充/字色共用色板（7 列 × 5 行） */
const PALETTE: readonly string[] = [
  '#000000',
  '#7f7f7f',
  '#880015',
  '#ed1c24',
  '#ff7f27',
  '#fff200',
  '#22b14c',
  '#00a2e8',
  '#3f48cc',
  '#a349a4',
  '#ffffff',
  '#c3c3c3',
  '#b97a57',
  '#ffc000',
  '#92d050',
  '#00b050',
  '#00b0f0',
  '#0070c0',
  '#002060',
  '#7030a0',
  '#f2dcdb',
  '#e5e0ec',
  '#d8e4bc',
  '#dbe5f1',
  '#fde9d9',
  '#f2f2f2',
  '#bfbfbf',
  '#595959',
  '#404040',
  '#5b9bd5',
  '#ed7d31',
  '#a5a5a5',
  '#4472c4',
  '#70ad47',
  '#264478',
]

/** 字号档位（pt 标注语义，落 Store 为 fontSize 像素数值） */
const FONT_SIZES = [9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32] as const

/** 边框线型（宽度和线型映射到 CellBorder 边） */
const LINE_STYLES = [
  { id: 'thin', label: '细线', width: 1, style: 'solid' },
  { id: 'medium', label: '中粗线', width: 2, style: 'solid' },
  { id: 'thick', label: '粗线', width: 3, style: 'solid' },
  { id: 'dashed', label: '虚线', width: 1, style: 'dashed' },
  { id: 'dotted', label: '点线', width: 1, style: 'dotted' },
] as const

type BorderEdge = { width: number; color: string; style: 'solid' | 'dashed' | 'dotted' }
type CellEdges = { top?: BorderEdge; right?: BorderEdge; bottom?: BorderEdge; left?: BorderEdge }

/** 样式 key → 工具栏提示用中文名 */
const STYLE_LABELS: Record<string, string> = {
  fontWeight: '加粗',
  fontStyle: '斜体',
  underline: '下划线',
  lineThrough: '删除线',
  textAlign: '对齐',
  verticalAlign: '垂直对齐',
  background: '填充色',
  color: '字体颜色',
  fontSize: '字号',
  border: '边框',
  textWrap: '自动换行',
}

export interface ToolbarDeps {
  table: () => ListTable
  store: () => SheetStore
  notify: (text: string, kind?: 'info' | 'warn') => void
  /** 撤销栈（历史组按钮 + Ctrl+Z/Y） */
  stack: UndoStack
  bundle: SheetBookBundle
  csv: CSVHandle
  /** 公式栏（函数面板插入落点） */
  formulaBar: { insertSnippet: (snippet: string) => void }
}

export interface ToolbarHandle {
  /** 编程式样式应用（冒烟驱动用）：对当前选区逐格套用片段 */
  applyFragment(fragment: CellStyle, mode: 'toggle' | 'set'): void
  /** 清除当前选区格式 */
  clearFormat(): void
  /** 查找替换面板句柄 */
  find: FindReplaceHandle
  /** Ctrl/Cmd+F 入口：锚定查找按钮切换面板 */
  toggleFind(): void
  /** 刷新按钮态（选区/值变化后由监听方调用） */
  refreshStates(): void
  destroy(): void
}

export function mountToolbar(area: HTMLElement, deps: ToolbarDeps): ToolbarHandle {
  const bar = document.createElement('div')
  bar.className = 'sheet-app__toolbar'
  // 溢出滚动（对标 ultra-ui）：两端箭头按需显示，滚动条隐藏，滚轮转横滚
  const navPrev = document.createElement('button')
  navPrev.type = 'button'
  navPrev.className = 'sheet-toolbar__nav is-prev'
  navPrev.title = '向左'
  navPrev.innerHTML = icon('arrowLeft')
  const navNext = document.createElement('button')
  navNext.type = 'button'
  navNext.className = 'sheet-toolbar__nav is-next'
  navNext.title = '向右'
  navNext.innerHTML = icon('arrowRight')
  const scroll = document.createElement('div')
  scroll.className = 'sheet-toolbar__scroll'
  const list = document.createElement('div')
  list.className = 'sheet-toolbar__list'
  scroll.appendChild(list)
  bar.append(navPrev, scroll, navNext)
  area.appendChild(bar)

  const refreshNav = (): void => {
    const overflow = scroll.scrollWidth > scroll.clientWidth + 1
    navPrev.style.display = overflow ? '' : 'none'
    navNext.style.display = overflow ? '' : 'none'
  }
  const step = (direction: 1 | -1): void => {
    scroll.scrollBy({ left: direction * scroll.clientWidth * 0.8, behavior: 'smooth' })
  }
  navPrev.addEventListener('click', () => step(-1))
  navNext.addEventListener('click', () => step(1))
  scroll.addEventListener(
    'wheel',
    (event) => {
      if (event.deltaY !== 0 && scroll.scrollWidth > scroll.clientWidth) {
        event.preventDefault()
        scroll.scrollLeft += event.deltaY
      }
    },
    { passive: false },
  )
  const observer = new ResizeObserver(() => refreshNav())
  observer.observe(scroll)
  window.setTimeout(refreshNav, 0)

  const tools = new Map<string, HTMLButtonElement>()
  let floatSeq = 0

  const selectionBounds = () => {
    const range = deps.table().getSelectedCellRanges()[0]
    return range ? normalizeRange(range) : null
  }

  /** 当前焦点格（选区首段锚点） */
  const focusCell = (): { col: number; row: number } | null => {
    const bounds = selectionBounds()
    return bounds ? { col: bounds.minCol, row: bounds.minRow } : null
  }

  const refreshSelection = (bounds: {
    minCol: number
    maxCol: number
    minRow: number
    maxRow: number
  }): void => {
    deps.table().batchUpdate(() => {
      for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
        for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
          deps.table().refreshCell(col, row)
        }
      }
    })
  }

  /** 值相等判定：对象值（如 border）按结构比较（toggle 判定不依赖引用） */
  const sameValue = (a: unknown, b: unknown): boolean => {
    if (a === b) {
      return true
    }
    if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
      return JSON.stringify(a) === JSON.stringify(b)
    }
    return false
  }

  /** 对选区逐格套用片段：mode=toggle 时若选区内全部已含同值属性则移除 */
  const applyFragment = (fragment: CellStyle, mode: 'toggle' | 'set'): void => {
    const bounds = selectionBounds()
    if (!bounds) {
      deps.notify('无选区', 'warn')
      return
    }
    const key = Object.keys(fragment)[0]!
    const store = deps.store()
    let allMatch = mode === 'toggle'
    if (mode === 'toggle') {
      outer: for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
        for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
          const style = store.getStyle(col, row) as Record<string, unknown> | undefined
          if (!style || !sameValue(style[key], fragment[key as keyof CellStyle])) {
            allMatch = false
            break outer
          }
        }
      }
    }
    const removing = mode === 'toggle' && allMatch
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        const base = { ...store.getStyle(col, row) } as Record<string, unknown>
        if (removing) {
          delete base[key]
        } else {
          Object.assign(base, fragment)
        }
        if (Object.keys(base).length === 0) {
          store.clearStyle(col, row)
        } else {
          store.setStyle(col, row, base as CellStyle)
        }
      }
    }
    refreshSelection(bounds)
    deps.notify(`${removing ? '已取消' : '已应用'}${STYLE_LABELS[key] ?? key}`)
    refreshStates()
  }

  /** 移除选区样式的指定键（无填充/自动字色等「清除」语义） */
  const applyRemoveKeys = (keys: string[]): void => {
    const bounds = selectionBounds()
    if (!bounds) {
      deps.notify('无选区', 'warn')
      return
    }
    const store = deps.store()
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        const base = { ...store.getStyle(col, row) } as Record<string, unknown>
        for (const key of keys) {
          delete base[key]
        }
        if (Object.keys(base).length === 0) {
          store.clearStyle(col, row)
        } else {
          store.setStyle(col, row, base as CellStyle)
        }
      }
    }
    refreshSelection(bounds)
    refreshStates()
  }

  /** 边框预设：按格在选区内的位置生成四边 */
  const edgesForPreset = (
    preset: string,
    col: number,
    row: number,
    bounds: { minCol: number; maxCol: number; minRow: number; maxRow: number },
    edge: BorderEdge,
  ): CellEdges => {
    const atTop = row === bounds.minRow
    const atBottom = row === bounds.maxRow
    const atLeft = col === bounds.minCol
    const atRight = col === bounds.maxCol
    switch (preset) {
      case 'all':
        return { top: edge, right: edge, bottom: edge, left: edge }
      case 'outer':
        return {
          top: atTop ? edge : undefined,
          right: atRight ? edge : undefined,
          bottom: atBottom ? edge : undefined,
          left: atLeft ? edge : undefined,
        }
      case 'inner':
        return {
          top: atTop ? undefined : edge,
          right: atRight ? undefined : edge,
          bottom: atBottom ? undefined : edge,
          left: atLeft ? undefined : edge,
        }
      case 'top':
        return atTop ? { top: edge } : {}
      case 'bottom':
        return atBottom ? { bottom: edge } : {}
      case 'left':
        return atLeft ? { left: edge } : {}
      case 'right':
        return atRight ? { right: edge } : {}
      default:
        return {}
    }
  }

  /** 边框预设写入选区（none 清除边框键） */
  const applyBorderPreset = (preset: string, edge: BorderEdge): void => {
    const bounds = selectionBounds()
    if (!bounds) {
      deps.notify('无选区', 'warn')
      return
    }
    const store = deps.store()
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        const base = { ...store.getStyle(col, row) } as Record<string, unknown>
        if (preset === 'none') {
          delete base.border
        } else {
          base.border = edgesForPreset(preset, col, row, bounds, edge)
        }
        if (Object.keys(base).length === 0) {
          store.clearStyle(col, row)
        } else {
          store.setStyle(col, row, base as CellStyle)
        }
      }
    }
    refreshSelection(bounds)
    deps.notify(preset === 'none' ? '已清除边框' : '已应用边框')
  }

  const clearFormat = (): void => {
    const bounds = selectionBounds()
    if (!bounds) {
      deps.notify('无选区', 'warn')
      return
    }
    const store = deps.store()
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        store.clearStyle(col, row)
      }
    }
    refreshSelection(bounds)
    deps.notify('已清除选区格式')
    refreshStates()
  }

  /** 浮动图片插入（锚定焦点格，跨 2×2 格） */
  const insertFloatImage = (src: string): void => {
    const focus = focusCell()
    const col = focus?.col ?? 0
    const row = focus?.row ?? 0
    floatSeq += 1
    deps.table().floatObjects.add({
      id: `sheet-float-${floatSeq}`,
      kind: 'image',
      anchor: { from: { col, row }, to: { col: col + 2, row: row + 2 }, offsetX: 2, offsetY: 2 },
      src,
      title: '插入图片',
    })
    deps.notify('已插入图片')
  }

  // ---- 按钮装配 ----

  const addDivider = (): void => {
    const divider = document.createElement('span')
    divider.className = 'sheet-toolbar-divider'
    list.appendChild(divider)
  }

  const addTool = (options: {
    id: string
    title: string
    iconId: string
    onClick?: (button: HTMLButtonElement) => void
    popup?: (el: HTMLElement, close: () => void, button: HTMLButtonElement) => void
    colorBar?: boolean
  }): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'sheet-tool'
    button.title = options.title
    button.setAttribute('aria-label', options.title)
    button.innerHTML = icon(options.iconId)
    if (options.colorBar) {
      const bar2 = document.createElement('span')
      bar2.className = 'sheet-tool__color-bar'
      bar2.style.background = '#ed1c24'
      button.appendChild(bar2)
    }
    if (options.popup) {
      button.addEventListener('click', () => {
        // 同按钮再点 = 关闭（ultra-ui 语义）
        if (isPopupAnchoredTo(button)) {
          closeActivePopup()
          return
        }
        openAnchoredPopup(button, {
          build: (el, close) => options.popup?.(el, close, button),
          // 挂载后聚焦面板首个输入（build 阶段元素未入 DOM，focus 会被吞）
          onOpened: (el) => el.querySelector<HTMLInputElement>('input')?.focus(),
        })
      })
    } else if (options.onClick) {
      button.addEventListener('click', () => options.onClick?.(button))
    }
    list.appendChild(button)
    tools.set(options.id, button)
    return button
  }

  // ---- 弹层面板构建 ----

  const buildSwatchGrid = (
    onPick: (color: string) => void,
    activeColor?: () => string | null,
  ): HTMLElement => {
    const grid = document.createElement('div')
    grid.className = 'sheet-palette'
    for (const color of PALETTE) {
      const swatch = document.createElement('button')
      swatch.type = 'button'
      swatch.className = 'sheet-palette__swatch'
      swatch.style.background = color
      swatch.title = color
      if (activeColor && activeColor() === color) {
        swatch.classList.add('is-active')
      }
      swatch.addEventListener('click', () => onPick(color))
      grid.appendChild(swatch)
    }
    return grid
  }

  const fillColorPopup = (el: HTMLElement, close: () => void): void => {
    el.classList.add('sheet-popup')
    el.appendChild(
      buildSwatchGrid(
        (color) => {
          applyFragment({ background: color }, 'set')
          close()
        },
        () => focusCellStyle()?.background ?? null,
      ),
    )
    const clear = document.createElement('button')
    clear.type = 'button'
    clear.className = 'sheet-popup__action'
    clear.textContent = '无填充'
    clear.addEventListener('click', () => {
      applyRemoveKeys(['background'])
      close()
    })
    el.appendChild(clear)
  }

  const fontColorPopup = (el: HTMLElement, close: () => void, button: HTMLButtonElement): void => {
    el.classList.add('sheet-popup')
    el.appendChild(
      buildSwatchGrid(
        (color) => {
          applyFragment({ color }, 'set')
          const bar3 = button.querySelector('.sheet-tool__color-bar')
          if (bar3 instanceof HTMLElement) {
            bar3.style.background = color
          }
          close()
        },
        () => focusCellStyle()?.color ?? null,
      ),
    )
    const auto = document.createElement('button')
    auto.type = 'button'
    auto.className = 'sheet-popup__action'
    auto.textContent = '自动'
    auto.addEventListener('click', () => {
      applyRemoveKeys(['color'])
      close()
    })
    el.appendChild(auto)
  }

  const fontSizePopup = (el: HTMLElement, close: () => void): void => {
    el.classList.add('sheet-popup', 'sheet-popup--size')
    const current = focusCellStyle()?.fontSize
    const list = document.createElement('div')
    list.className = 'sheet-size-list'
    for (const size of FONT_SIZES) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'sheet-size-item'
      item.textContent = String(size)
      if (current === size) {
        item.classList.add('is-active')
      }
      item.addEventListener('click', () => {
        applyFragment({ fontSize: size }, 'set')
        close()
      })
      list.appendChild(item)
    }
    el.appendChild(list)
  }

  const borderGlyph = (preset: string): string => {
    const on = 'currentColor'
    const off = '#d4d4d8'
    const v = (color: string) => `<path d="M8 2v12" stroke="${color}"/>`
    const h = (color: string) => `<path d="M2 8h12" stroke="${color}"/>`
    const rect = (color: string) =>
      `<rect x="2" y="2" width="12" height="12" rx="1" stroke="${color}"/>`
    switch (preset) {
      case 'outer':
        return rect(on) + v(off) + h(off)
      case 'inner':
        return rect(off) + v(on) + h(on)
      case 'all':
        return rect(on) + v(on) + h(on)
      case 'top':
        return rect(off) + h(on)
      case 'bottom':
        return rect(off) + `<path d="M2 14h12" stroke="${on}"/>`
      case 'left':
        return rect(off) + v(on)
      case 'right':
        return rect(off) + `<path d="M14 2v12" stroke="${on}"/>`
      default:
        return rect(off) + v(off) + h(off)
    }
  }

  const borderPopup = (el: HTMLElement, close: () => void): void => {
    el.classList.add('sheet-popup', 'sheet-popup--border')
    const selected: { line: (typeof LINE_STYLES)[number]; color: string } = {
      line: LINE_STYLES[0]!,
      color: '#000000',
    }

    const row1 = document.createElement('div')
    row1.className = 'sheet-popup__row'
    const label1 = document.createElement('span')
    label1.className = 'sheet-popup__label'
    label1.textContent = '线型'
    const lineGroup = document.createElement('div')
    lineGroup.className = 'sheet-popup__lines'
    const lineButtons: HTMLButtonElement[] = []
    for (const line of LINE_STYLES) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'sheet-popup__line'
      button.title = line.label
      const swatch = document.createElement('span')
      swatch.className = 'sheet-popup__line-swatch'
      swatch.style.borderBottom = `${line.width}px ${line.style} ${selected.color}`
      if (line.style === 'dashed') {
        swatch.style.borderBottomStyle = 'dashed'
      }
      button.appendChild(swatch)
      if (line === selected.line) {
        button.classList.add('is-active')
      }
      button.addEventListener('click', () => {
        selected.line = line
        lineButtons.forEach((b) => b.classList.toggle('is-active', b === button))
      })
      lineButtons.push(button)
      lineGroup.appendChild(button)
    }
    row1.append(label1, lineGroup)

    const row2 = document.createElement('div')
    row2.className = 'sheet-popup__row'
    const label2 = document.createElement('span')
    label2.className = 'sheet-popup__label'
    label2.textContent = '颜色'
    const palette = buildSwatchGrid((color) => {
      selected.color = color
      lineButtons.forEach((b, i) => {
        const swatch = b.firstElementChild
        if (swatch instanceof HTMLElement) {
          const line = LINE_STYLES[i]!
          swatch.style.borderBottom = `${line.width}px ${line.style} ${color}`
        }
      })
    })
    palette.classList.add('sheet-palette--compact')
    row2.append(label2, palette)

    const row3 = document.createElement('div')
    row3.className = 'sheet-popup__row'
    const label3 = document.createElement('span')
    label3.className = 'sheet-popup__label'
    label3.textContent = '预设'
    const presets = document.createElement('div')
    presets.className = 'sheet-popup__presets'
    const PRESET_ITEMS = [
      ['outer', '外边框'],
      ['inner', '内边框'],
      ['all', '所有边框'],
      ['top', '上边框'],
      ['bottom', '下边框'],
      ['left', '左边框'],
      ['right', '右边框'],
      ['none', '无边框'],
    ] as const
    for (const [preset, title] of PRESET_ITEMS) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'sheet-popup__preset'
      button.title = title
      button.innerHTML =
        `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke-width="1.5" ` +
        `stroke-linecap="square">${borderGlyph(preset)}</svg>`
      button.addEventListener('click', () => {
        applyBorderPreset(preset, {
          width: selected.line.width,
          color: selected.color,
          style: selected.line.style,
        })
        close()
      })
      presets.appendChild(button)
    }
    row3.append(label3, presets)
    el.append(row1, row2, row3)
  }

  const functionsPopup = (el: HTMLElement, close: () => void): void => {
    el.classList.add('sheet-popup', 'sheet-popup--functions')
    const nav = document.createElement('div')
    nav.className = 'sheet-functions__nav'
    const search = document.createElement('input')
    search.type = 'text'
    search.className = 'sheet-functions__search'
    search.placeholder = '搜索函数名或描述'
    const list = document.createElement('div')
    list.className = 'sheet-functions__list'
    let category: string = FUNCTION_CATEGORIES[0]
    let keyword = ''

    const insert = (name: string): void => {
      deps.formulaBar.insertSnippet(`=${name}(`)
      close()
    }

    const renderList = (): void => {
      list.textContent = ''
      const items = SHEET_FUNCTIONS.filter((fn) => {
        if (category === '常用' && !fn.common) {
          return false
        }
        if (keyword && !`${fn.name} ${fn.description}`.toLowerCase().includes(keyword)) {
          return false
        }
        return true
      })
      if (items.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'sheet-functions__empty'
        empty.textContent = '无匹配函数'
        list.appendChild(empty)
        return
      }
      for (const fn of items) {
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'sheet-functions__item'
        const signature = document.createElement('div')
        signature.className = 'sheet-functions__signature'
        signature.textContent = fn.signature
        const description = document.createElement('div')
        description.className = 'sheet-functions__description'
        description.textContent = fn.description
        item.append(signature, description)
        item.addEventListener('click', () => insert(fn.name))
        list.appendChild(item)
      }
    }

    for (const name of FUNCTION_CATEGORIES) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'sheet-functions__nav-item'
      item.textContent = name
      if (name === category) {
        item.classList.add('is-active')
      }
      item.addEventListener('click', () => {
        category = name
        for (const child of nav.children) {
          child.classList.toggle('is-active', child === item)
        }
        renderList()
      })
      nav.appendChild(item)
    }
    search.addEventListener('input', () => {
      keyword = search.value.trim().toLowerCase()
      renderList()
    })
    el.append(nav, search, list)
    renderList()
  }

  const insertImagePopup = (el: HTMLElement, close: () => void): void => {
    el.classList.add('sheet-popup', 'sheet-popup--image')
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = 'image/png,image/jpeg,image/gif,image/svg+xml,image/webp'
    fileInput.style.display = 'none'
    const picker = document.createElement('button')
    picker.type = 'button'
    picker.className = 'sheet-image-picker'
    const pickerMain = document.createElement('span')
    pickerMain.textContent = '选择图片文件'
    const pickerSub = document.createElement('span')
    pickerSub.className = 'sheet-image-picker__sub'
    pickerSub.textContent = '支持 png / jpeg / gif / svg / webp'
    picker.append(pickerMain, pickerSub)
    picker.addEventListener('click', () => fileInput.click())
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0]
      if (!file) {
        return
      }
      insertFloatImage(await fileToDataURL(file))
      close()
    })

    const urlRow = document.createElement('div')
    urlRow.className = 'sheet-popup__row'
    const urlInput = document.createElement('input')
    urlInput.type = 'text'
    urlInput.className = 'sheet-find__input'
    urlInput.placeholder = '输入图片 URL'
    const insertButton = document.createElement('button')
    insertButton.type = 'button'
    insertButton.className = 'sheet-popup__action is-primary'
    insertButton.textContent = '插入'
    insertButton.addEventListener('click', () => {
      if (!urlInput.value.trim()) {
        return
      }
      insertFloatImage(urlInput.value.trim())
      close()
    })
    urlRow.append(urlInput, insertButton)
    el.append(fileInput, picker, urlRow)
  }

  const exportPopup = (el: HTMLElement, close: () => void): void => {
    el.classList.add('sheet-popup', 'sheet-popup--export')
    const xlsx = document.createElement('button')
    xlsx.type = 'button'
    xlsx.className = 'sheet-export-item'
    xlsx.textContent = '导出 Excel (.xlsx)'
    xlsx.disabled = true
    xlsx.title = '演示面未实现 xlsx 导出'
    const csvItem = document.createElement('button')
    csvItem.type = 'button'
    csvItem.className = 'sheet-export-item'
    csvItem.textContent = '导出 CSV (.csv)'
    csvItem.addEventListener('click', () => {
      const csv = deps.csv.exportCurrent()
      deps.notify(`已导出 CSV（${csv.split('\n').length} 行）`)
      close()
    })
    el.append(xlsx, csvItem)
  }

  // ---- 组装：组分隔 + 按钮 ----

  // 历史
  addTool({
    id: 'undo',
    title: '撤销（Ctrl/Cmd+Z）',
    iconId: 'undo',
    onClick: () => {
      deps.stack.undo()
      deps.notify('已撤销')
      refreshStates()
    },
  })
  addTool({
    id: 'redo',
    title: '重做（Ctrl/Cmd+Shift+Z 或 Ctrl+Y）',
    iconId: 'redo',
    onClick: () => {
      deps.stack.redo()
      deps.notify('已重做')
      refreshStates()
    },
  })

  // 单元格
  addDivider()
  addTool({ id: 'border', title: '设置单元格边框', iconId: 'border', popup: borderPopup })
  addTool({ id: 'fill-color', title: '设置单元格背景填充', iconId: 'fill', popup: fillColorPopup })
  addTool({
    id: 'merge',
    title: '合并选中区域',
    iconId: 'merge',
    onClick: () => {
      const bounds = selectionBounds()
      if (!bounds || (bounds.minCol === bounds.maxCol && bounds.minRow === bounds.maxRow)) {
        deps.notify('请先选择多格区域', 'warn')
        return
      }
      const table = deps.table()
      try {
        table.setMergeCells([...deps.store().getMerges(), mergeBounds(bounds)])
        deps.store().setMerges([...deps.store().getMerges(), mergeBounds(bounds)])
        deps.notify('已合并选区')
      } catch (error) {
        deps.notify(`已拒绝：${(error as Error).message}`, 'warn')
      }
    },
  })
  addTool({
    id: 'unmerge',
    title: '取消活动格所在合并',
    iconId: 'unmerge',
    onClick: () => {
      const bounds = selectionBounds()
      if (!bounds) {
        return
      }
      const kept = unmergeAt(deps.store(), bounds)
      deps.table().setMergeCells([...kept])
      deps.notify('已取消合并')
    },
  })

  // 文本
  addDivider()
  addTool({
    id: 'bold',
    title: '加粗',
    iconId: 'bold',
    onClick: () => applyFragment({ fontWeight: 700 }, 'toggle'),
  })
  addTool({
    id: 'italic',
    title: '斜体',
    iconId: 'italic',
    onClick: () => applyFragment({ fontStyle: 'italic' }, 'toggle'),
  })
  addTool({
    id: 'underline',
    title: '下划线',
    iconId: 'underline',
    onClick: () => applyFragment({ underline: true }, 'toggle'),
  })
  addTool({
    id: 'strikethrough',
    title: '删除线',
    iconId: 'strikethrough',
    onClick: () => applyFragment({ lineThrough: true }, 'toggle'),
  })
  addTool({
    id: 'font-color',
    title: '设置字体颜色',
    iconId: 'font-color',
    popup: fontColorPopup,
    colorBar: true,
  })
  addTool({ id: 'font-size', title: '设置字体大小', iconId: 'font-size', popup: fontSizePopup })
  addTool({
    id: 'align-left',
    title: '水平左对齐',
    iconId: 'align-left',
    onClick: () => applyFragment({ textAlign: 'left' }, 'set'),
  })
  addTool({
    id: 'align-center',
    title: '水平居中',
    iconId: 'align-center',
    onClick: () => applyFragment({ textAlign: 'center' }, 'set'),
  })
  addTool({
    id: 'align-right',
    title: '水平右对齐',
    iconId: 'align-right',
    onClick: () => applyFragment({ textAlign: 'right' }, 'set'),
  })
  addTool({
    id: 'valign-top',
    title: '垂直顶端对齐',
    iconId: 'valign-top',
    onClick: () => applyFragment({ verticalAlign: 'top' }, 'set'),
  })
  addTool({
    id: 'valign-middle',
    title: '垂直居中对齐',
    iconId: 'valign-middle',
    onClick: () => applyFragment({ verticalAlign: 'middle' }, 'set'),
  })
  addTool({
    id: 'valign-bottom',
    title: '垂直底端对齐',
    iconId: 'valign-bottom',
    onClick: () => applyFragment({ verticalAlign: 'bottom' }, 'set'),
  })
  addTool({
    id: 'wrap-text',
    title: '自动换行',
    iconId: 'wrap',
    onClick: () => applyFragment({ textWrap: true }, 'toggle'),
  })

  // 编辑
  addDivider()
  const find = createFindReplace(deps)
  const findButton = addTool({
    id: 'find',
    title: '查找与替换（Ctrl/Cmd+F）',
    iconId: 'search',
    onClick: (button) => find.toggleAt(button),
  })
  addTool({
    id: 'functions',
    title: '按分类浏览并插入函数',
    iconId: 'functions',
    popup: functionsPopup,
  })

  // 插入
  addDivider()
  addTool({ id: 'insert-image', title: '插入浮动图片', iconId: 'image', popup: insertImagePopup })

  // 文件
  addDivider()
  addTool({
    id: 'import',
    title: '从 .csv 文件导入',
    iconId: 'import',
    onClick: () => deps.csv.openPicker(),
  })
  addTool({ id: 'export', title: '导出为 Excel 或 CSV', iconId: 'export', popup: exportPopup })

  // ---- 按钮态刷新（随活跃实例切换重绑） ----

  const focusCellStyle = (): CellStyle | undefined => {
    const focus = focusCell()
    return focus ? deps.store().getStyle(focus.col, focus.row) : undefined
  }

  const bindings: Array<() => void> = []
  let boundTable: ListTable | null = null

  const refreshStates = (): void => {
    const style = focusCellStyle()
    const active = (id: string, on: boolean): void => {
      tools.get(id)?.classList.toggle('is-active', on)
    }
    active('bold', style?.fontWeight === 700 || style?.fontWeight === 'bold')
    active('italic', style?.fontStyle === 'italic')
    active('underline', style?.underline === true)
    active('strikethrough', style?.lineThrough === true)
    active('wrap-text', style?.textWrap === true)
    const align = style?.textAlign ?? 'left'
    active('align-left', align === 'left')
    active('align-center', align === 'center')
    active('align-right', align === 'right')
    const valign = style?.verticalAlign ?? 'middle'
    active('valign-top', valign === 'top')
    active('valign-middle', valign === 'middle')
    active('valign-bottom', valign === 'bottom')
    tools.get('undo')?.toggleAttribute('disabled', !deps.stack.canUndo)
    tools.get('redo')?.toggleAttribute('disabled', !deps.stack.canRedo)
  }

  const bindTo = (table: ListTable): void => {
    if (table === boundTable) {
      return
    }
    for (const off of bindings.splice(0)) {
      off()
    }
    bindings.push(
      table.onSelectionChange(() => refreshStates()),
      table.onCellChange(() => refreshStates()),
    )
    boundTable = table
    refreshStates()
  }
  bindTo(deps.table())
  const offBookChange = deps.bundle.book.onChange((event) => {
    if (event.table) {
      bindTo(event.table)
    }
  })

  return {
    applyFragment,
    clearFormat,
    find,
    toggleFind: () => find.toggleAt(findButton),
    refreshStates,
    destroy() {
      offBookChange()
      observer.disconnect()
      for (const off of bindings.splice(0)) {
        off()
      }
      find.destroy()
      bar.remove()
    },
  }
}

async function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('读取文件失败')))
    reader.readAsDataURL(file)
  })
}
