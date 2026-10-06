// 打印预览 DOM 薄壳（P3）：openPrintPreview(source, config)——页面缩略列表 + 当前页
// 放大预览 + 打印按钮的轻量弹层。无框架依赖、样式内联在弹层内（选择器全部锚定
// .print-preview- 前缀，弹层移除即随文档消失，不泄漏宿主页面）；关闭（按钮/ESC/
// 背景点击/handle.close）即清理。逐页内容 = buildPrintPageHtml 片段 + 从
// buildPrintDocumentHtml 提取的文档级 CSS（与真实打印输出同一份样式，所见即所得），
// 装进独立 iframe 隔离渲染（@page/body 规则不进宿主文档）。打印按钮汇到 printPages
// （print 钩子透传，宿主可注入桩接管）。分层：headless 内核（P1/P2）不反向依赖本
// 薄壳，宿主可只用 headless（meta 先例）。

import { buildPrintDocumentHtml, buildPrintPageHtml } from './page-html'
import { paginate, type PrintPage } from './paginate'
import { derivePrintableArea } from './paper'
import { printPages, type PrintHooks } from './print-output'
import type { PrintConfig, PrintSource } from './types'

/** 预览句柄：关闭并清理弹层（幂等）；预览自身交互（缩略切换/打印）走弹层内按钮 */
export interface PrintPreviewHandle {
  close(): void
}

/** 弹层内样式（选择器全部锚定弹层根类，不命中宿主页面任何元素） */
const PREVIEW_CSS = [
  '.print-preview-overlay { position: fixed; inset: 0; z-index: 1000; display: flex;',
  '  align-items: center; justify-content: center; background: rgba(15, 17, 23, 0.55);',
  '  font-family: Arial, "PingFang SC", "Microsoft YaHei", sans-serif; }',
  '.print-preview-dialog { display: flex; flex-direction: column; width: min(1180px, calc(100vw - 48px));',
  '  height: calc(100vh - 48px); background: #ffffff; border-radius: 12px; overflow: hidden; }',
  '.print-preview-bar { flex: none; display: flex; align-items: center; gap: 12px;',
  '  padding: 10px 16px; border-bottom: 1px solid #e5e7eb; }',
  '.print-preview-title { font-size: 14px; font-weight: 700; color: #1f2329;',
  '  max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '.print-preview-indicator { flex: 1; text-align: right; font-size: 12px; color: #6b7280; }',
  '.print-preview-close { flex: none; width: 28px; height: 28px; border: 1px solid #e5e7eb;',
  '  border-radius: 6px; background: #fff; color: #6b7280; font-size: 14px; line-height: 1;',
  '  cursor: pointer; }',
  '.print-preview-body { flex: 1; display: flex; min-height: 0; }',
  '.print-preview-thumbs { flex: none; width: 136px; overflow-y: auto; padding: 8px;',
  '  display: flex; flex-direction: column; gap: 6px; background: #f9fafb;',
  '  border-right: 1px solid #e5e7eb; }',
  '.print-preview-thumb { border: 1px solid #e5e7eb; border-radius: 8px; background: #fff;',
  '  padding: 8px 10px; text-align: left; cursor: pointer; }',
  '.print-preview-thumb-page { display: block; font-size: 12px; font-weight: 700; color: #1f2329; }',
  '.print-preview-thumb-rows { display: block; font-size: 11px; color: #9ca3af; margin-top: 2px; }',
  '.print-preview-thumb.active { border-color: #6366f1; box-shadow: inset 0 0 0 1px #6366f1; }',
  '.print-preview-stage { flex: 1; overflow: auto; padding: 16px; background: #eef0f4; }',
  '.print-preview-paper { background: #fff; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18); }',
  '.print-preview-paper iframe { display: block; width: 100%; height: 100%; border: 0; }',
  '.print-preview-foot { flex: none; display: flex; align-items: center; gap: 12px;',
  '  padding: 10px 16px; border-top: 1px solid #e5e7eb; }',
  '.print-preview-tip { flex: 1; font-size: 12px; color: #6b7280; }',
  '.print-preview-print { flex: none; padding: 6px 18px; border: 0; border-radius: 8px;',
  '  background: #6366f1; color: #fff; font-size: 13px; cursor: pointer; }',
  '.print-preview-print:disabled { opacity: 0.6; cursor: default; }',
].join('')

/** 建元素捷径（className/text 一次给足，弹层 DOM 全部静态文本 → 无需转义） */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) {
    node.className = className
  }
  if (text !== undefined) {
    node.textContent = text
  }
  return node
}

/** 从完整打印文档提取文档级 CSS（buildDocumentCss 唯一产物位，与打印输出同源同款） */
function extractDocumentCss(documentHtml: string): string {
  const start = documentHtml.indexOf('<style>')
  const end = documentHtml.indexOf('</style>', start)
  if (start < 0 || end < 0) {
    return ''
  }
  return documentHtml.slice(start + '<style>'.length, end)
}

