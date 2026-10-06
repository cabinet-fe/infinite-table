// 打印输出（P2）：构建文档 HTML → 隐藏 iframe 装载 → 等待图片 decode → 调起打印 →
// afterprint 清理 iframe（ureport2 preview.js 的 iframe + print CSS 兜底路线）。
// 本模块是 print 链路唯一触 DOM 的环节：print 调用经 PrintHooks 可注入（测试与宿主
// 替换真实 print）；构建/求值函数在 page-html/header-footer，headless 不触 DOM。

import { buildPrintDocumentHtml } from './page-html'
import type { PrintConfig, PrintSource } from './types'

/** iframe load 等待上限：load 事件缺失的环境（部分测试引擎）降级直通，不永久挂起 */
const IFRAME_LOAD_TIMEOUT_MS = 5_000

/** print 钩子（均可选；测试注入桩断言真实调用，宿主可接管打印对话框） */
export interface PrintHooks {
  /**
   * 打印触发（缺省 iframe.contentWindow.print()——iframe 文档独立于宿主页面，
   * 打印只含报表内容）。返回 Promise 时等待其完成后再清理。
   */
  print?: (iframe: HTMLIFrameElement) => void | Promise<void>
}

/** 装载 iframe 内容（srcdoc）并等待 load（超时降级直通，图片等待交给下一步） */
function loadIframe(iframe: HTMLIFrameElement, html: string): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (): void => {
      if (!settled) {
        settled = true
        resolve()
      }
    }
    iframe.addEventListener('load', settle, { once: true })
    setTimeout(settle, IFRAME_LOAD_TIMEOUT_MS)
    iframe.srcdoc = html
  })
}

/** 等待文档内图片 decode（浮动图 data URL 内嵌时的装载完成信号；decode 不可用即跳过） */
async function waitForImages(iframe: HTMLIFrameElement): Promise<void> {
  const doc = iframe.contentDocument
  if (!doc?.querySelectorAll) {
    return
  }
  const images = Array.from(doc.querySelectorAll('img'))
  await Promise.all(
    images.map(async (image) => {
      if (image.complete || typeof image.decode !== 'function') {
        return
      }
      try {
        await image.decode()
      } catch {
        // 单图装载失败不阻塞打印（浏览器按破损图处理）
      }
    }),
  )
}

/**
 * 打印输出（触 DOM 环节）：分页 + 页面构建（headless）→ 隐藏 iframe 装载 → 图片
 * decode 等待 → 调起打印 → afterprint / print 返回后清理 iframe（幂等，先到先清理）。
 * 无 DOM 环境（SSR/纯测试）直接抛错——headless 消费方请用 buildPrintDocumentHtml。
 */
export async function printPages(
  source: PrintSource,
  config: PrintConfig,
  hooks?: PrintHooks,
): Promise<void> {
  const html = buildPrintDocumentHtml(source, config)
  if (typeof document === 'undefined') {
    throw new Error('printPages 需要浏览器 DOM 环境（headless 场景消费 buildPrintDocumentHtml）')
  }

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute(
    'style',
    'position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;visibility:hidden;',
  )
  document.body.appendChild(iframe)

  let cleaned = false
  const cleanup = (): void => {
    if (!cleaned) {
      cleaned = true
      iframe.remove()
    }
  }

  try {
    await loadIframe(iframe, html)
    await waitForImages(iframe)
    // afterprint 到点即清理；桩替换 print（无 afterprint）时由 finally 兜底，幂等不重复
    iframe.contentWindow?.addEventListener?.('afterprint', cleanup, { once: true })
    if (hooks?.print) {
      await hooks.print(iframe)
    } else {
      iframe.contentWindow?.print?.()
    }
  } finally {
    cleanup()
  }
}
