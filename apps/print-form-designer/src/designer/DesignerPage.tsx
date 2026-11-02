import { useEffect, useRef, useState } from 'react'

import type { PrintOrientation, PrintPaperPreset } from '@infinitable/plugins'
import type { CellAddress, CellRange, CellStylePatch } from '@infinitable/sheet'
import { BORDER_STYLE_WIDTH } from '@infinitable/sheet'

import { BindingEditor } from './BindingEditor'
import { FormDoc, normalizeRange, type DocHistoryState } from './form-doc'
import { mountFormCanvas, type FormCanvas } from './form-canvas'
import { DEFAULT_PAPER_GUIDES, type PaperGuidesConfig } from './paper-guides'
import { PrintDialog } from './PrintDialog'
import { TemplatePanel } from './TemplatePanel'
import { BAND_KINDS, BAND_KIND_LABELS, type BandKind, type FormBand } from './template'

/**
 * 设计画布页：模板面板（保存/另存/列表打开，P5）+ 波段面板（增删/排序/标记明细）+
 * 格样式工具栏（线框/填充/字体/对齐/numFmt/合并/行高列宽，经 sheet 命令与快照条目
 * 可撤销）+ SheetGrid 画布（占位符配置态）+ 绑定编辑面板（拾取模式点选格唤起，P6）。
 * 模板加载经 setDoc 替换文档，画布随 effect 重建完整还原；数据态预览/打印弹框在 P8。
 * 纸张边界/分页参考线（P4）为画布 overlay 显示层：配置只在本组件 React 状态，
 * 不落模板（真实分页以打印弹框预览为准）。
 */

type NumFmtOption = 'none' | 'date' | 'thousands' | 'fixed2' | 'cnUpper'
type BorderOption = 'none' | 'thin' | 'medium' | 'thick' | 'dashed'

/** 边框预设：四边同线型（无 = 四边全清） */
function borderPatch(option: BorderOption): CellStylePatch {
  if (option === 'none') {
    return { border: { top: null, right: null, bottom: null, left: null } }
  }
  const edge = { style: option, width: BORDER_STYLE_WIDTH[option], color: '#000000' }
  return { border: { top: edge, right: edge, bottom: edge, left: edge } }
}

function numFmtPatch(option: NumFmtOption): CellStylePatch {
  switch (option) {
    case 'date':
      return { numFmt: { type: 'date' } }
    case 'thousands':
      return { numFmt: { type: 'thousands' } }
    case 'fixed2':
      return { numFmt: { type: 'fixed', digits: 2 } }
    case 'cnUpper':
      return { numFmt: { type: 'cnUpper' } }
    default:
      return { numFmt: null }
  }
}

