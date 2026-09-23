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
} catch (err) {
  step('!!异常中断', { error: String(err) })
}

step('控制台错误', { errors: errors.slice(0, 10) })
await browser.close()
console.log(JSON.stringify(results, null, 1))
