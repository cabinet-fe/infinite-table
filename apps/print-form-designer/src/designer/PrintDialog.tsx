// 打印弹框（P8）：设计页打印按钮唤起。弹框内配置纸张/方向/边距/缩放/分页项并
// 即时 HTML 预览（iframe 装载与打印输出同一份文档产物），确认后经 print 插件
// 隐藏 iframe 调起打印。配置只存本组件 React 状态（弹框运行态），FormDoc 无任何
// 写入路径——模板 JSON 永不含纸张/边距/缩放/分页字段（app 内测试断言锁死）。
import { useEffect, useMemo, useState } from 'react'

import type {
  PrintConfig,
  PrintOrientation,
  PrintPagingMode,
  PrintPaperPreset,
} from '@infinitable/plugins'

import { api, toSourceRows } from '../data/api'
import type { FormDoc } from './form-doc'
import { collectPrintBindings, preparePrintSession, type PrintSession } from './print-source'

/** 弹框打印配置（运行态，不落模板）：与 PrintConfig 的差异只在 UI 便捷形态 */
export interface DialogPrintSettings {
  paper: PrintPaperPreset
  orientation: PrintOrientation
  /** 四边同距页边距（px） */
  marginPx: number
  /** 缩放档：原始尺寸 / 按页宽缩放 / 自定义百分比 */
  scaleMode: 'origin' | 'fit-width' | 'percent'
  /** 自定义缩放百分比（1–1000，scaleMode = percent 时生效） */
  percent: number
  paging: PrintPagingMode
  /** fixrows 模式每页总行数（含重复表头行） */
  fixRows: number
  /** 每页重复的表头行数（取数据态前 N 行） */
  headerRepeatRows: number
  /** 分组换页列（1 起列号；空串 = 不分组） */
  groupBreakCol: number | ''
}

/** 缺省弹框配置：A4 纵向 + 缺省边距 48px（对齐 print paper.ts 缺省） */
export const DEFAULT_PRINT_SETTINGS: Omit<DialogPrintSettings, 'headerRepeatRows'> = {
  paper: 'A4',
  orientation: 'portrait',
  marginPx: 48,
  scaleMode: 'origin',
  percent: 100,
  paging: 'fitpage',
  fixRows: 20,
  groupBreakCol: '',
}

/** 弹框配置 → print 插件 PrintConfig（分组列 1 起转 0 起；fitpage 不带 fixRows） */
export function toPrintConfig(settings: DialogPrintSettings): PrintConfig {
  return {
    paperSize: settings.paper,
    orientation: settings.orientation,
    margin: settings.marginPx,
    scale: settings.scaleMode === 'percent' ? { percent: settings.percent } : settings.scaleMode,
    paging: settings.paging,
    fixRows: settings.paging === 'fixrows' ? settings.fixRows : undefined,
    headerRepeatRows: settings.headerRepeatRows,
    groupBreakBy: settings.groupBreakCol === '' ? undefined : settings.groupBreakCol - 1,
  }
}

/** 缺省重复表头行数：首个波段为页眉时取其行数（页眉波段每页重复的波段语义） */
function leadingPageHeaderRows(doc: FormDoc): number {
  const first = doc.bands[0]
  return first?.kind === 'pageHeader' ? first.endRow - first.startRow + 1 : 0
}

interface Props {
  doc: FormDoc
  /** 打印文档名（页面标题缺省源；模板名由设计页传入） */
  title: string
  onClose: () => void
}

