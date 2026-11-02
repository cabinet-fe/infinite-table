// 打印产物预览构建（PrintPage / PrintFormPage 共用）：分页信息 + 从 buildDocumentHtml
// 产物经 DOMParser 切出逐页独立文档。文档级 CSS 随独立 iframe 隔离（@page 规则不外溢
// 宿主），纸张容器按预设 mm 尺寸换算显示宽高。

import type { PrintConfig, PrintPaperPreset, PrintPluginHandle } from '@infinitable/plugins'

/** 纸张预设 mm 尺寸（portrait 口径，landscape 交换宽高；预览纸张容器的显示用换算） */
export const PAPER_MM: Record<PrintPaperPreset, [number, number]> = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  Letter: [216, 279],
}

const MM_TO_PX = 96 / 25.4

/** 纸张标注（状态行显示用；预设代号或自定义 mm 尺寸） */
export function paperLabel(paper: PrintConfig['paperSize']): string {
  if (paper === undefined) {
    return 'A4'
  }
  return typeof paper === 'object' ? `自定义 ${paper.widthMm}×${paper.heightMm}mm` : paper
}

/** 预览产物：分页信息（缩略列表标注）+ 逐页独立文档（当前页 iframe 装载） */
export interface PrintPreview {
  pageCount: number
  /** 逐页行区间/补空行标注（源表数据行 1 起计） */
  rowLabels: string[]
  /** 逐页独立文档：文档级 CSS（与打印输出同源）+ 单页片段，所见即所得 */
  pageDocs: string[]
  /** 纸张显示尺寸（px，含边距整页口径） */
  paperWidth: number
  paperHeight: number
}

/**
 * 构建预览：分页结果 + 从完整文档切出逐页文档。config 缺省吃插件自带配置
 * （供数与版面在插件创建时已绑定的调用方，如打印单演示区）。
 */
export function buildPrintPreview(plugin: PrintPluginHandle, config?: PrintConfig): PrintPreview {
  const pages = plugin.paginate(config)
  const parsed = new DOMParser().parseFromString(plugin.buildDocumentHtml(config), 'text/html')
  const css = parsed.querySelector('style')?.textContent ?? ''
  const wrapPage = (html: string): string =>
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`
  const pageDocs =
    pages.length > 0
      ? Array.from(parsed.querySelectorAll('.print-page'), (el) => wrapPage(el.outerHTML))
      : [plugin.buildDocumentHtml(config)] // 空表兜底：整文档（自带空表页）
  const [widthMm, heightMm] =
    PAPER_MM[typeof config?.paperSize === 'string' ? config.paperSize : 'A4']
  const [paperWidthMm, paperHeightMm] =
    config?.orientation === 'landscape' ? [heightMm, widthMm] : [widthMm, heightMm]
  return {
    pageCount: pageDocs.length,
    rowLabels: pages.map(
      (page) =>
        `行 ${page.rowRange.start + 1}–${page.rowRange.end}` +
        (page.blankRows > 0 ? ` · 补空 ${page.blankRows} 行` : ''),
    ),
    pageDocs,
    paperWidth: Math.round(paperWidthMm * MM_TO_PX),
    paperHeight: Math.round(paperHeightMm * MM_TO_PX),
  }
}
