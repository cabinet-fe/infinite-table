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

import { fetchDatasetRowsBulk } from '../data/dataset-service'
import type { FormDoc } from '../domain/form-doc'
import { collectDatasetIds, preparePrintSession, type PrintSession } from './print-source'
import { IconClose, IconPrint } from '../ui/icons'
import { describeError } from '../errors'

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

interface Props {
  doc: FormDoc
  /** 打印文档名（页面标题缺省源；模板名由设计页传入） */
  title: string
  onClose: () => void
}

export function PrintDialog({ doc, title, onClose }: Props) {
  const [settings, setSettings] = useState<DialogPrintSettings>(() => ({
    ...DEFAULT_PRINT_SETTINGS,
    // 重复表头不再由数据块（已移除的 repeat）推导，只作为弹框内的手动配置（缺省 0）
    headerRepeatRows: 0,
  }))
  const [session, setSession] = useState<PrintSession | null>(null)
  const [error, setError] = useState('')
  const [printing, setPrinting] = useState(false)

  // 打开时取数一次（取数走统一服务，含并发去重）：数据块数据源与聚合入参引用的
  // 数据集各自执行，构建稳定打印会话；弹框内配置变化只重算预览，不重新取数
  useEffect(() => {
    let cancelled = false
    fetchDatasetRowsBulk(collectDatasetIds(doc))
      .then((rowsByDataset) => {
        if (cancelled) return
        setSession(preparePrintSession(doc, rowsByDataset, title))
        setError('')
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeError(cause))
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
        error: describeError(cause),
      }
    }
  }, [session, settings])

  const runPrint = (): void => {
    if (!session || !preview?.config || printing) return
    setPrinting(true)
    session
      .print(preview.config)
      .catch((cause: unknown) => setError(describeError(cause)))
      .finally(() => setPrinting(false))
  }

  const patch = (part: Partial<DialogPrintSettings>): void =>
    setSettings((prev) => ({ ...prev, ...part }))

  return (
    <div className="print-dialog-overlay">
      <div className="print-dialog" role="dialog" aria-modal="true" aria-label="打印预览">
        <div className="print-dialog-bar">
          <h2>打印预览</h2>
          <span className="doc-name" title={title}>
            {title}
          </span>
          <span className="meta pages-badge">{preview ? `共 ${preview.pages} 页` : '取数中…'}</span>
          <button type="button" className="bar-close" onClick={onClose} title="关闭打印预览（Esc）">
            <IconClose />
            关闭
          </button>
        </div>

        <div className="print-dialog-body">
          <section className="print-dialog-config">
            <div className="print-config-group">
              <h3>纸张</h3>
              <label>
                纸张
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
                方向
                <select
                  value={settings.orientation}
                  onChange={(event) =>
                    patch({ orientation: event.target.value as PrintOrientation })
                  }
                >
                  <option value="portrait">纵向</option>
                  <option value="landscape">横向</option>
                </select>
              </label>
            </div>

            <div className="print-config-group">
              <h3>布局</h3>
              <label>
                边距（px）
                <input
                  type="number"
                  min={0}
                  value={settings.marginPx}
                  onChange={(event) => patch({ marginPx: Number(event.target.value) || 0 })}
                />
              </label>
              <label>
                缩放
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
                  百分比（%）
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={settings.percent}
                    onChange={(event) => patch({ percent: Number(event.target.value) || 100 })}
                  />
                </label>
              ) : null}
            </div>

            <div className="print-config-group">
              <h3>分页</h3>
              <label>
                分页模式
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
                  每页行数（含表头）
                  <input
                    type="number"
                    min={1}
                    value={settings.fixRows}
                    onChange={(event) => patch({ fixRows: Number(event.target.value) || 0 })}
                  />
                </label>
              ) : null}
              <label>
                重复表头行数
                <input
                  type="number"
                  min={0}
                  value={settings.headerRepeatRows}
                  onChange={(event) => patch({ headerRepeatRows: Number(event.target.value) || 0 })}
                />
              </label>
              <label>
                分组换页列（1 起）
                <input
                  type="number"
                  min={1}
                  value={settings.groupBreakCol}
                  onChange={(event) =>
                    patch({
                      groupBreakCol: event.target.value === '' ? '' : Number(event.target.value),
                    })
                  }
                />
              </label>
              <p className="meta config-note">这些配置只在本次打印生效，不会写入模板。</p>
            </div>
          </section>

          <div className="print-dialog-stage">
            {error ? (
              <p className="status error">{error}</p>
            ) : preview?.error ? (
              <p className="status error">{preview.error}</p>
            ) : preview?.html ? (
              <iframe title="打印预览" srcDoc={preview.html} />
            ) : (
              <p className="stage-placeholder">正在生成预览…</p>
            )}
          </div>
        </div>

        <div className="print-dialog-foot">
          <span className="meta">预览与打印输出同一份渲染产物，所见即所打。</span>
          <button
            type="button"
            className="primary"
            disabled={!preview || !!preview.error || !!error || printing}
            onClick={runPrint}
          >
            {printing ? (
              '打印中…'
            ) : (
              <>
                <IconPrint />
                打印
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
