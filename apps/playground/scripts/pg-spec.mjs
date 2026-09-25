// 演练场交互链路测试：原生 playwright-core 驱动（无 run-code 沙箱限制）。
// 用法：node scripts/pg-spec.mjs [url]（缺省 http://localhost:7790/）
import { pathToFileURL } from 'node:url'
// playwright-core 取自全局 @playwright/cli 安装（仓内无直接依赖）
const { chromium } = await import(
  pathToFileURL(
    '/Users/whj/.local/share/mise/installs/node/26.7.0/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs',
  ).href
)

const url = process.argv[2] ?? 'http://localhost:7790/'

// 引擎源码经 vite /@fs 入口在页内 import（bare specifier 无法在 evaluate 上下文解析）
const coreEntryHref = `/@fs${new URL('../../../packages/core/src/index.ts', import.meta.url).pathname}`

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

await page.goto(url)
await page.waitForSelector('.u-sheet__grid-instance', { timeout: 15000 })
await page.waitForTimeout(500)

const results = []
const step = (name, data) => {
  results.push({ step: name, ...data })
}
const evalPage = (fn, arg) => page.evaluate(fn, arg)
const cellCenter = async (col, row) =>
  evalPage(
    ([c, r]) => {
      const t = window.__PG__.grid().getTable()
      const rect = document.querySelector('.u-sheet__grid-instance').getBoundingClientRect()
      const cell = t.getCellRelativeRect(c, r)
      if (!cell) throw new Error(`getCellRelativeRect(${c},${r}) = null`)
      return { x: rect.x + cell.x + cell.width / 2, y: rect.y + cell.y + cell.height / 2 }
    },
    [col, row],
  )

