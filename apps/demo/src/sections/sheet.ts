// sheet 电子表格演示区：对齐 ultra-ui sheet 示例的演示意图，用本仓内核能力复刻——
// 结构化样式矩阵（主题分区 token → 列级 → 按格 hook 三级覆盖链）、\n 多行文本、合并区、
// 格内示例图、填充柄演示（预置序列与文本值供拖拽，生成算法不在内核）、
// 运行时冻结数与合并区切换控件、editCellOnEnter 开关（Enter 进入编辑）。

import {
  EditorRegistry,
  SheetModel,
  normalizeRange,
  type CellStyle,
  type ListTable,
  type RangeBounds,
  type SelectionRange,
  type ThemeOverride,
} from '@infinite-table/core'

import {
  addButton,
  addStatus,
  createSection,
  demoLoadImage,
  mountTable,
  type DemoMount,
} from '../mount'

/** 数据列数（A~H 列头）与行数 */
export const SHEET_COL_COUNT = 8
export const SHEET_ROW_COUNT = 40

/**
 * 初始合并区（C12:E13 主格含 \n 多行文本）。
 * 起始列取 2：冻结列数在 0/1/2 挡位切换时均不跨冻结边界（运行时校验会拒绝跨界合并）。
 */
export const SHEET_MERGE_RANGE = { startCol: 2, startRow: 11, endCol: 4, endRow: 12 } as const
/** 运行时切换时追加的合并区（G16:H17） */
export const SHEET_MERGE_EXTRA_RANGE = { startCol: 5, startRow: 15, endCol: 6, endRow: 16 } as const
/** 填充柄预置选区（B16:C18：数字序列 1/2/3 + 文本 tile a/b） */
export const SHEET_FILL_SELECTION = [
  { start: { col: 1, row: 15 }, end: { col: 2, row: 17 } },
] as const
/** 格内示例图所在格（F1） */
export const SHEET_IMAGE_CELL = { col: 5, row: 0 } as const

/** 主题分区 token 演示：列头居中（行号列沿用 header 分区）+ 数据格基础字色 */
const SHEET_THEME: ThemeOverride = {
  header: { textAlign: 'center' },
  body: { color: '#334155' },
}

/** 列级样式演示：A 列行标签（覆盖主题分区 token，被按格 hook 覆盖） */
const LABEL_COLUMN_STYLE: CellStyle = { fontWeight: 600, color: '#646a73' }

/** 内边距演示格底色（让内缩观感可见） */
const PADDING_BACKGROUND = '#eef2ff'
/** 边框线型演示色 */
const BORDER_DEMO_COLOR = '#2563eb'
/** 溢出演示共用长文本（超出 104px 列宽） */
const OVERFLOW_TEXT = '超宽长文本溢出演示超宽长文本溢出演示超宽长文本'

const dataColumns = Array.from({ length: SHEET_COL_COUNT }, (_, col) => ({
  title: String.fromCharCode(65 + col), // A~H
  width: col === 0 ? 110 : 104,
  editor: 'text',
  style: col === 0 ? LABEL_COLUMN_STYLE : undefined,
}))

/** 边框线型演示：四边同线型的边框片段 */
function borderAll(style: 'solid' | 'dashed' | 'dotted' | 'double'): CellStyle {
  const edge = { width: 2, color: BORDER_DEMO_COLOR, style }
  return { border: { top: edge, right: edge, bottom: edge, left: edge } }
}

/**
 * 样式矩阵按格 hook 层：键 `${col},${row}` → 覆盖片段（最终覆盖主题分区 token 与列级样式）。
 * 只收矩阵演示格，其余格返回 null 沿用基础样式。
 */
