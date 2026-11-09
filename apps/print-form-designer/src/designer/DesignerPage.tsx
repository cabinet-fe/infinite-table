// 设计页：顶部模板条 + 格样式工具条 + 画布（页面主体）+ 右侧配置面板
// （单元格/数据块/聚合/绑定四 tab）+ 公式栏
// + 函数库/打印弹框 + 画布右键菜单 + 单元格函数的画布点选状态机。
// 本组件只做表现层编排：模板序列化、绑定写入、打印管线均由既有领域模块承担。
// tab 自动落地规则：点有绑定/函数的格 → 落到「单元格」；点数据块（列表项或画布手柄）
// → 钉在「数据块」；右键创建数据块 → 落「数据块」并直接打开设置弹框。
// 函数点选（Excel 式选参数格）：选函数 → 画布点一个字段绑定格 → deriveParamCell 推导
// 数据块/字段 → 写入函数格并吸附选区回函数格；失败原因进画布提示条，保持点选等重点。
import { useEffect, useRef, useState } from 'react'

import { formatRange, type CellAddress, type SheetGridContextMenuInfo } from '@infinitable/sheet'

import { buildCanvasContextMenu, selectionRect } from './canvas-context-menu'
import { cellFnLabel, deriveParamCell } from './cell-function'
import type { FnPickState } from './cell-function-editor'
import { ConfigPanel, type ConfigTab } from './ConfigPanel'
import { FormDoc, type DocHistoryState } from './form-doc'
import { mountFormCanvas, type FormCanvas } from './form-canvas'
import { FormulaBar, type FormulaBarHandle } from './FormulaBar'
import { FunctionLibraryDialog } from './FunctionLibraryDialog'
import { PaperGuidesControl } from './PaperGuidesControl'
import { DEFAULT_PAPER_GUIDES, type PaperGuidesConfig } from './paper-guides'
import { PrintDialog } from './PrintDialog'
import { StyleToolbar } from './StyleToolbar'
import { TemplatePanel } from './TemplatePanel'
import {
  regionLabel,
  regionsAt,
  type CellFnName,
  type FormCellFunction,
  type FormRegion,
  type RegionRowRole,
} from './template'
import { useSelectionStyle } from './use-selection-style'
import { ContextMenu } from '../ui/ContextMenu'
import { runGuarded } from '../errors'