try {
  // ---- 1. 公式编辑：B1 改 SUM(B2:B3) → 77，选区下移 ----
  {
    const p = await cellCenter(1, 0)
    await page.mouse.dblclick(p.x, p.y)
    await page.waitForTimeout(200)
    const editor = page.locator('.u-sheet__grid-instance input')
    const initial = await editor.inputValue()
    await editor.fill('=SUM(Sheet2!B2:B3)')
    await editor.press('Enter')
    await page.waitForTimeout(300)
    const r = await evalPage(() => {
      const pg = window.__PG__
      const t = pg.grid().getTable()
      return {
        editorInitial: undefined,
        b1Text: t.getCellText(1, 0),
        modelF: pg.sheet().getCellData({ row: 0, col: 1 })?.f,
        active: JSON.stringify(pg.sheet().getSelection().activeCell),
        editorClosed: !document.querySelector('.u-sheet__grid-instance input'),
      }
    })
    step('公式编辑提交+重算+选区下移', { 编辑初值: initial, ...r })
  }

  // ---- 2. 撤销 → SUM(B2:B4)=135；重做 → 77；再撤销还原 ----
  {
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(300)
    const undoB1 = await evalPage(() => window.__PG__.grid().getTable().getCellText(1, 0))
    await page.keyboard.press('Meta+Shift+z')
    await page.waitForTimeout(300)
    const redoB1 = await evalPage(() => window.__PG__.grid().getTable().getCellText(1, 0))
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(300)
    step('撤销/重做', { 撤销后B1: undoB1, 重做后B1: redoB1 })
  }

  // ---- 3. 值编辑：D2(1) 改 5 → Enter 下移 ----
  {
    const p = await cellCenter(3, 1)
    await page.mouse.dblclick(p.x, p.y)
    await page.waitForTimeout(200)
    const editor = page.locator('.u-sheet__grid-instance input')
    await editor.fill('5')
    await editor.press('Enter')
    await page.waitForTimeout(300)
    const r = await evalPage(() => {
      const pg = window.__PG__
      const t = pg.grid().getTable()
      return {
        d2: t.getCellText(3, 1),
        active: JSON.stringify(pg.sheet().getSelection().activeCell),
      }
    })
    step('值编辑提交', r)
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(200)
  }

  // ---- 4. 拖选 B1:C2 → 模型范围 ----
  {
    const a = await cellCenter(1, 0)
    const b = await cellCenter(2, 1)
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(b.x, b.y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const ranges = await evalPage(() => JSON.stringify(window.__PG__.sheet().getSelection().ranges))
    step('拖选范围', { ranges })
  }

  // ---- 5. 合并区覆盖格点选 → 整块包围盒 ----
  {
    const p = await cellCenter(2, 5) // C6（B5:C6 的覆盖格）
    await page.mouse.click(p.x, p.y)
    await page.waitForTimeout(300)
    const range = await evalPage(() =>
      JSON.stringify(window.__PG__.sheet().getSelection().ranges[0]),
    )
    step('合并区点选扩包围盒', { range })
  }

  // ---- 6. 右键正文 → 菜单；右键行号 → 菜单（区域三分类） ----
  {
    const body = await cellCenter(1, 0)
    await page.mouse.click(body.x, body.y, { button: 'right' })
    await page.waitForTimeout(400)
    const bodyMenu = await evalPage(() => ({
      open: !!document.querySelector('[class*=contextmenu]'),
      text: (document.querySelector('[class*=contextmenu]')?.textContent ?? '').slice(0, 60),
    }))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    const header = await evalPage(() => {
      const rect = document.querySelector('.u-sheet__grid-instance').getBoundingClientRect()
      return { x: rect.x + 20, y: rect.y + 100 } // 行号列
    })
    await page.mouse.click(header.x, header.y, { button: 'right' })
    await page.waitForTimeout(400)
    const rowMenu = await evalPage(() => ({
      open: !!document.querySelector('[class*=contextmenu]'),
      text: (document.querySelector('[class*=contextmenu]')?.textContent ?? '').slice(0, 60),
    }))
    await page.keyboard.press('Escape')
    step('右键菜单', { 正文: bodyMenu, 行号: rowMenu })
  }

  // ---- 7. 切 Sheet2 → B2 42→100 → 切回联动 ----
  {
    await page.click('text=Sheet2')
    await page.waitForTimeout(600)
    const p = await cellCenter(1, 1)
    await page.mouse.dblclick(p.x, p.y)
    await page.waitForTimeout(200)
    const editor = page.locator('.u-sheet__grid-instance input')
    await editor.fill('100')
    await editor.press('Enter')
    await page.waitForTimeout(300)
    await page.click('text=Sheet1')
    await page.waitForTimeout(600)
    const r = await evalPage(() => ({
      b1: window.__PG__.grid().getTable().getCellText(1, 0),
      sheetName: window.__PG__.sheet().name,
    }))
    step('跨表联动重算', r)
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(200)
  }

  // ---- 8. 填充柄：D2:D3（1,2）拖到 D5 → 3,4（柄方点骑选区右下角点，8px 内外各半） ----
  {
    await evalPage(() => {
      window.__PG__.sheet().selectRange({ start: { row: 1, col: 3 }, end: { row: 2, col: 3 } })
    })
    await page.waitForTimeout(300)
    const handle = await evalPage(() => {
      const t = window.__PG__.grid().getTable()
      const rect = document.querySelector('.u-sheet__grid-instance').getBoundingClientRect()
      const cell = t.getCellRelativeRect(3, 2)
      return { x: rect.x + cell.x + cell.width - 4, y: rect.y + cell.y + cell.height - 4 }
    })
    const target = await cellCenter(3, 4)
    await page.mouse.move(handle.x, handle.y)
    await page.mouse.down()
    await page.mouse.move(target.x, target.y, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    const r = await evalPage(() => {
      const t = window.__PG__.grid().getTable()
      return {
        d3: t.getCellText(3, 2),
        d4: t.getCellText(3, 3),
        d5: t.getCellText(3, 4),
        range: JSON.stringify(window.__PG__.sheet().getSelection().ranges[0]),
      }
    })
    step('填充柄拖拽', r)
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(200)
  }

  // ---- 9. fx 引用拾取：fx 输 '=' → 画布拖选 B9:C10（远离公式建议弹层）→ 插入引用 ----
  {
    await evalPage(() => window.__PG__.sheet().selectCell({ row: 6, col: 0 }))
    await page.waitForTimeout(200)
    const fx = page.locator('.u-sheet__fx-input')
    await fx.click()
    await fx.fill('=')
    await page.waitForTimeout(200)
    const a = await cellCenter(1, 8)
    const b = await cellCenter(2, 9)
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(b.x, b.y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    const r = await evalPage(() => ({
      fx: document.querySelector('.u-sheet__fx-input')?.value,
      modelSel: JSON.stringify(window.__PG__.sheet().getSelection().ranges[0]),
    }))
    step('fx 引用拾取（期望 fx 含 B9:C10 且模型选区不被动）', r)
    await page.keyboard.press('Escape')
  }

  // ---- 10. 键盘导航：方向键移动 + Tab ----
  {
    await evalPage(() => window.__PG__.sheet().selectCell({ row: 0, col: 0 }))
    await page.waitForTimeout(200)
    // 聚焦表格容器
    await page.focus('.u-sheet__grid-instance')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Tab')
    await page.waitForTimeout(300)
    const r = await evalPage(() => JSON.stringify(window.__PG__.sheet().getSelection().activeCell))
    step('键盘导航(A1→↓→→→Tab 期望 C2)', { active: r })
  }
  // ---- 11. wrap 行高：空白行提交多行长文本 → 行高抬升（>28）；改短 → 行高不变（只升不降） ----
  {
    const r = await evalPage(async () => {
      const pg = window.__PG__
      const sheet = pg.sheet()
      const table = pg.grid().getTable()
      const addr = { row: 24, col: 1 } // 空白格 B25
      const before = table.getRowHeight(addr.row)
      const text = [
        'wrap 行高估算第一行内容',
        'wrap 行高估算第二行内容',
        'wrap 行高估算第三行内容',
        'wrap 行高估算第四行内容',
      ].join('\n')
      sheet.setCellValue(addr, text) // cell-change → 受影响行 wrap 重估
      await new Promise((resolve) => setTimeout(resolve, 300))
      const raised = table.getRowHeight(addr.row)
      const modelRaised = sheet.getRowHeight(addr.row)
      sheet.setCellValue(addr, '短文本') // 改短 → 只升不降，行高保留
      await new Promise((resolve) => setTimeout(resolve, 300))
      const afterShorten = table.getRowHeight(addr.row)
      sheet.setCellValue(addr, null) // 清理：还原空白（行高按只升不降保留，不影响后续步骤）
      await new Promise((resolve) => setTimeout(resolve, 300))
      return { before, raised, modelRaised, afterShorten }
    })
    const ok =
      r.before === 28 && r.raised > 28 && r.raised === r.modelRaised && r.afterShorten === r.raised
    step('wrap 行高重估（多行提交抬升；改短不变）', { ...r, 通过: ok })
  }

  // ---- 12. 容器 resize 自适应：改容器尺寸 → ResizeObserver 直连引擎原地 resize，
  // 实例身份不变（标记/重建计数不增）、可视区域按新尺寸渲染、滚动位置保留 ----
  {
    const r = await evalPage(async () => {
      const pg = window.__PG__
      const grid = pg.grid()
      const host = document.querySelector('.u-sheet__grid-instance')
      const table = grid.getTable()
      const markerBefore = grid.tableInstanceMarker
      const rebuildBefore = grid.tableRebuildCount
      table.scrollTo(120, 300)
      // 初始视口较高的页面上 top 会被夹取，断言口径：resize 前后滚动状态一致
      const scrollBefore = table.getScrollState()
      const visibleRowsEndBefore = table.getVisibleRange().rows.end
      host.style.width = '700px'
      host.style.height = '420px'
      await new Promise((resolve) => setTimeout(resolve, 400)) // ResizeObserver → rAF → 引擎 resize
      const canvas = host.querySelector('canvas')
      const scroll = table.getScrollState()
      return {
        markerBefore,
        marker: grid.tableInstanceMarker,
        rebuildBefore,
        rebuild: grid.tableRebuildCount,
        sameInstance: grid.getTable() === table,
        width: table.width,
        height: table.height,
        draw: table.getDrawRange(),
        scrollBefore,
        scroll,
        visibleRowsEndBefore,
        visibleRowsEnd: table.getVisibleRange().rows.end,
        canvasCssW: canvas ? canvas.style.width : null,
        canvasCssH: canvas ? canvas.style.height : null,
      }
    })
    // 画布内容区 = 新视口 700×420 扣行号列 46 / 列头 28
    const ok =
      r.sameInstance &&
      r.marker === r.markerBefore &&
      r.rebuild === r.rebuildBefore &&
      r.width === 700 &&
      r.height === 420 &&
      r.draw.x === 46 &&
      r.draw.y === 28 &&
      r.draw.width === 654 &&
      r.draw.height === 392 &&
      r.scroll.left === r.scrollBefore.left &&
      r.scroll.top === r.scrollBefore.top &&
      r.visibleRowsEnd < r.visibleRowsEndBefore &&
      r.canvasCssW === '700px' &&
      r.canvasCssH === '420px'
    step('容器 resize 自适应（原地 resize：实例不变、按新尺寸渲染、滚动保留）', {
      ...r,
      draw: undefined,
      通过: ok,
    })
    // 还原容器尺寸，不污染页面终态
    await evalPage(() => {
      const host = document.querySelector('.u-sheet__grid-instance')
      host.style.width = ''
      host.style.height = ''
    })
  }

  // ---- 13. Ctrl+A 全选：引擎选区盖满全表（表头带在引擎选区内），列头/行号带全部高亮可见 ----
  {
    await page.focus('.u-sheet__grid-instance')
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(300)
    const r = await evalPage(() => {
      const pg = window.__PG__
      const t = pg.grid().getTable()
      const model = pg.sheet().getSelection().ranges[0]
      const bounds = t.getSelectedCellRanges().map((range) => ({
        minCol: Math.min(range.start.col, range.end.col),
        maxCol: Math.max(range.start.col, range.end.col),
        minRow: Math.min(range.start.row, range.end.row),
        maxRow: Math.max(range.start.row, range.end.row),
      }))
      const spansAll = bounds.some(
        (b) =>
          model != null &&
          b.minCol === 0 &&
          b.minRow === 0 &&
          b.maxCol === model.end.col &&
          b.maxRow === model.end.row,
      )
      const hl = t.theme.interaction.headerHighlight
      let colHl = 0
      let colAll = 0
      for (const [, node] of t.colHeaderNodes) {
        colAll++
        if (node.style.background === hl) colHl++
      }
      let rowHl = 0
      let rowAll = 0
      for (const [, node] of t.rowHeaderNodes) {
        rowAll++
        if (node.style.background === hl) rowHl++
      }
      return { spansAll, colHl, colAll, rowHl, rowAll, model }
    })
    const ok =
      r.spansAll && r.colAll > 0 && r.colHl === r.colAll && r.rowAll > 0 && r.rowHl === r.rowAll
    step('Ctrl+A 全选（引擎选区盖满全表；列头/行号带全高亮）', { ...r, 通过: ok })
  }

  // ---- 14. 整列选区回推：引擎选区整轴覆盖（表头带在引擎选区内），列头 C 高亮、行号带不高亮 ----
  {
    await evalPage(() =>
      window.__PG__.sheet().selectRange({ start: { row: 0, col: 2 }, end: { row: 29, col: 2 } }),
    )
    await page.waitForTimeout(300)
    const r = await evalPage(() => {
      const t = window.__PG__.grid().getTable()
      const bounds = t.getSelectedCellRanges().map((range) => ({
        minCol: Math.min(range.start.col, range.end.col),
        maxCol: Math.max(range.start.col, range.end.col),
        minRow: Math.min(range.start.row, range.end.row),
        maxRow: Math.max(range.start.row, range.end.row),
      }))
      const hl = t.theme.interaction.headerHighlight
      const colHl = [...t.colHeaderNodes]
        .filter(([, node]) => node.style.background === hl)
        .map(([col]) => col)
      const rowHlCount = [...t.rowHeaderNodes].filter(
        ([, node]) => node.style.background === hl,
      ).length
      return { bounds, colHl, rowHlCount }
    })
    const ok =
      r.bounds.length === 1 &&
      r.bounds[0].minRow === 0 &&
      r.bounds[0].maxRow === 29 &&
      r.bounds[0].minCol === 2 &&
      r.bounds[0].maxCol === 2 &&
      r.colHl.length === 1 &&
      r.colHl[0] === 2 &&
      r.rowHlCount === 0
    step('整列选区回推（引擎选区整轴覆盖；列头 C 高亮、行号带不高亮）', { ...r, 通过: ok })
  }

  // ---- 15. 整行选区回推：行号 8 高亮、视口不被拽到行末、活动格落在可视左缘 ----
  {
    // 复位滚动（上一例可能留下非零滚动），保证行 8 可见且视口断言口径干净
    await evalPage(() => window.__PG__.grid().getTable().scrollTo(0, 0))
    await page.waitForTimeout(200)
    const before = await evalPage(() => {
      const t = window.__PG__.grid().getTable()
      const v = t.getBodyVisibleCellRange()
      return { colStart: v.cols.start }
    })
    const rect = await page.evaluate(() => {
      const r = document.querySelector('.u-sheet__grid-instance').getBoundingClientRect()
      return { x: r.x, y: r.y }
    })
    const p = await cellCenter(0, 7) // 行 8 的 y 坐标
    await page.mouse.click(rect.x + 20, p.y) // 行号列带
    await page.waitForTimeout(300)
    const r = await evalPage(() => {
      const pg = window.__PG__
      const t = pg.grid().getTable()
      const model = pg.sheet().getSelection().ranges[0]
      const bounds = t.getSelectedCellRanges().map((range) => ({
        minCol: Math.min(range.start.col, range.end.col),
        maxCol: Math.max(range.start.col, range.end.col),
        minRow: Math.min(range.start.row, range.end.row),
        maxRow: Math.max(range.start.row, range.end.row),
      }))
      const hl = t.theme.interaction.headerHighlight
      const rowHl = [...t.rowHeaderNodes]
        .filter(([, node]) => node.style.background === hl)
        .map(([row]) => row)
      const colHlCount = [...t.colHeaderNodes].filter(
        ([, node]) => node.style.background === hl,
      ).length
      const v = t.getBodyVisibleCellRange()
      return {
        model,
        bounds,
        rowHl,
        colHlCount,
        colStartAfter: v.cols.start,
        activeCol: pg.sheet().getSelection().activeCell?.col ?? null,
      }
    })
    const ok =
      r.model != null &&
      r.model.start.row === 7 &&
      r.model.start.col === 0 &&
      r.model.end.col === 25 &&
      r.bounds.length === 1 &&
      r.bounds[0].minCol === 0 &&
      r.bounds[0].maxCol === 25 &&
      r.bounds[0].minRow === 7 &&
      r.bounds[0].maxRow === 7 &&
      r.rowHl.length === 1 &&
      r.rowHl[0] === 7 &&
      r.colHlCount === 0 &&
      r.colStartAfter === before.colStart && // 视口未被拽到行末
      r.activeCol === before.colStart // 活动格落在可视左缘
    step('整行选区回推（行号 8 高亮；视口不拽到行末；活动格在可视左缘）', { ...r, 通过: ok })
  }

  // ---- 16. 自定义渲染锚点格：renderer 生效（调试面 + 画布像素探测）；清空值回落默认渲染 ----
  {
    const anchors = await evalPage(() => window.__PG__.customAnchors)
    const probeAnchors = ([textAddr, barAddr]) => {
      const t = window.__PG__.grid().getTable()
      const dpr = window.devicePixelRatio || 1
      const canvases = [...document.querySelectorAll('.u-sheet__grid-instance canvas')]
      // 画布本地坐标采样全部图层，返回 RGB 列表（cell 相对量即画布像素原点）
      const pixelsAt = (col, row, dx, dy) => {
        const cell = t.getCellRelativeRect(col, row)
        const px = Math.round((cell.x + dx) * dpr)
        const py = Math.round((cell.y + dy) * dpr)
        return canvases.map((cv) => {
          const d = cv.getContext('2d').getImageData(px, py, 1, 1).data
          return [d[0], d[1], d[2]]
        })
      }
      const isRed = ([r, g, b]) => r > 120 && r > g * 2 && r > b * 2
      const isGreenBar = ([r, g, b]) => g > 110 && g > r * 1.5 && g > b * 1.2
      // 文本徽标：中心带横扫找红字（居中加粗红字）；状态条：左缘 2px 采绿条
      const reds = []
      for (let dx = -20; dx <= 20; dx += 2) {
        reds.push(...pixelsAt(textAddr.col, textAddr.row, 40 + dx, 14))
      }
      return {
        textRenderer: !!t.options.resolveCellRenderer?.(textAddr.col, textAddr.row),
        barRenderer: !!t.options.resolveCellRenderer?.(barAddr.col, barAddr.row),
        redHit: reds.some(isRed),
        barHit: pixelsAt(barAddr.col, barAddr.row, 2, 14).some(isGreenBar),
      }
    }
    const before = await evalPage(
      probeAnchors,
      anchors.map((a) => a.addr),
    )
    // 清空文本锚点值 → 该格回落默认渲染；状态条锚点不受影响（按格分发）
    await evalPage(
      ([textAddr]) => window.__PG__.sheet().setCellValue(textAddr, null),
      [anchors[0].addr],
    )
    await page.waitForTimeout(400)
    const cleared = await evalPage(
      probeAnchors,
      anchors.map((a) => a.addr),
    )
    // 还原锚点值（后续无依赖步骤；渲染恢复）
    await evalPage(
      ([textAddr]) => window.__PG__.sheet().setCellValue(textAddr, '进行中'),
      [anchors[0].addr],
    )
    await page.waitForTimeout(300)
    const restored = await evalPage(
      probeAnchors,
      anchors.map((a) => a.addr),
    )
    const ok =
      before.textRenderer &&
      before.barRenderer &&
      before.redHit &&
      before.barHit &&
      !cleared.textRenderer &&
      !cleared.redHit &&
      cleared.barRenderer &&
      cleared.barHit &&
      restored.textRenderer &&
      restored.redHit
    step('自定义渲染锚点格（renderer 生效；清空回落默认渲染；按格分发）', {
      before,
      cleared,
      restored,
      通过: ok,
    })
  }

  // ---- 17. 浮动图片拖拽：命中拦截不落选区，拖动后落点换算新锚点写回模型（image-change 生效） ----
  {
    const drag = await evalPage(() => {
      const pg = window.__PG__
      const sheet = pg.sheet()
      const t = pg.grid().getTable()
      const image = sheet.getImages()[0]
      if (!image) throw new Error('预置浮动图片缺失')
      const rect = document.querySelector('.u-sheet__grid-instance').getBoundingClientRect()
      const from = t.getCellRelativeRect(image.anchor.from.col, image.anchor.from.row)
      return {
        id: image.id,
        before: { row: image.anchor.from.row, col: image.anchor.from.col },
        selBefore: JSON.stringify(sheet.getSelection().ranges[0] ?? null),
        startX: rect.x + from.x + 4,
        startY: rect.y + from.y + 4,
      }
    })
    const target = await cellCenter(3, 2)
    await page.mouse.move(drag.startX, drag.startY)
    await page.mouse.down()
    await page.mouse.move(target.x, target.y, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    const r = await evalPage(
      ([id]) => {
        const sheet = window.__PG__.sheet()
        const image = sheet.getImages().find((img) => img.id === id)
        if (!image) throw new Error('拖拽后浮动图片缺失')
        const from = image.anchor.from
        return {
          after: { row: from.row, col: from.col, offsetX: from.offsetX, offsetY: from.offsetY },
          selAfter: JSON.stringify(sheet.getSelection().ranges[0] ?? null),
        }
      },
      [drag.id],
    )
    const ok = r.after.row === 2 && r.after.col === 3 && r.selAfter === drag.selBefore
    step('浮动图片拖拽（命中拦截不落选区；落点换算新锚点写回模型）', {
      before: drag.before,
      after: r.after,
      期望: 'from → row2,col3（拖拽不产生单元格选区）',
      通过: ok,
    })
    // 清理：撤销拖拽写回（updateImage 经命令栈可 undo），还原预置位置
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(300)
  }

  // ---- 18. 只读模式：浮动图片可选中查看，拖拽不生效（isReadonly 口径） ----
  {
    const ro = await evalPage(async () => {
      const pg = window.__PG__
      const { SheetGrid } = await import('/src/veltra-grid/sheet-grid.ts')
      const sheet = pg.workbook.addSheet('SpecReadonly')
      // 画一枚 64×48 png（与主页预置图同源做法，不依赖外部资源）
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 48
      const ctx2d = canvas.getContext('2d')
      ctx2d.fillStyle = '#16a34a'
      ctx2d.fillRect(0, 0, 64, 48)
      const dataUrl = canvas.toDataURL('image/png')
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i)
      const id = sheet.insertImage({
        data: bytes,
        type: 'png',
        anchor: { from: { row: 2, col: 2 } },
        width: 64,
        height: 48,
      })
      const host = document.createElement('div')
      host.id = 'pg-readonly-fixture'
      host.style.cssText =
        'position:fixed;right:12px;bottom:12px;width:420px;height:260px;z-index:9999;background:#fff;box-shadow:0 0 0 1px #ddd'
      document.body.appendChild(host)
      const grid = new SheetGrid({ container: host, sheet, rows: 20, cols: 8, readonly: true })
      const t = grid.getTable()
      const rect = host.getBoundingClientRect()
      const cell = t.getCellRelativeRect(2, 2)
      // 调试面暂存实例，供清理释放
      window.__PG_RO__ = { grid, sheet }
      return {
        id,
        startX: rect.x + cell.x + 4,
        startY: rect.y + cell.y + 4,
        targetX: rect.x + 406,
        targetY: rect.y + 126,
      }
    })
    await page.mouse.move(ro.startX, ro.startY)
    await page.mouse.down()
    await page.mouse.move(ro.targetX, ro.targetY, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const r = await evalPage(
      ([id]) => {
        const { grid, sheet } = window.__PG_RO__
        const image = sheet.getImages().find((img) => img.id === id)
        const floats = grid.getTable().floatObjects
        const result = {
          before: { row: 2, col: 2 },
          after: { row: image.anchor.from.row, col: image.anchor.from.col },
          readonlySelected: floats.getSelectedId() === id,
        }
        // 清理：释放只读演练格、移除挂载节点与临时 sheet（还原页面终态）
        grid.release()
        document.getElementById('pg-readonly-fixture')?.remove()
        window.__PG__.workbook.removeSheet('SpecReadonly')
        delete window.__PG_RO__
        return result
      },
      [ro.id],
    )
    const ok = r.after.row === 2 && r.after.col === 2 && r.readonlySelected
    step('只读模式拖拽不生效（可选中查看、锚点不写回；isReadonly 口径）', {
      before: r.before,
      after: r.after,
      readonlySelected: r.readonlySelected,
      通过: ok,
    })
  }

  // ---- 19. 跨冻结合并区：冻结行列 + 横跨冻结边界线的合并区
  // （合并生效、选中/编辑命中主格、绘制无重复无缺失——引擎放开跨冻结边界合并区后适配层全量透传） ----
  {
    const fixture = await evalPage(async () => {
      const pg = window.__PG__
      const { SheetGrid } = await import('/src/veltra-grid/sheet-grid.ts')
      const sheet = pg.workbook.addSheet('SpecFrozenMerge')
      sheet.setFrozen(1, 1) // 冻结 1 行 1 列：边界线在列 1 / 行 1 之间
      const range = { start: { row: 0, col: 0 }, end: { row: 1, col: 2 } } // 横跨两条冻结边界线
      sheet.mergeCells(range)
      sheet.setCellValue({ row: 0, col: 0 }, '跨冻结合并')
      sheet.setCellStyle(range, { fill: { color: '#2563eb' } })
      const host = document.createElement('div')
      host.id = 'pg-frozen-merge-fixture'
      host.style.cssText =
        'position:fixed;right:12px;bottom:12px;width:520px;height:300px;z-index:9999;background:#fff;box-shadow:0 0 0 1px #ddd'
      document.body.appendChild(host)
      const grid = new SheetGrid({ container: host, sheet, rows: 14, cols: 6 })
      const t = grid.getTable()
      // 调试面暂存实例，供后续断言与清理
      window.__PG_FM__ = { grid, sheet }
      const master = t.getCellRelativeRect(0, 0) // 主格钉固冻结角（整块包围盒的左上原点）
      const blockW = t.getColWidth(0) + t.getColWidth(1) + t.getColWidth(2)
      const blockH = t.getRowHeight(0) + t.getRowHeight(1)
      return {
        mergeCount: t.mergeCells.ranges.length,
        mergeRange: JSON.stringify(t.mergeCells.ranges[0] ?? null),
        coveredText: t.getCellText(2, 1), // 覆盖格（双侧越界）取值路由主格
        masterX: master ? master.x : null,
        masterY: master ? master.y : null,
        blockW,
        blockH,
      }
    })
    const mergeOk =
      fixture.mergeCount === 1 &&
      fixture.mergeRange === JSON.stringify({ startCol: 0, startRow: 0, endCol: 2, endRow: 1 }) &&
      fixture.coveredText === '跨冻结合并' &&
      fixture.masterX === 46 && // 行号列 46 之后、冻结列（80px）起点即主格原点
      fixture.masterY === 28 && // 列头 28 之后
      fixture.blockW === 240 && // 整块跨度 3 列（不错切到冻结侧 1 列）
      fixture.blockH === 56 // 整块跨度 2 行
    // 点选覆盖格（列 2 越过冻结列边界）→ 模型选区扩到合并区整块包围盒
    const cover = await evalPage(() => {
      const t = window.__PG_FM__.grid.getTable()
      const rect = document.querySelector('#pg-frozen-merge-fixture').getBoundingClientRect()
      return {
        x: rect.x + t.getCellRelativeRect(0, 0).x + t.getColWidth(0) + t.getColWidth(1) + 40,
        y: rect.y + t.getCellRelativeRect(0, 0).y + 14, // 行 0 内、列 2 中心
      }
    })
    await page.mouse.click(cover.x, cover.y)
    await page.waitForTimeout(300)
    const selRange = await evalPage(() =>
      JSON.stringify(window.__PG_FM__.sheet.getSelection().ranges[0] ?? null),
    )
    const selOk =
      selRange === JSON.stringify({ start: { row: 0, col: 0 }, end: { row: 1, col: 2 } })
    // 清选区（选区叠加层不污染像素采样），画布像素断言：填充四象限无缺失、文本只画一次
    await evalPage(() => window.__PG_FM__.sheet.selectCell({ row: 12, col: 5 }))
    await page.waitForTimeout(300)
    const pixels = await evalPage(() => {
      const t = window.__PG_FM__.grid.getTable()
      const dpr = window.devicePixelRatio || 1
      const canvases = [...document.querySelectorAll('#pg-frozen-merge-fixture canvas')]
      const master = t.getCellRelativeRect(0, 0)
      const x0 = Math.round(master.x * dpr)
      const y0 = Math.round(master.y * dpr)
      const pw = Math.round((t.getColWidth(0) + t.getColWidth(1) + t.getColWidth(2)) * dpr)
      const ph = Math.round((t.getRowHeight(0) + t.getRowHeight(1)) * dpr)
      // 合成多图层：任一图层命中即算（返回蓝填充判定用 RGB）
      const at = (px, py) => {
        for (const cv of canvases) {
          const d = cv.getContext('2d').getImageData(px, py, 1, 1).data
          if (d[3] > 0 && !(d[0] > 240 && d[1] > 240 && d[2] > 240)) return [d[0], d[1], d[2]]
        }
        return [255, 255, 255]
      }
      const isBlue = ([r, g, b]) =>
        Math.abs(r - 37) < 40 && Math.abs(g - 99) < 40 && Math.abs(b - 235) < 40
      // 四象限中心 + 远角内侧（2px 内缩）：跨冻结边界两侧都画出（无缺失、不错切）
      const probes = [
        [x0 + Math.round(40 * dpr), y0 + Math.round(14 * dpr)],
        [x0 + Math.round(200 * dpr), y0 + Math.round(14 * dpr)],
        [x0 + Math.round(40 * dpr), y0 + Math.round(42 * dpr)],
        [x0 + Math.round(200 * dpr), y0 + Math.round(42 * dpr)],
        [x0 + pw - Math.round(4 * dpr), y0 + ph - Math.round(4 * dpr)],
      ].map(([px, py]) => isBlue(at(px, py)))
      // 文本只画一次：整块逐列找深色文本像素（蓝底 b 高、文本近黑 b 低），列簇数 = 1
      const darkCol = Array.from({ length: pw }, () => false)
      for (let yy = 2; yy < ph - 2; yy++) {
        for (let xx = 2; xx < pw - 2; xx++) {
          if (!darkCol[xx]) {
            const [r, g, b] = at(x0 + xx, y0 + yy)
            if (b < 140 && r < 120 && g < 120) darkCol[xx] = true
          }
        }
      }
      const gapTolerance = Math.round(20 * dpr)
      let clusters = 0
      let lastHit = -Infinity
      for (let xx = 0; xx < pw; xx++) {
        if (darkCol[xx]) {
          if (xx - lastHit > gapTolerance) clusters++
          lastHit = xx
        }
      }
      return { probes, textClusters: clusters }
    })
    // 双击覆盖格编辑 → 命中主格：编辑初值为锚点值，提交写回锚点、覆盖格同步
    await page.mouse.dblclick(cover.x, cover.y)
    await page.waitForTimeout(200)
    const editor = page.locator('#pg-frozen-merge-fixture input')
    const editInitial = await editor.inputValue()
    await editor.fill('改值')
    await editor.press('Enter')
    await page.waitForTimeout(300)
    const editResult = await evalPage(() => {
      const sheet = window.__PG_FM__.sheet
      const t = window.__PG_FM__.grid.getTable()
      return {
        anchorV: sheet.getCellData({ row: 0, col: 0 })?.v,
        coveredText: t.getCellText(2, 1),
        editorClosed: !document.querySelector('#pg-frozen-merge-fixture input'),
      }
    })
    const ok =
      mergeOk &&
      selOk &&
      pixels.probes.every(Boolean) &&
      pixels.textClusters === 1 &&
      editInitial === '跨冻结合并' &&
      editResult.anchorV === '改值' &&
      editResult.coveredText === '改值' &&
      editResult.editorClosed
    step('跨冻结合并区（合并生效；点选/编辑命中主格；绘制无重复无缺失）', {
      merge: {
        count: fixture.mergeCount,
        range: fixture.mergeRange,
        covered: fixture.coveredText,
        masterX: fixture.masterX,
        masterY: fixture.masterY,
        blockW: fixture.blockW,
        blockH: fixture.blockH,
      },
      selRange,
      fillsAllPainted: pixels.probes.every(Boolean),
      textClusters: pixels.textClusters,
      editInitial,
      edit: editResult,
      通过: ok,
    })
    // 清理：释放演练格、移除挂载节点与临时 sheet（还原页面终态）
    await evalPage(() => {
      window.__PG_FM__.grid.release()
      document.getElementById('pg-frozen-merge-fixture')?.remove()
      window.__PG__.workbook.removeSheet('SpecFrozenMerge')
      delete window.__PG_FM__
    })
  }
  // ---- 20. 表头点击不跳转：滚动到中部点列头/行头 → 视口不动（getScrollTop/getScrollLeft 不变），
  // 引擎 snapshot.focus 落被点轴 × 可视数据带（ultra-ui 宿主以活动格可见性为闸不再触发滚动跟随） ----
  {
    const setup = await evalPage(() => {
      const t = window.__PG__.grid().getTable()
      const rect = document.querySelector('.u-sheet__grid-instance').getBoundingClientRect()
      const draw = t.getDrawRange()
      // 滚到中部：先探滚动边界再取半程（行列尺寸与视口大小不写死）
      t.setScrollLeft(1e6)
      t.setScrollTop(1e6)
      t.setScrollLeft(Math.floor(t.getScrollLeft() / 2))
      t.setScrollTop(Math.floor(t.getScrollTop() / 2))
      const v = t.getBodyVisibleCellRange()
      // 被点列/行取可视带内第二格（完整可见），表头格视口坐标按当前滚动位置换算
      const col = v.cols.start + 1
      const row = v.rows.start + 1
      let bodyX = draw.x - t.getScrollLeft()
      for (let c = 0; c < col; c++) bodyX += t.getColWidth(c)
      let bodyY = draw.y - t.getScrollTop()
      for (let r = 0; r < row; r++) bodyY += t.getRowHeight(r)
      return {
        col,
        row,
        left: t.getScrollLeft(),
        top: t.getScrollTop(),
        colHeaderX: rect.x + bodyX + t.getColWidth(col) / 2,
        colHeaderY: rect.y + draw.y / 2,
        rowHeaderX: rect.x + draw.x / 2,
        rowHeaderY: rect.y + bodyY + t.getRowHeight(row) / 2,
      }
    })
    await page.waitForTimeout(200)
    // 点列头：整列选区，视口不动，焦点 = 被点列 × 可视行带首行
    await page.mouse.click(setup.colHeaderX, setup.colHeaderY)
    await page.waitForTimeout(300)
    const colResult = await evalPage(() => {
      const t = window.__PG__.grid().getTable()
      return {
        left: t.getScrollLeft(),
        top: t.getScrollTop(),
        focus: t.getSelection().focus,
        range: t.getSelectedCellRanges()[0],
        visible: t.getBodyVisibleCellRange(),
      }
    })
    const colOk =
      colResult.left === setup.left &&
      colResult.top === setup.top &&
      colResult.range != null &&
      colResult.range.start.col === setup.col &&
      colResult.range.end.col === setup.col &&
      colResult.range.start.row === 0 &&
      colResult.focus != null &&
      colResult.focus.col === setup.col &&
      colResult.focus.row >= colResult.visible.rows.start &&
      colResult.focus.row < colResult.visible.rows.end
    // 点行头：整行选区，视口不动，焦点 = 可视列带首列 × 被点行
    await page.mouse.click(setup.rowHeaderX, setup.rowHeaderY)
    await page.waitForTimeout(300)
    const rowResult = await evalPage(() => {
      const t = window.__PG__.grid().getTable()
      return {
        left: t.getScrollLeft(),
        top: t.getScrollTop(),
        focus: t.getSelection().focus,
        range: t.getSelectedCellRanges()[0],
        visible: t.getBodyVisibleCellRange(),
      }
    })
    const rowOk =
      rowResult.left === setup.left &&
      rowResult.top === setup.top &&
      rowResult.range != null &&
      rowResult.range.start.row === setup.row &&
      rowResult.range.end.row === setup.row &&
      rowResult.range.start.col === 0 &&
      rowResult.focus != null &&
      rowResult.focus.row === setup.row &&
      rowResult.focus.col >= rowResult.visible.cols.start &&
      rowResult.focus.col < rowResult.visible.cols.end
    step('表头点击不跳转（滚动到中部点列头/行头：视口不动；焦点在被点轴 × 可视数据带）', {
      滚动位: { left: setup.left, top: setup.top },
      列头: {
        被点列: setup.col,
        focus: colResult.focus,
        range: colResult.range,
        滚动不变: colResult.left === setup.left && colResult.top === setup.top,
      },
      行头: {
        被点行: setup.row,
        focus: rowResult.focus,
        range: rowResult.range,
        滚动不变: rowResult.left === setup.left && rowResult.top === setup.top,
      },
      通过: colOk && rowOk,
    })
  }

  // ---- 21. DPR 清晰度：CDP 把 deviceScaleFactor 提到 2 → 各已建层 canvas 物理尺寸跟随新 DPR
  // （滚动位置、选区、实例身份不变）；devicePixelRatio=2 页面上未显式传 dpr 建表直接取环境值 ----
  {
    const before = await evalPage(() => {
      const pg = window.__PG__
      const grid = pg.grid()
      const t = grid.getTable()
      // 留下非零滚动与选区，断言 DPR 切换不触碰滚动/选区/实例身份
      t.setScrollLeft(120)
      t.setScrollTop(240)
      pg.sheet().selectCell({ row: 3, col: 2 })
      return {
        marker: grid.tableInstanceMarker,
        scroll: t.getScrollState(),
        ranges: JSON.stringify(t.getSelectedCellRanges()),
      }
    })
    await page.waitForTimeout(200)
    const session = await page.context().newCDPSession(page)
    // 尺寸同步 +1：模拟真实缩放/跨屏（viewport 随 deviceScaleFactor 一起动），
    // 纯改 dsf 而尺寸不动的 CDP 覆盖不派发 resize/resolution 变更事件
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 1441,
      height: 901,
      deviceScaleFactor: 2,
      mobile: false,
    })
    await page.waitForTimeout(500)
    const followed = await evalPage(() => {
      const pg = window.__PG__
      const grid = pg.grid()
      const t = grid.getTable()
      const dpr = window.devicePixelRatio
      const canvases = [...document.querySelectorAll('.u-sheet__grid-instance canvas')].map(
        (cv) => ({
          width: cv.width,
          height: cv.height,
          cssW: parseFloat(cv.style.width),
          cssH: parseFloat(cv.style.height),
        }),
      )
      return {
        dpr,
        canvasCount: canvases.length,
        canvases,
        follow: canvases.every(
          (cv) => cv.width === Math.round(cv.cssW * dpr) && cv.height === Math.round(cv.cssH * dpr),
        ),
        marker: grid.tableInstanceMarker,
        scroll: t.getScrollState(),
        ranges: JSON.stringify(t.getSelectedCellRanges()),
      }
    })
    // devicePixelRatio=2 的页面上未显式传 dpr 建表：缺省直接取环境值（spec 验收第 1 条口径）
    const bare = await evalPage(async (href) => {
      const { ListTable } = await import(href)
      const host = document.createElement('div')
      host.id = 'pg-dpr-fixture'
      host.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:200px;visibility:hidden'
      document.body.appendChild(host)
      const table = new ListTable({
        width: 400,
        height: 200,
        columns: [{ width: 100 }, { width: 100 }, { width: 100 }],
        records: [{ a: 1 }, { a: 2 }, { a: 3 }],
        hostOptions: { container: host },
      })
      const dpr = window.devicePixelRatio
      const canvases = [...host.querySelectorAll('canvas')].map((cv) => ({
        width: cv.width,
        height: cv.height,
        cssW: parseFloat(cv.style.width),
        cssH: parseFloat(cv.style.height),
      }))
      const ok =
        canvases.length > 0 &&
        canvases.every(
          (cv) => cv.width === Math.round(cv.cssW * dpr) && cv.height === Math.round(cv.cssH * dpr),
        )
      table.destroy()
      host.remove()
      return { dpr, ok }
    }, coreEntryHref)
    // 还原 deviceScaleFactor：跟随回 1×（监听按新 resolution 重武装的实测口径）
    await session.send('Emulation.clearDeviceMetricsOverride')
    await page.waitForTimeout(500)
    const restored = await evalPage(() => {
      const dpr = window.devicePixelRatio
      const canvases = [...document.querySelectorAll('.u-sheet__grid-instance canvas')]
      return {
        dpr,
        follow: canvases.every(
          (cv) =>
            cv.width === Math.round(parseFloat(cv.style.width) * dpr) &&
            cv.height === Math.round(parseFloat(cv.style.height) * dpr),
        ),
      }
    })
    const ok =
      followed.dpr === 2 &&
      followed.canvasCount > 0 &&
      followed.follow &&
      followed.marker === before.marker &&
      followed.scroll.left === before.scroll.left &&
      followed.scroll.top === before.scroll.top &&
      followed.ranges === before.ranges &&
      bare.dpr === 2 &&
      bare.ok &&
      restored.dpr === 1 &&
      restored.follow
    step(
      'DPR 清晰度（CDP 变更 deviceScaleFactor：物理尺寸跟随、滚动/选区/实例不变；缺省 dpr 取环境值）',
      {
        跟随: {
          dpr: followed.dpr,
          canvasCount: followed.canvasCount,
          canvases: followed.canvases,
          follow: followed.follow,
          marker: followed.marker,
          scroll: followed.scroll,
        },
        缺省建表: bare,
        还原: restored,
        通过: ok,
      },
    )
  }
  // ---- 22. Excel 式溢出：sheet 主题 body 分区不再强制 ellipsis——写入超宽左对齐文本，
  // 相邻空格内可见溢出字形（像素断言）；右对齐文本向左溢（样式投影断言），右侧保持干净 ----
  {
    await evalPage(async () => {
      const pg = window.__PG__
      const { SheetGrid } = await import('/src/veltra-grid/sheet-grid.ts')
      const sheet = pg.workbook.addSheet('SpecOverflow')
      const LONG = 'A'.repeat(30) // 超宽（约 250px > 列宽 80px）
      sheet.setCellValue({ row: 1, col: 1 }, LONG) // 左对齐（缺省）→ 向右溢
      sheet.setCellValue({ row: 3, col: 3 }, LONG) // 右对齐 → 向左溢
      sheet.setCellStyle(
        { start: { row: 3, col: 3 }, end: { row: 3, col: 3 } },
        { align: { horizontal: 'right' } },
      )
      const host = document.createElement('div')
      host.id = 'pg-overflow-fixture'
      host.style.cssText =
        'position:fixed;right:12px;bottom:12px;width:520px;height:300px;z-index:9999;background:#fff;box-shadow:0 0 0 1px #ddd'
      document.body.appendChild(host)
      const grid = new SheetGrid({ container: host, sheet, rows: 8, cols: 8 })
      window.__PG_OV__ = { grid, sheet }
      await new Promise((resolve) => setTimeout(resolve, 300))
      return true
    })
    const pixels = await evalPage(() => {
      const t = window.__PG_OV__.grid.getTable()
      const dpr = window.devicePixelRatio || 1
      const canvases = [...document.querySelectorAll('#pg-overflow-fixture canvas')]
      const at = (px, py) => {
        for (const cv of canvases) {
          const d = cv.getContext('2d').getImageData(px, py, 1, 1).data
          if (d[3] > 0 && !(d[0] > 240 && d[1] > 240 && d[2] > 240)) return [d[0], d[1], d[2]]
        }
        return [255, 255, 255]
      }
      // 格内暗色字形采样点数（网格线 #E1E4E8 不计入，内缩 4px 避边框）
      const darkCount = (col, row) => {
        const cell = t.getCellRelativeRect(col, row)
        const w = t.getColWidth(col)
        const h = t.getRowHeight(row)
        let dark = 0
        for (let py = cell.y + 4; py < cell.y + h - 4; py += 3) {
          for (let px = cell.x + 4; px < cell.x + w - 4; px += 3) {
            const [r, g, b] = at(Math.round(px * dpr), Math.round(py * dpr))
            if (r + g + b < 360) dark++
          }
        }
        return dark
      }
      return {
        // 左对齐源格与右邻空格：溢出字形可见
        leftSource: darkCount(1, 1),
        leftNeighbor: darkCount(2, 1),
        leftFar: darkCount(3, 1),
        // 右对齐源格：左邻空格可见溢出、右侧空格干净（不向右溢）
        rightSource: darkCount(3, 3),
        rightNeighbor: darkCount(2, 3),
        rightClean: darkCount(4, 3),
      }
    })
    const ok =
      pixels.leftSource > 10 &&
      pixels.leftNeighbor > 10 &&
      pixels.leftFar > 10 &&
      pixels.rightSource > 10 &&
      pixels.rightNeighbor > 10 &&
      pixels.rightClean < 5
    step(
      'Excel 式溢出（body 主题去强制 ellipsis：超宽左对齐文本右邻空格可见字形；右对齐向左溢、右侧干净）',
      {
        采样: pixels,
        通过: ok,
      },
    )
    // 清理：销毁实例、移除夹具与临时 sheet（还原页面终态）
    await evalPage(() => {
      window.__PG_OV__.grid.destroy()
      document.getElementById('pg-overflow-fixture')?.remove()
      window.__PG__.workbook.removeSheet('SpecOverflow')
      delete window.__PG_OV__
    })
  }
} catch (err) {
  step('!!异常中断', { error: String(err) })
}

step('控制台错误', { errors: errors.slice(0, 10) })
await browser.close()
console.log(JSON.stringify(results, null, 1))