const MATRIX_CELL_STYLES: ReadonlyMap<string, CellStyle> = new Map(
  (
    [
      // 对齐（row 3；B3 左对齐为缺省不设）
      { key: '2,3', style: { textAlign: 'center' } },
      { key: '3,3', style: { textAlign: 'right' } },
      { key: '4,3', style: { verticalAlign: 'top' } },
      { key: '5,3', style: { verticalAlign: 'bottom' } },
      // 加粗 / 斜体（row 4）
      { key: '1,4', style: { fontWeight: 700 } },
      { key: '2,4', style: { fontStyle: 'italic' } },
      { key: '3,4', style: { fontWeight: 700, fontStyle: 'italic' } },
      // 下划线 / 删除线（row 5）
      { key: '1,5', style: { underline: true } },
      { key: '2,5', style: { lineThrough: true } },
      { key: '3,5', style: { underline: true, lineThrough: true } },
      // 字号（row 6）
      { key: '1,6', style: { fontSize: 10 } },
      { key: '2,6', style: { fontSize: 14 } },
      { key: '3,6', style: { fontSize: 18 } },
      // 边框线型（row 7）
      { key: '1,7', style: borderAll('solid') },
      { key: '2,7', style: borderAll('dashed') },
      { key: '3,7', style: borderAll('dotted') },
      { key: '4,7', style: borderAll('double') },
      // 溢出策略（row 8；D8 缺省 = Excel 式溢出到右侧空格）
      { key: '1,8', style: { textOverflow: 'ellipsis' } },
      { key: '2,8', style: { textOverflow: 'clip' } },
      // 内边距（row 9）
      { key: '1,9', style: { padding: [0, 8, 0, 24], background: PADDING_BACKGROUND } },
      { key: '2,9', style: { padding: [8, 16, 8, 16], background: PADDING_BACKGROUND } },
      // 合并区主格（C12:E13）：textWrap 开启后 \n 强制分段 + 段内自动换行叠加
      { key: '2,11', style: { textWrap: true } },
    ] satisfies { key: string; style: CellStyle }[]
  ).map((entry) => [entry.key, entry.style]),
)

/** 初始格值（稀疏预置：矩阵标签与演示值、\n 多行合并区、填充序列、示例图说明） */
function initialCells(): unknown[][] {
  const cells = Array.from({ length: SHEET_ROW_COUNT }, () =>
    Array.from<unknown>({ length: SHEET_COL_COUNT }),
  )
  const set = (col: number, row: number, value: unknown) => {
    cells[row]![col] = value
  }
  set(0, 2, '样式矩阵 ↓')
  set(0, 3, '对齐')
  set(1, 3, '左对齐')
  set(2, 3, '居中')
  set(3, 3, '右对齐')
  set(4, 3, '顶对齐')
  set(5, 3, '底对齐')
  set(0, 4, '字型')
  set(1, 4, '加粗')
  set(2, 4, '斜体')
  set(3, 4, '粗斜体')
  set(0, 5, '线饰')
  set(1, 5, '下划线')
  set(2, 5, '删除线')
  set(3, 5, '下划+删除')
  set(0, 6, '字号')
  set(1, 6, '10px')
  set(2, 6, '14px')
  set(3, 6, '18px')
  set(0, 7, '边框线型')
  set(1, 7, 'solid')
  set(2, 7, 'dashed')
  set(3, 7, 'dotted')
  set(4, 7, 'double')
  set(0, 8, '溢出')
  set(1, 8, OVERFLOW_TEXT)
  set(2, 8, OVERFLOW_TEXT)
  set(3, 8, OVERFLOW_TEXT)
  set(0, 9, '内边距')
  set(1, 9, '左内边距24')
  set(2, 9, '四边内边距')
  // \n 多行文本 + 合并区主格（C12:E13）
  set(2, 11, '合并区 C12:E13\n第二行文本\n第三行文本')
  set(0, 14, '填充柄 ↓')
  // 填充柄预置值：数字序列与文本 tile（生成算法不在内核，拖拽事件由适配层消费）
  set(1, 15, 1)
  set(1, 16, 2)
  set(1, 17, 3)
  set(2, 15, 'a')
  set(2, 16, 'b')
  // 格内示例图说明（图在 F1）
  set(4, 0, '示例图→')
  return cells
}

