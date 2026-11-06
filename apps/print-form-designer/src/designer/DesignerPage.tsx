// 设计页：模板面板 + 配置面板（单元格/区域双 tab）+ 格样式工具条 + 公式栏 + 画布 + 函数库/打印弹框。
// 本组件只做表现层编排：模板序列化、绑定写入、打印管线均由既有领域模块承担。
// 双 tab 的自动落地规则：点有绑定的格 → 落到「单元格」；点区域列表项 → 钉在「区域」。
import { useEffect, useRef, useState } from 'react'

import { formatRange } from '@infinitable/sheet'

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
import { regionLabel, regionsAt, type FormRegion } from './template'
import { useSelectionStyle } from './use-selection-style'

export function DesignerPage() {
  // doc 作为可替换状态：模板加载（TemplatePanel onLoaded）换新文档，画布随 effect 重建
  const [doc, setDoc] = useState<FormDoc>(() => FormDoc.create(8))
  const mountRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<FormCanvas | null>(null)
  const formulaBarRef = useRef<FormulaBarHandle>(null)

  const [regions, setRegions] = useState<FormRegion[]>(() =>
    doc.regions.map((region) => ({ ...region })),
  )
  const [hist, setHist] = useState<DocHistoryState>({ canUndo: false, canRedo: false })
  // 绑定清单的重算信号：任何会改动 meta 的动作（绑定写入、撤销、换模板）都 +1
  const [bindRevision, setBindRevision] = useState(0)
  // 纸张参考线配置（显示层，不落模板）；缺省 A4 纵向开启——画布即见纸张边界
  const [guides, setGuides] = useState<PaperGuidesConfig | null>(DEFAULT_PAPER_GUIDES)
  // 模板名提升到本页（模板面板与打印弹框共用：打印文档标题取模板名）
  const [templateName, setTemplateName] = useState('')
  // 打印弹框开关：弹框配置只存弹框运行态，不落模板
  const [printOpen, setPrintOpen] = useState(false)
  // 函数库弹框开关
  const [fnLibraryOpen, setFnLibraryOpen] = useState(false)
  // 配置面板当前 tab（cell = 绑定编辑，region = 区域列表）
  const [activeTab, setActiveTab] = useState<ConfigTab>('cell')
  /**
   * 区域列表点选带来的选区落点（`row:col`）。
   * 点区域项本身会改选区，而区域首格可能正好有绑定——这一次不要把 tab 拽回「单元格」。
   * 记落点而不是布尔标志：没有对应的选区变化时标志自然失效，不会误吞后续的切换。
   */
  const suppressedCellRef = useRef<string | null>(null)
  /** 上次参与自动切 tab 判定的活动格：只有真的换了格才重新判定（样式变化不抢 tab） */
  const autoTabAddrRef = useRef<string | null>(null)

  // 选区/样式状态：工具条控件回显 + 区域高亮 + 选区 chip 同源
  const selection = useSelectionStyle(doc)
  // 选区首格落在哪个区域（侧栏高亮 + chip 文案 + 画布描边同源）
  const activeRegion = selection.range
    ? regionsAt(doc.regions, selection.range.start.row, selection.range.start.col)
    : undefined
  const activeRegionIndex = activeRegion ? doc.regions.indexOf(activeRegion) : undefined
  const bound = selection.activeCell
    ? doc.getCellBinding(selection.activeCell) !== undefined
    : false

  // 点到有绑定的格 → 自动落到「单元格」tab（用户想知道「这格绑了什么」时不用手动切）
  useEffect(() => {
    const addr = selection.activeCell
    if (!addr) {
      autoTabAddrRef.current = null
      return
    }
    const key = `${addr.row}:${addr.col}`
    // 区域列表点选引起的那一次选区变化：不清 tab，标记用完即清（下不为例）。
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
    if (doc.getCellBinding(addr)) setActiveTab('cell')
  }, [doc, selection])

  useEffect(() => {
    const el = mountRef.current
    if (!el) return
    const canvas = mountFormCanvas({
      container: el,
      doc,
      // 画布重建（含模板加载换 doc）按当前参考线配置挂载；运行时切换走下方同步 effect
      paperGuides: guides ?? undefined,
    })
    canvasRef.current = canvas
    const offRegions = doc.on('regions-change', () =>
      setRegions(doc.regions.map((region) => ({ ...region }))),
    )
    // sheet 命令（画布键入/工具栏）与快照条目统一刷新撤销按钮态
    const offDocHistory = doc.on('history-change', () => {
      setHist(doc.history.getState())
      // 撤销/重做会回滚绑定 sidecar，清单同步重算
      setBindRevision((n) => n + 1)
    })
    const offSheetHistory = doc.sheet.on('history-change', () => setHist(doc.history.getState()))
    // 模板加载替换 doc 后同步面板状态（绑定清单随新文档重算）
    setRegions(doc.regions.map((region) => ({ ...region })))
    setBindRevision((n) => n + 1)
    setHist(doc.history.getState())
    return () => {
      offRegions()
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

  /** 点区域列表项：钉在「区域」tab，并屏蔽这一次选区变化触发的自动切 tab */
  const selectRegionFromList = (index: number): void => {
    const region = doc.regions[index]
    if (region) suppressedCellRef.current = `${region.startRow}:${region.startCol}`
    setActiveTab('region')
  }

  const onBindingEdited = (): void => {
    canvasRef.current?.refresh()
    setBindRevision((n) => n + 1)
  }

  const selectionText = selection.range ? formatRange(selection.range) : '未选中'

  return (
    <>
      <StyleToolbar
        doc={doc}
        canUndo={hist.canUndo}
        canRedo={hist.canRedo}
        onPrint={() => setPrintOpen(true)}
      />

      <div className="app-body">
        <aside className="sidebar">
          <TemplatePanel
            doc={doc}
            name={templateName}
            onNameChange={setTemplateName}
            onLoaded={setDoc}
          />

          <section className="card">
            <div className="card-body">
              <ConfigPanel
                doc={doc}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                regions={regions}
                addr={selection.activeCell ?? undefined}
                onBindingEdited={onBindingEdited}
                bindRevision={bindRevision}
                activeRegionIndex={activeRegionIndex}
                onSelectRegion={selectRegionFromList}
              />
            </div>
          </section>
        </aside>

        <div className="workspace">
          <div className="canvas-header">
            <span className="canvas-heading">
              <h2>画布</h2>
              <span className="badge" title="画布只显示占位符，实际数据在打印时按绑定取数">
                配置态
              </span>
            </span>

            {selection.range ? (
              <span className="selection-chip" title="当前选区（A1 记法）与所在区域">
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
          </div>
        </div>
      </div>

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