export function PrintDialog({ doc, title, onClose }: Props) {
  const [settings, setSettings] = useState<DialogPrintSettings>(() => ({
    ...DEFAULT_PRINT_SETTINGS,
    headerRepeatRows: leadingPageHeaderRows(doc),
  }))
  const [session, setSession] = useState<PrintSession | null>(null)
  const [error, setError] = useState('')
  const [printing, setPrinting] = useState(false)

  // 打开时取数一次：绑定引用的数据集各自执行，构建稳定打印会话；弹框内配置变化
  // 只重算预览，不重新取数
  useEffect(() => {
    let cancelled = false
    const datasetIds = [...new Set(collectPrintBindings(doc).map((binding) => binding.datasetId))]
    Promise.all(
      datasetIds.map(async (id) => [id, toSourceRows(await api.executeDataset(id))] as const),
    )
      .then((entries) => {
        if (cancelled) return
        setSession(preparePrintSession(doc, new Map(entries), title))
        setError('')
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [doc, title])

  // ESC 关闭（与关闭按钮等效）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // 预览产物：同一会话按当前配置构建（非法组合如 fixRows ≤ 表头行数在此显错，不崩弹框）
  const preview = useMemo(() => {
    if (!session) return null
    try {
      const config = toPrintConfig(settings)
      return {
        config,
        html: session.previewHtml(config),
        pages: session.plugin.paginate(config).length,
        error: '',
      }
    } catch (cause) {
      return {
        config: null,
        html: '',
        pages: 0,
        error: cause instanceof Error ? cause.message : String(cause),
      }
    }
  }, [session, settings])

  const runPrint = (): void => {
    if (!session || !preview?.config || printing) return
    setPrinting(true)
    session
      .print(preview.config)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setPrinting(false))
  }

  const patch = (part: Partial<DialogPrintSettings>): void =>
    setSettings((prev) => ({ ...prev, ...part }))

  return (
    <div className="print-dialog-overlay">
      <div className="print-dialog">
        <div className="print-dialog-bar">
          <h2>打印</h2>
          <span className="meta">{title}</span>
          <span className="meta">{preview ? `共 ${preview.pages} 页` : '取数中…'}</span>
          <button onClick={onClose}>关闭</button>
        </div>
        <div className="print-dialog-body">
          <section className="print-dialog-config">
            <label>
              纸张{' '}
              <select
                value={settings.paper}
                onChange={(event) => patch({ paper: event.target.value as PrintPaperPreset })}
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
                value={settings.orientation}
                onChange={(event) => patch({ orientation: event.target.value as PrintOrientation })}
              >
                <option value="portrait">纵向</option>
                <option value="landscape">横向</option>
              </select>
            </label>
            <label>
              边距（px）{' '}
              <input
                type="number"
                min={0}
                className="num-input"
                value={settings.marginPx}
                onChange={(event) => patch({ marginPx: Number(event.target.value) || 0 })}
              />
            </label>
            <label>
              缩放{' '}
              <select
                value={settings.scaleMode}
                onChange={(event) =>
                  patch({ scaleMode: event.target.value as DialogPrintSettings['scaleMode'] })
                }
              >
                <option value="origin">原始尺寸</option>
                <option value="fit-width">按页宽缩放</option>
                <option value="percent">自定义百分比</option>
              </select>
            </label>
            {settings.scaleMode === 'percent' ? (
              <label>
                百分比（%）{' '}
                <input
                  type="number"
                  min={1}
                  max={1000}
                  className="num-input"
                  value={settings.percent}
                  onChange={(event) => patch({ percent: Number(event.target.value) || 100 })}
                />
              </label>
            ) : null}
            <label>
              分页模式{' '}
              <select
                value={settings.paging}
                onChange={(event) => patch({ paging: event.target.value as PrintPagingMode })}
              >
                <option value="fitpage">按行高</option>
                <option value="fixrows">固定行数</option>
              </select>
            </label>
            {settings.paging === 'fixrows' ? (
              <label>
                每页行数（含表头）{' '}
                <input
                  type="number"
                  min={1}
                  className="num-input"
                  value={settings.fixRows}
                  onChange={(event) => patch({ fixRows: Number(event.target.value) || 0 })}
                />
              </label>
            ) : null}
            <label>
              重复表头行数{' '}
              <input
                type="number"
                min={0}
                className="num-input"
                value={settings.headerRepeatRows}
                onChange={(event) => patch({ headerRepeatRows: Number(event.target.value) || 0 })}
              />
            </label>
            <label>
              分组换页列（1 起）{' '}
              <input
                type="number"
                min={1}
                className="num-input"
                value={settings.groupBreakCol}
                onChange={(event) =>
                  patch({
                    groupBreakCol: event.target.value === '' ? '' : Number(event.target.value),
                  })
                }
              />
            </label>
            <p className="meta">配置仅在本弹框生效，不写入模板</p>
          </section>
          <div className="print-dialog-stage">
            {error ? (
              <p className="status error">{error}</p>
            ) : preview?.error ? (
              <p className="status error">{preview.error}</p>
            ) : (
              <iframe title="打印预览" srcDoc={preview?.html ?? ''} />
            )}
          </div>
        </div>
        <div className="print-dialog-foot">
          <span className="meta">预览与打印输出同一份渲染产物（同输入同输出）</span>
          <button
            className="primary"
            disabled={!preview || !!preview.error || !!error || printing}
            onClick={runPrint}
          >
            {printing ? '打印中…' : '打印'}
          </button>
        </div>
      </div>
    </div>
  )
}