function formatBounds(bounds: RangeBounds): string {
  return `(${bounds.minCol},${bounds.minRow})~(${bounds.maxCol},${bounds.maxRow})`
}

function formatSelectionRange(range: SelectionRange): string {
  return formatBounds(normalizeRange(range))
}

/** 调试句柄形态（SheetView 挂载时写入 window.__SHEET_DEMO__，对齐 __DEMO__/__sheetDemo 惯例） */
export interface SheetDemoHandle {
  /** 当前表格实例（Enter 开关重建后指向新实例）；含全部几何/滚动/选区查询 API */
  getTable: () => ListTable
  /** 数据模型（SheetModel 坐标模型） */
  model: SheetModel
  /** 关键查询 API 一次性快照（控制台 / 自动化断言用） */
  queries: () => {
    frozen: { cols: number; rows: number }
    selection: ReturnType<ListTable['getSelectedCellRanges']>
    bodyVisible: ReturnType<ListTable['getBodyVisibleCellRange']>
    drawRange: ReturnType<ListTable['getDrawRange']>
    scroll: { left: number; top: number }
    headerLevels: number
    editing: boolean
  }
}

declare global {
  interface Window {
    __SHEET_DEMO__?: SheetDemoHandle
  }
}

export interface SheetDemo {
  /** 当前表格实例（Enter 开关重建后指向新实例） */
  readonly table: ListTable
  model: SheetModel
}