export function DesignerPage() {
  // doc 作为可替换状态：模板加载（TemplatePanel onLoaded）换新文档，画布随 effect 重建
  const [doc, setDoc] = useState<FormDoc>(() => FormDoc.create(8))
  const mountRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<FormCanvas | null>(null)
  const formulaBarRef = useRef<FormulaBarHandle>(null)

  const [regions, setRegions] = useState<FormRegion[]>(() =>
    doc.regions.map((region) => ({ ...region })),
  )
  // 聚合结构变化信号（只用于触发重渲染：面板直读 doc.aggregations）
  const [, setAggregationsRevision] = useState(0)
  const [hist, setHist] = useState<DocHistoryState>({ canUndo: false, canRedo: false })
  // 绑定清单的重算信号（透传 ConfigPanel「绑定」tab 的 BoundList）：
  // 任何会改动 meta 的动作（绑定写入、撤销、换模板）都 +1
  const [bindRevision, setBindRevision] = useState(0)
  // 纸张参考线配置（显示层，不落模板）；缺省 A4 纵向开启——画布即见纸张边界
  const [guides, setGuides] = useState<PaperGuidesConfig | null>(DEFAULT_PAPER_GUIDES)
  // 模板名提升到本页（模板面板与打印弹框共用：打印文档标题取模板名）
  const [templateName, setTemplateName] = useState('')
  // 打印弹框开关：弹框配置只存弹框运行态，不落模板
  const [printOpen, setPrintOpen] = useState(false)
  // 函数库弹框开关
  const [fnLibraryOpen, setFnLibraryOpen] = useState(false)
  // 配置面板当前 tab（cell = 绑定/函数，region = 数据块列表，agg = 聚合）
  const [activeTab, setActiveTab] = useState<ConfigTab>('cell')
  /**
   * 数据块列表点选带来的选区落点（`row:col`）。
   * 点数据块项本身会改选区，而数据块首格可能正好有绑定——这一次不要把 tab 拽回「单元格」。
   * 记落点而不是布尔标志：没有对应的选区变化时标志自然失效，不会误吞后续的切换。
   */
  const suppressedCellRef = useRef<string | null>(null)
  /** 上次参与自动切 tab 判定的活动格：只有真的换了格才重新判定（样式变化不抢 tab） */
  const autoTabAddrRef = useRef<string | null>(null)
  /** 画布手柄/右键动作聚焦的数据块下标（RegionPanel 滚动 + 闪烁） */
  const [regionFocusIndex, setRegionFocusIndex] = useState<number | undefined>(undefined)
  /** 数据块设置弹框受控下标（右键创建数据块后自动打开） */
  const [openRegionIndex, setOpenRegionIndex] = useState<number | null>(null)
  /** 画布右键菜单（null = 关闭；坐标为客户端坐标） */
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    info: SheetGridContextMenuInfo
  } | null>(null)
  /** 画布动作（拖拽提交/右键菜单）的就地错误（toast 自动消失） */
  const [actionError, setActionError] = useState('')
  /**
   * 单元格函数点选状态（一个状态 + 一个推导函数 + 两个动作，画布提示条与面板同源）：
   * 面板选函数 / 重选参数格 → start；Esc / 取消 / 再选 → cancel 或覆盖。
   * 本页持有它是因为选区回调链与画布布局都在这里。
   */
  const [fnPick, setFnPick] = useState<FnPickState | null>(null)
  /** 已做过推导判定的活动格（`row:col`）：同一格重复事件（regions-change 触发的
   * 重渲染）不重复判定，避免点选期间改数据块配置时意外自动写入 */
  const fnPickTriedRef = useRef<string | null>(null)

  // 选区/样式状态：工具条控件回显 + 数据块高亮 + 选区 chip 同源
  const selection = useSelectionStyle(doc)
  // 选区首格落在哪个数据块（侧栏高亮 + chip 文案 + 画布描边同源）
  const activeRegion = selection.range
    ? regionsAt(doc.regions, selection.range.start.row, selection.range.start.col)
    : undefined
  const activeRegionIndex = activeRegion ? doc.regions.indexOf(activeRegion) : undefined
  const bound = selection.activeCell
    ? doc.getCellBinding(selection.activeCell) !== undefined ||
      doc.getCellFunction(selection.activeCell) !== undefined
    : false

  // 点到有绑定/函数的格 → 自动落到「单元格」tab（用户想知道「这格绑了什么」时不用手动切）
  useEffect(() => {
    const addr = selection.activeCell
    if (!addr) {
      autoTabAddrRef.current = null
      return
    }
    const key = `${addr.row}:${addr.col}`
    // 数据块列表点选引起的那一次选区变化：不清 tab，标记用完即清（下不为例）。
    // 同时记下这个格，避免随后同一格的事件（撤销/样式刷新）又把 tab 抢到「单元格」。
    if (suppressedCellRef.current !== null) {
      const matched = suppressedCellRef.current === key
      suppressedCellRef.current = null
      if (matched) {
        autoTabAddrRef.current = key
        return
      }
    }
    // 只对「换成另一个格」做判定：撤销/样式变化会重发选区事件，别把用户手动切的 tab 抢回去
    if (autoTabAddrRef.current === key) return
    autoTabAddrRef.current = key
    if (doc.getCellBinding(addr) || doc.getCellFunction(addr)) setActiveTab('cell')
  }, [doc, selection])

  // 点选参数格：选区变化即对被点格子做推导判定（规则见 deriveParamCell）——
  // 成功写入函数格并把选区吸附回函数格（BoundList 的 selectCell 同款做法）；
  // 失败只换提示条文案并保持点选，用户接着点下一个格子
  useEffect(() => {
    if (!fnPick) return
    const picked = selection.activeCell
    if (!picked) return
    const key = `${picked.row}:${picked.col}`
    // 吸附回函数格的那一次选区事件，以及同一格的重复事件（regions-change 等
    // 触发的状态重建）都不再判定：点选判定只跟着「用户换格子」走
    if (
      key === `${fnPick.targetAddr.row}:${fnPick.targetAddr.col}` ||
      key === fnPickTriedRef.current
    ) {
      return
    }
    fnPickTriedRef.current = key
    const derived = deriveParamCell(
      {
        regions: doc.regions,
        bindingOf: (addr) => doc.getCellBinding(addr),
        functionOf: (addr) => doc.getCellFunction(addr),
      },
      picked,
    )
    if (!derived.ok) {
      setFnPick({ ...fnPick, error: derived.reason })
      return
    }
    const target = fnPick.targetAddr
    const payload: FormCellFunction =
      fnPick.fn === 'GROUP'
        ? { kind: 'fn', fn: 'GROUP', field: derived.field }
        : { kind: 'fn', fn: fnPick.fn, region: derived.region, field: derived.field }
    runGuarded(setActionError, () => doc.setCellFunction(target, payload))
    setFnPick(null)
    canvasRef.current?.refresh()
    setBindRevision((n) => n + 1)
    // 选区吸附回函数格：面板随即显示写好的「参数格语义」摘要
    doc.sheet.selectCell(target)
  }, [doc, selection, fnPick])

  // Esc 取消点选（与画布提示条上的「取消」按钮同一落点：只清状态，什么都不写）
  useEffect(() => {
    if (!fnPick) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFnPick(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fnPick])

  // 动作错误 toast：4 秒自动消失
  useEffect(() => {
    if (!actionError) return
    const timer = window.setTimeout(() => setActionError(''), 4000)
    return () => window.clearTimeout(timer)
  }, [actionError])

  useEffect(() => {
    const el = mountRef.current
    if (!el) return
    const canvas = mountFormCanvas({
      container: el,
      doc,
      // 画布重建（含模板加载换 doc）按当前参考线配置挂载；运行时切换走下方同步 effect
      paperGuides: guides ?? undefined,
      // 数据块手柄点击：跳「数据块」tab + 选中该数据块（列表滚动闪烁 + 画布描边加粗）
      onRegionHandleClick: (index) => focusRegion(index),
      // 边缘拖拽提交：守卫（重叠/踢出绑定格）在 doc.setRegionFields，错误就地 toast
      onRegionResizeCommit: (index, patch) => {
        runGuarded(setActionError, () => doc.setRegionFields(index, patch))
      },
      onContextMenu: (info) => setContextMenu({ x: info.x, y: info.y, info }),
    })
    canvasRef.current = canvas
    const offRegions = doc.on('regions-change', () =>
      setRegions(doc.regions.map((region) => ({ ...region }))),
    )
    const offAggregations = doc.on('aggregations-change', () =>
      setAggregationsRevision((n) => n + 1),
    )
    // sheet 命令（画布键入/工具栏）与快照条目统一刷新撤销按钮态
    const offDocHistory = doc.on('history-change', () => {
      setHist(doc.history.getState())
      // 撤销/重做会回滚绑定/函数 sidecar，清单同步重算
      setBindRevision((n) => n + 1)
    })
    const offSheetHistory = doc.sheet.on('history-change', () => setHist(doc.history.getState()))
    // 模板加载替换 doc 后同步面板状态（绑定清单随新文档重算；点选状态随之终止）
    setRegions(doc.regions.map((region) => ({ ...region })))
    setBindRevision((n) => n + 1)
    setHist(doc.history.getState())
    setFnPick(null)
    return () => {
      offRegions()
      offAggregations()
      offDocHistory()
      offSheetHistory()
      canvasRef.current = null
      canvas.release()
    }
  }, [doc])

  // 参考线配置切换 → 画布 overlay 同步（null 关闭；显示层配置永不进 doc/模板）
  useEffect(() => {
    canvasRef.current?.setPaperGuides(guides)
  }, [guides])

  // ⌘P / Ctrl+P 唤起打印预览（拦截浏览器默认打印）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setPrintOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /** 聚焦一个数据块：选中画布矩形 + 钉在「数据块」tab + 列表滚动闪烁 */
  const focusRegion = (index: number): void => {
    const region = doc.regions[index]
    if (!region) return
    suppressedCellRef.current = `${region.startRow}:${region.startCol}`
    doc.sheet.selectRange({
      start: { row: region.startRow, col: region.startCol },
      end: { row: region.endRow, col: region.endCol },
    })
    setActiveTab('region')
    setRegionFocusIndex(index)
  }

  /** 点数据块列表项：钉在「数据块」tab，并屏蔽这一次选区变化触发的自动切 tab */
  const selectRegionFromList = (index: number): void => {
    const region = doc.regions[index]
    if (region) suppressedCellRef.current = `${region.startRow}:${region.startCol}`
    setActiveTab('region')
  }

  const onBindingEdited = (): void => {
    canvasRef.current?.refresh()
    setBindRevision((n) => n + 1)
  }

  /** 进入点选（面板选函数/重选参数格触发；换目标格 = 覆盖旧状态，状态以 targetAddr 为准） */
  const startFnPick = (fn: CellFnName, targetAddr: CellAddress): void => {
    fnPickTriedRef.current = null
    setFnPick({ fn, targetAddr, error: '' })
  }

  /** 取消点选：什么都不写，不产生半配置函数 */
  const cancelFnPick = (): void => {
    fnPickTriedRef.current = null
    setFnPick(null)
  }

  const selectionText = selection.range ? formatRange(selection.range) : '未选中'

  /** 右键菜单动作（全部经 runGuarded 就地 toast；成功后菜单自行关闭） */
  const menuActions = {
    createRegionFromSelection: (): void => {
      const range = doc.sheet.getSelection().ranges[0]
      if (!range) return
      runGuarded(setActionError, () => {
        doc.createRegionFromRange(range, {})
        const index = doc.regions.length - 1
        focusRegion(index)
        setOpenRegionIndex(index)
      })
    },
    resizeRegionToSelection: (index: number): void => {
      const range = doc.sheet.getSelection().ranges[0]
      if (!range) return
      const rect = selectionRect(range)
      runGuarded(setActionError, () => doc.setRegionFields(index, rect))
    },
    removeRegion: (index: number): void => {
      runGuarded(setActionError, () => doc.removeRegion(index))
    },
    mergeSelection: (): void => {
      const range = doc.sheet.getSelection().ranges[0]
      if (!range) return
      runGuarded(setActionError, () => doc.sheet.mergeCells(range))
    },
    unmergeSelection: (): void => {
      const range = doc.sheet.getSelection().ranges[0]
      if (!range) return
      runGuarded(setActionError, () => doc.sheet.unmergeCells(range))
    },
    setRowRole: (index: number, row: number, role: RegionRowRole): void => {
      runGuarded(setActionError, () => doc.setRegionRowRole(index, row, role))
    },
  }

  return (
    <>
      {/* 紧凑模板条（顶栏正下方一行）：模板名 / 选择已有模板 + 打开 / 保存 / 另存 */}
      <TemplatePanel
        doc={doc}
        name={templateName}
        onNameChange={setTemplateName}
        onLoaded={setDoc}
      />

      <StyleToolbar
        doc={doc}
        canUndo={hist.canUndo}
        canRedo={hist.canRedo}
        onPrint={() => setPrintOpen(true)}
      />

      <div className="app-body">
        {/* DOM 顺序 = 视觉顺序：画布在左占满主体，配置面板（sidebar）固定右侧 */}
        <div className="workspace">
          <div className="canvas-header">
            <span className="canvas-heading">
              <h2>画布</h2>
              <span className="badge" title="画布只显示占位符，实际数据在打印时按绑定/函数取数">
                配置态
              </span>
            </span>

            {selection.range ? (
              <span className="selection-chip" title="当前选区（A1 记法）与所在数据块">
                <span className="addr">{selectionText}</span>
                <span className="region-tag">
                  {activeRegion && activeRegionIndex !== undefined
                    ? regionLabel(activeRegion, activeRegionIndex)
                    : '静态内容'}
                </span>
              </span>
            ) : null}

            <span className="hint canvas-hint">参考线仅作设计参照，实际分页以打印预览为准</span>

            <PaperGuidesControl guides={guides} onChange={setGuides} />
          </div>

          <FormulaBar
            ref={formulaBarRef}
            doc={doc}
            activeCell={selection.activeCell}
            bound={bound}
            onOpenFunctionLibrary={() => setFnLibraryOpen(true)}
            onChanged={() => canvasRef.current?.refresh()}
          />

          <div className="canvas-frame">
            <div ref={mountRef} className="canvas-mount" />
            {/* 点选参数格提示条：常显在画布内侧顶部，与面板同一份 fnPick 状态派生 */}
            {fnPick ? (
              <div className={`pick-hint${fnPick.error ? ' error' : ''}`} role="status">
                <span className="pick-hint-text">
                  {fnPick.error
                    ? `${fnPick.error}，再点一个`
                    : `点击画布上一个字段格作为「${cellFnLabel(fnPick.fn)}」的参数（通常是明细区的数值格）`}
                </span>
                <button type="button" className="pick-hint-cancel" onClick={cancelFnPick}>
                  取消（Esc）
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* 右侧配置面板：四 tab 卡（「绑定」tab = 模板级绑定总账 BoundList） */}
        <aside className="sidebar">
          <section className="card">
            <div className="card-body">
              <ConfigPanel
                doc={doc}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                regions={regions}
                addr={selection.activeCell ?? undefined}
                onBindingEdited={onBindingEdited}
                fnPick={fnPick}
                onFnPickStart={startFnPick}
                onFnPickCancel={cancelFnPick}
                activeRegionIndex={activeRegionIndex}
                regionFocusIndex={regionFocusIndex}
                openRegionIndex={openRegionIndex}
                onOpenRegionIndexChange={setOpenRegionIndex}
                onSelectRegion={selectRegionFromList}
                bindRevision={bindRevision}
              />
            </div>
          </section>
        </aside>
      </div>

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildCanvasContextMenu(doc, contextMenu.info, selection.range, menuActions)}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {actionError ? <div className="action-toast error">{actionError}</div> : null}

      {fnLibraryOpen ? (
        <FunctionLibraryDialog
          onClose={() => setFnLibraryOpen(false)}
          onInsert={(text) => formulaBarRef.current?.insertAtCursor(text)}
        />
      ) : null}

      {printOpen ? (
        <PrintDialog
          doc={doc}
          title={templateName.trim() || '打印单'}
          onClose={() => setPrintOpen(false)}
        />
      ) : null}
    </>
  )
}