/** 单页预览文档：文档级 CSS + 当前页片段（独立 iframe 内渲染，@page 规则不外溢） */
function pageDocumentHtml(css: string, pageHtml: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<style>${css}</style></head><body>${pageHtml}</body></html>`
  )
}

/** 缩略行区间标注（源表数据行 1 起计；空表兜底页无数据行） */
function thumbRowsLabel(page: PrintPage | null): string {
  if (!page) {
    return '空表'
  }
  return `行 ${page.rowRange.start + 1}–${page.rowRange.end}`
}

/**
 * 打开打印预览弹层（触 DOM 环节）：分页结果 → 缩略列表 + 当前页放大预览（iframe
 * 逐页装载打印 CSS 与页面片段）+ 打印按钮（汇到 printPages，print 钩子透传）。
 * 返回句柄供宿主编程关闭；弹层内关闭按钮/ESC/背景点击等效，均幂等清理。
 */
export function openPrintPreview(
  source: PrintSource,
  config: PrintConfig,
  hooks?: PrintHooks,
): PrintPreviewHandle {
  if (typeof document === 'undefined') {
    throw new Error(
      'openPrintPreview 需要浏览器 DOM 环境（headless 场景消费 paginate/buildPrintPageHtml）',
    )
  }

  const pages = paginate(source, config)
  const documentHtml = buildPrintDocumentHtml(source, config)
  const css = extractDocumentCss(documentHtml)
  // 空表兜底：分页为空时直接预览整文档（buildPrintDocumentHtml 自带空表页）
  const pageHtmls =
    pages.length > 0
      ? pages.map((page, index) =>
          pageDocumentHtml(css, buildPrintPageHtml(source, config, page, index + 1, pages.length)),
        )
      : [documentHtml]
  const pageCount = pageHtmls.length

  const overlay = el('div', 'print-preview-overlay')
  const style = document.createElement('style')
  style.textContent = PREVIEW_CSS
  overlay.append(style)

  const dialog = el('div', 'print-preview-dialog')
  const bar = el('div', 'print-preview-bar')
  const title = el('span', 'print-preview-title', source.name)
  const indicator = el('span', 'print-preview-indicator')
  const closeButton = el('button', 'print-preview-close', '×')
  closeButton.type = 'button'
  closeButton.setAttribute('aria-label', '关闭打印预览')
  bar.append(title, indicator, closeButton)

  const body = el('div', 'print-preview-body')
  const thumbs = el('div', 'print-preview-thumbs')
  const stage = el('div', 'print-preview-stage')
  const paper = el('div', 'print-preview-paper')
  const frame = document.createElement('iframe')
  frame.title = '打印页面预览'
  const area = derivePrintableArea(config)
  paper.style.width = `${Math.round(area.pageWidth)}px`
  paper.style.height = `${Math.round(area.pageHeight)}px`
  paper.appendChild(frame)
  stage.appendChild(paper)
  body.append(thumbs, stage)

  const foot = el('div', 'print-preview-foot')
  const tip = el('span', 'print-preview-tip', '打印按钮经隐藏 iframe 装载全部页面后调起打印')
  const printButton = el('button', 'print-preview-print', '打印')
  printButton.type = 'button'
  foot.append(tip, printButton)

  dialog.append(bar, body, foot)
  overlay.appendChild(dialog)

  // 缩略列表与当前页联动（缩略点击切换 / 指示行刷新 / active 标记迁移）
  const thumbButtons = pageHtmls.map((_, index) => {
    const button = el('button', 'print-preview-thumb')
    button.type = 'button'
    button.appendChild(el('span', 'print-preview-thumb-page', `第 ${index + 1} 页`))
    button.appendChild(el('span', 'print-preview-thumb-rows', thumbRowsLabel(pages[index] ?? null)))
    button.addEventListener('click', () => select(index))
    thumbs.appendChild(button)
    return button
  })
  const select = (index: number): void => {
    frame.srcdoc = pageHtmls[index]!
    indicator.textContent = `第 ${index + 1} 页 / 共 ${pageCount} 页`
    thumbButtons.forEach((button, i) => {
      button.classList.toggle('active', i === index)
    })
  }
  select(0)

  // 关闭：按钮/ESC/背景点击三入口归一，幂等清理（样式随弹层根一并移除）
  let closed = false
  const close = (): void => {
    if (closed) {
      return
    }
    closed = true
    document.removeEventListener('keydown', onKeyDown)
    overlay.remove()
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      close()
    }
  }
  closeButton.addEventListener('click', close)
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close()
    }
  })
  document.addEventListener('keydown', onKeyDown)

  // 打印按钮 → printPages（重防连点；失败信息回落指示行，不吞错）
  printButton.addEventListener('click', () => {
    if (printButton.disabled) {
      return
    }
    printButton.disabled = true
    void printPages(source, config, hooks)
      .catch((error: unknown) => {
        indicator.textContent = `打印失败：${error instanceof Error ? error.message : String(error)}`
      })
      .finally(() => {
        printButton.disabled = false
      })
  })

  document.body.appendChild(overlay)
  return { close }
}
