// 设计页：模板面板（保存/另存/列表打开）+ 区域面板（增删/排序/类型/行数）+ 字段绑定 +
// 格样式工具条 + 公式栏 + SheetGrid 画布 + 函数库弹框 + 打印弹框。
// 本组件只做表现层编排：模板序列化、绑定写入、打印管线均由既有领域模块承担。
import { useEffect, useRef, useState } from 'react'

import type { PrintOrientation, PrintPaperPreset } from '@infinitable/plugins'
import { formatRange } from '@infinitable/sheet'

import { BindingEditor } from './BindingEditor'
import { BoundList } from './BoundList'
import { FormDoc, type DocHistoryState } from './form-doc'
import { mountFormCanvas, type FormCanvas } from './form-canvas'
import { FormulaBar, type FormulaBarHandle } from './FormulaBar'
import { FunctionLibraryDialog } from './FunctionLibraryDialog'
import { DEFAULT_PAPER_GUIDES, type PaperGuidesConfig } from './paper-guides'
import { PrintDialog } from './PrintDialog'
import { RegionPanel } from './RegionPanel'
import { StyleToolbar } from './StyleToolbar'
import { TemplatePanel } from './TemplatePanel'
import { REGION_EXPAND_OPTIONS, regionsAt, type FormRegion } from './template'
import { useSelectionStyle } from './use-selection-style'

/** 纸张预设（设计参考线用；真实分页以打印预览为准） */
const PAPER_PRESETS: { value: PrintPaperPreset; label: string }[] = [
  { value: 'A3', label: 'A3' },
  { value: 'A4', label: 'A4' },
  { value: 'A5', label: 'A5' },
  { value: 'Letter', label: 'Letter' },
]

export function DesignerPage() {
  // doc 作为可替换状态：模板加载（TemplatePanel onLoaded）换新文档，画布随 effect 重建
  const [doc, setDoc] = useState<FormDoc>(() => FormDoc.create())
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

          <section className="card region-panel">
            <details open>
              <summary>
                区域
                <span className="chevron">›</span>
              </summary>
              <div className="card-body">
                <RegionPanel doc={doc} regions={regions} activeIndex={activeRegionIndex} />
              </div>
            </details>
          </section>

          <section className="card binding-card">
            <details open>
              <summary>
                字段绑定
                <span className="chevron">›</span>
              </summary>
              <div className="card-body">
                <BindingEditor
                  doc={doc}
                  addr={selection.activeCell ?? undefined}
                  onEdited={() => {
                    canvasRef.current?.refresh()
                    setBindRevision((n) => n + 1)
                  }}
                />
                <BoundList doc={doc} revision={bindRevision} />
              </div>
            </details>
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
                <span className="region-tag">{regionLabel(activeRegion, activeRegionIndex)}</span>
              </span>
            ) : null}

            <span className="hint canvas-hint">参考线仅作设计参照，实际分页以打印预览为准</span>

            <div className="canvas-tools">
              <label className="switch" title="显示纸张边界与分页参考线（不写入模板）">
                <input
                  type="checkbox"
                  checked={guides !== null}
                  onChange={() => setGuides(guides ? null : DEFAULT_PAPER_GUIDES)}
                />
                <span className="switch-track" />
                参考线
              </label>
              {guides ? (
                <>
                  <select
                    className="w-paper"
                    value={guides.paperSize}
                    aria-label="纸张"
                    title="纸张尺寸（仅影响参考线）"
                    onChange={(event) =>
                      setGuides({ ...guides, paperSize: event.target.value as PrintPaperPreset })
                    }
                  >
                    {PAPER_PRESETS.map((preset) => (
                      <option key={preset.value} value={preset.value}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="w-orientation"
                    value={guides.orientation}
                    aria-label="方向"
                    title="纸张方向（仅影响参考线）"
                    onChange={(event) =>
                      setGuides({ ...guides, orientation: event.target.value as PrintOrientation })
                    }
                  >
                    <option value="portrait">纵向</option>
                    <option value="landscape">横向</option>
                  </select>
                </>
              ) : null}
            </div>
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

/** 选区 chip 的区域文案：`区域 N · 向下展开` / `区域 N` / `静态内容` */
function regionLabel(region: FormRegion | undefined, index: number | undefined): string {
  if (!region || index === undefined) return '静态内容'
  const expand =
    region.expand === 'none'
      ? ''
      : REGION_EXPAND_OPTIONS.find((option) => option.value === region.expand)?.label
  return expand ? `区域 ${index + 1} · ${expand}` : `区域 ${index + 1}`
}