export function mountSheet(root: HTMLElement): SheetDemo {
  const section = createSection(
    root,
    'sheet 电子表格',
    '结构化样式矩阵（主题分区 token → 列级 → 按格 hook 三级覆盖链）：对齐/字型/线饰/字号/边框线型/溢出/内边距；' +
      'C12:E13 合并区含 \\n 多行文本；F1 格内示例图；选中 B16:C18 拖右下角填充柄；' +
      '下方控件切换运行时冻结数与合并区（跨冻结边界被拒绝）、editCellOnEnter 开关（Enter 进入编辑）。',
  )

  // 表格宿主：Enter 开关重建表实例时只替换该容器内部，工具条/状态行位置稳定
  const tableHost = document.createElement('div')
  section.appendChild(tableHost)

  const registry = new EditorRegistry()
  registry.registerEditor('text', {})
  const model = new SheetModel(initialCells())

  const status = addStatus(section, '就绪')
  let editOnEnter = true
  let current: DemoMount | null = null
  let unsubscribe: (() => void)[] = []

  const build = () => {
    for (const off of unsubscribe) {
      off()
    }
    unsubscribe = []
    current?.container.remove()
    const mount = mountTable(tableHost, {
      width: 840,
      height: 420,
      columns: dataColumns,
      model,
      editorRegistry: registry,
      theme: SHEET_THEME,
      editCellOnEnter: editOnEnter,
      frozenColCount: 1,
      frozenRowCount: 1,
      mergeCells: [SHEET_MERGE_RANGE],
      resolveCellStyle: (col, row) => MATRIX_CELL_STYLES.get(`${col},${row}`) ?? null,
      resolveCellImage: (col, row) =>
        col === SHEET_IMAGE_CELL.col && row === SHEET_IMAGE_CELL.row
          ? 'demo://sheet/cell-img'
          : null,
      imageServiceOptions: { loadImage: demoLoadImage },
    })
    current = mount
    const table = mount.table
    // 键盘事件目标是容器（eventsTarget 缺省 container）：容器可聚焦后，
    // 点击画布时浏览器聚焦最近可聚焦祖先（容器），方向键/Enter 经冒泡进入容器监听
    mount.container.tabIndex = 0
    mount.container.style.outline = 'none'
    // 对齐演示行加高，让垂直对齐观感可见
    table.setRowHeight(3, 48)
    unsubscribe = [
      table.onCellChange((change) => {
        status.textContent = `编辑提交 (${change.col},${change.row})：${String(change.oldValue)} → ${String(change.newValue)}`
      }),
      table.onFillHandleDown((event) => {
        status.textContent = `填充柄按下：选区段 ${formatSelectionRange(event.range)}`
      }),
      table.onFillDragEnd((event) => {
        status.textContent = `填充拖拽结束：锚定 ${formatBounds(event.anchor)} → 目标 ${formatBounds(event.target)}（内核不写值，生成算法在适配层）`
      }),
    ]
    // 预置选区：挂载即见填充柄方点，可直接拖拽
    table.selectCells([...SHEET_FILL_SELECTION])
  }
  build()

  const table = () => current!.table

  // ---- 运行时冻结数与合并区切换控件 ----

  addButton(section, '冻结列 +1（0/1/2 循环）', () => {
    const t = table()
    try {
      t.setFrozenColCount((t.getFrozenColCount() + 1) % 3)
    } catch (error) {
      status.textContent = `已拒绝：${(error as Error).message}（冻结数保持原状）`
      return
    }
    status.textContent = `冻结列数 → ${t.getFrozenColCount()}（冻结行数 ${t.getFrozenRowCount()}）`
  })
  addButton(section, '冻结行 +1（0/1/2 循环）', () => {
    const t = table()
    try {
      t.setFrozenRowCount((t.getFrozenRowCount() + 1) % 3)
    } catch (error) {
      status.textContent = `已拒绝：${(error as Error).message}（冻结数保持原状）`
      return
    }
    status.textContent = `冻结行数 → ${t.getFrozenRowCount()}（冻结列数 ${t.getFrozenColCount()}）`
  })

  let mergesExpanded = false
  addButton(section, '合并区追加/还原（setMergeCells）', () => {
    mergesExpanded = !mergesExpanded
    table().setMergeCells(
      mergesExpanded ? [SHEET_MERGE_RANGE, SHEET_MERGE_EXTRA_RANGE] : [SHEET_MERGE_RANGE],
    )
    status.textContent = mergesExpanded ? '已追加合并区 G16:H17' : '已还原为单一合并区'
  })
  addButton(section, '尝试跨冻结边界的合并（应被拒绝）', () => {
    const t = table()
    const frozenCols = t.getFrozenColCount()
    const frozenRows = t.getFrozenRowCount()
    if (frozenCols === 0 && frozenRows === 0) {
      status.textContent = '当前无冻结区，请先把冻结列/行调到非 0 再试'
      return
    }
    // 按当前冻结边界构造必跨界的区间（远离既有合并区，避免误报重叠）
    const range =
      frozenCols > 0
        ? { startCol: 0, startRow: 15, endCol: frozenCols, endRow: 16 }
        : { startCol: 5, startRow: 0, endCol: 6, endRow: frozenRows }
    try {
      t.addMergeCell(range)
      status.textContent = '未拒绝？（不应出现）'
    } catch (error) {
      status.textContent = `已拒绝：${(error as Error).message}（合并区保持原状）`
    }
  })

  // ---- Enter 进编辑演示：开关切换需重建表实例（构造期配置） ----

  const toolbar = section.querySelector<HTMLElement>(':scope > .toolbar')
  if (toolbar) {
    const label = document.createElement('label')
    label.className = 'checkbox'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = editOnEnter
    checkbox.addEventListener('change', () => {
      editOnEnter = checkbox.checked
      build()
      status.textContent = `已按 editCellOnEnter=${editOnEnter} 重建表格`
    })
    label.append(checkbox, document.createTextNode(' editCellOnEnter（Enter 进入编辑）'))
    toolbar.appendChild(label)
  }

  return {
    get table() {
      return table()
    },
    model,
  }
}