export function DesignerPage() {
  // doc 作为可替换状态：模板加载（TemplatePanel onLoaded）换新文档，画布随 effect 重建
  const [doc, setDoc] = useState<FormDoc>(() => FormDoc.create())
  const mountRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<FormCanvas | null>(null)

  const [bands, setBands] = useState<FormBand[]>(() => doc.bands.map((band) => ({ ...band })))
  const [hist, setHist] = useState<DocHistoryState>({ canUndo: false, canRedo: false })
  const [activeBandRow, setActiveBandRow] = useState<number | undefined>(undefined)
  const [pickMode, setPickMode] = useState(false)
  const [editingAddr, setEditingAddr] = useState<CellAddress | undefined>(undefined)
  const [addKind, setAddKind] = useState<BandKind>('detail')
  // 纸张参考线配置（显示层，不落模板）；缺省 A4 纵向开启——画布即见纸张边界
  const [guides, setGuides] = useState<PaperGuidesConfig | null>(DEFAULT_PAPER_GUIDES)
  // 模板名提升到本页（模板面板与打印弹框共用：打印文档标题取模板名）
  const [templateName, setTemplateName] = useState('')
  // 打印弹框开关（P8）：弹框配置只存弹框运行态，不落模板
  const [printOpen, setPrintOpen] = useState(false)

  useEffect(() => {
    const el = mountRef.current
    if (!el) return
    const canvas = mountFormCanvas({
      container: el,
      doc,
      onSelectionChange: ({ band }) => setActiveBandRow(band?.startRow),
      // 拾取模式点选格 → 绑定编辑面板目标格（选区被拦截不落模型）
      onCellPick: (addr) => setEditingAddr(addr),
      // 画布重建（含模板加载换 doc）按当前参考线配置挂载；运行时切换走下方同步 effect
      paperGuides: guides ?? undefined,
    })
    canvasRef.current = canvas
    const offBands = doc.on('bands-change', () => setBands(doc.bands.map((band) => ({ ...band }))))
    // sheet 命令（画布键入/工具栏）与快照条目统一刷新撤销按钮态
    const offDocHistory = doc.on('history-change', () => setHist(doc.history.getState()))
    const offSheetHistory = doc.sheet.on('history-change', () => setHist(doc.history.getState()))
    // 模板加载替换 doc 后同步面板状态（新画布拾取默认关闭，选区/绑定编辑归零）
    setBands(doc.bands.map((band) => ({ ...band })))
    setActiveBandRow(undefined)
    setPickMode(false)
    setEditingAddr(undefined)
    setHist(doc.history.getState())
    return () => {
      offBands()
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

  /** 当前选区（无选区时工具栏操作无效） */
  const selectionRange = (): CellRange | null => doc.sheet.getSelection().ranges[0] ?? null

  const applyStyle = (patch: CellStylePatch): void => {
    const range = selectionRange()
    if (range) doc.sheet.setCellStyle(normalizeRange(range), patch)
  }

  const mergeSelection = (): void => {
    const range = selectionRange()
    if (range) doc.sheet.mergeCells(normalizeRange(range))
  }

  const unmergeSelection = (): void => {
    const range = selectionRange()
    if (range) doc.sheet.unmergeCells(normalizeRange(range))
  }

  /** 活动格所在行/列的尺寸编辑（快照条目，可撤销） */
  const applyRowHeight = (value: string): void => {
    const active = doc.sheet.getSelection().activeCell
    if (active) doc.setRowHeight(active.row, Number(value) || 0)
  }

  const applyColWidth = (value: string): void => {
    const active = doc.sheet.getSelection().activeCell
    if (active) doc.setColWidth(active.col, Number(value) || 0)
  }

  const togglePickMode = (): void => {
    const next = !pickMode
    setPickMode(next)
    if (!next) setEditingAddr(undefined)
    canvasRef.current?.setPickMode(next)
  }

  return (
    <div className="designer">
      <TemplatePanel
        doc={doc}
        name={templateName}
        onNameChange={setTemplateName}
        onLoaded={setDoc}
      />

      <section className="panel toolbar">
        <h2>格样式</h2>
        <div className="toolbar-row">
          <button onClick={() => doc.history.undo()} disabled={!hist.canUndo}>
            撤销
          </button>
          <button onClick={() => doc.history.redo()} disabled={!hist.canRedo}>
            重做
          </button>
          <span className="toolbar-sep" />
          <button className="primary" onClick={() => setPrintOpen(true)}>
            打印
          </button>
          <label>
            边框{' '}
            <select
              defaultValue="none"
              onChange={(event) => applyStyle(borderPatch(event.target.value as BorderOption))}
            >
              <option value="none">无</option>
              <option value="thin">细线</option>
              <option value="medium">中线</option>
              <option value="thick">粗线</option>
              <option value="dashed">虚线</option>
            </select>
          </label>
          <label>
            填充{' '}
            <input
              type="color"
              onChange={(event) => applyStyle({ fill: { color: event.target.value } })}
            />
          </label>
          <button onClick={() => applyStyle({ fill: {} })}>清除填充</button>
          <label>
            字色{' '}
            <input
              type="color"
              onChange={(event) => applyStyle({ font: { color: event.target.value } })}
            />
          </label>
          <button onClick={() => applyStyle({ font: { bold: true } })}>加粗</button>
          <button onClick={() => applyStyle({ font: { bold: null } })}>取消加粗</button>
          <label>
            字号{' '}
            <input
              type="number"
              min={6}
              max={72}
              defaultValue={11}
              className="num-input"
              onChange={(event) => applyStyle({ font: { size: Number(event.target.value) || 11 } })}
            />
          </label>
        </div>
        <div className="toolbar-row">
          <label>
            水平{' '}
            <select
              defaultValue="left"
              onChange={(event) =>
                applyStyle({
                  align: { horizontal: event.target.value as 'left' | 'center' | 'right' },
                })
              }
            >
              <option value="left">左</option>
              <option value="center">中</option>
              <option value="right">右</option>
            </select>
          </label>
          <label>
            垂直{' '}
            <select
              defaultValue="middle"
              onChange={(event) =>
                applyStyle({
                  align: { vertical: event.target.value as 'top' | 'middle' | 'bottom' },
                })
              }
            >
              <option value="top">上</option>
              <option value="middle">中</option>
              <option value="bottom">下</option>
            </select>
          </label>
          <label>
            格式{' '}
            <select
              defaultValue="none"
              onChange={(event) => applyStyle(numFmtPatch(event.target.value as NumFmtOption))}
            >
              <option value="none">常规</option>
              <option value="date">日期</option>
              <option value="thousands">千分位</option>
              <option value="fixed2">两位小数</option>
              <option value="cnUpper">中文大写</option>
            </select>
          </label>
          <button onClick={mergeSelection}>合并</button>
          <button onClick={unmergeSelection}>取消合并</button>
          <label>
            行高{' '}
            <input
              type="number"
              min={0}
              defaultValue={28}
              className="num-input"
              onChange={(event) => applyRowHeight(event.target.value)}
            />
          </label>
          <label>
            列宽{' '}
            <input
              type="number"
              min={0}
              defaultValue={96}
              className="num-input"
              onChange={(event) => applyColWidth(event.target.value)}
            />
          </label>
        </div>
      </section>

      <div className="designer-body">
        <section className="panel band-panel">
          <h2>波段</h2>
          <ul className="band-list">
            {bands.map((band, index) => (
              <li
                key={index}
                className={band.startRow === activeBandRow ? 'band-item active' : 'band-item'}
              >
                <select
                  value={band.kind}
                  onChange={(event) => doc.setBandKind(index, event.target.value as BandKind)}
                >
                  {BAND_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {BAND_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
                <span className="meta">
                  {band.startRow + 1}-{band.endRow + 1} 行
                </span>
                <span className="item-actions">
                  <button onClick={() => doc.moveBand(index, -1)} disabled={index === 0}>
                    上移
                  </button>
                  <button
                    onClick={() => doc.moveBand(index, 1)}
                    disabled={index === bands.length - 1}
                  >
                    下移
                  </button>
                  <button onClick={() => doc.removeBand(index)} disabled={bands.length <= 1}>
                    删除
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="form-actions">
            <select
              value={addKind}
              onChange={(event) => setAddKind(event.target.value as BandKind)}
            >
              {BAND_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {BAND_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
            <button className="primary" onClick={() => doc.addBand(addKind)}>
              追加波段
            </button>
          </div>
          <p className="hint">明细波段在画布上以淡蓝底色标记；拾取模式下点选画布格编辑字段绑定</p>
          <label className="pick-toggle">
            <input type="checkbox" checked={pickMode} onChange={togglePickMode} />
            拾取模式（选区拦截）
          </label>
          <BindingEditor
            doc={doc}
            addr={editingAddr}
            onEdited={() => canvasRef.current?.refresh()}
          />
        </section>

        <section className="panel canvas-panel">
          <h2>画布（配置态：只显示占位符，不填充数据）</h2>
          <div className="toolbar-row">
            <label className="pick-toggle">
              <input
                type="checkbox"
                checked={guides !== null}
                onChange={() => setGuides(guides ? null : DEFAULT_PAPER_GUIDES)}
              />
              纸张参考线
            </label>
            {guides ? (
              <>
                <label>
                  纸张{' '}
                  <select
                    value={guides.paperSize}
                    onChange={(event) =>
                      setGuides({ ...guides, paperSize: event.target.value as PrintPaperPreset })
                    }
                  >
                    <option value="A3">A3</option>
                    <option value="A4">A4</option>
                    <option value="A5">A5</option>
                    <option value="Letter">Letter</option>
                  </select>
                </label>
                <label>
                  方向{' '}
                  <select
                    value={guides.orientation}
                    onChange={(event) =>
                      setGuides({
                        ...guides,
                        orientation: event.target.value as PrintOrientation,
                      })
                    }
                  >
                    <option value="portrait">纵向</option>
                    <option value="landscape">横向</option>
                  </select>
                </label>
              </>
            ) : null}
            <span className="meta">分页参考线仅设计参照，不写入模板；真实分页以打印预览为准</span>
          </div>
          <div ref={mountRef} className="canvas-mount" />
        </section>
      </div>
      {printOpen ? (
        <PrintDialog
          doc={doc}
          title={templateName.trim() || '打印单'}
          onClose={() => setPrintOpen(false)}
        />
      ) : null}
    </div>
  )
}
