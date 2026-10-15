// 打印输出（P2）：构建文档 HTML → 隐藏 iframe 装载 → 调起打印 →
// afterprint 清理 iframe（ureport2 preview.js 的 iframe + print CSS 兜底路线）。
// 本模块是 print 链路唯一触 DOM 的环节：print 调用经 PrintHooks 可注入（测试与宿主
// 替换真实 print）；构建/求值函数在 page-html/header-footer，headless 不触 DOM。

import { buildPrintDocumentHtml } from './page-html'
import type { PrintConfig, PrintSource } from './types'

/** iframe load 等待上限：load 事件缺失的环境（部分测试引擎）降级直通，不永久挂起 */
const IFRAME_LOAD_TIMEOUT_MS = 5_000

/** afterprint 兜底清理时限：Firefox/Safari 的 print() 异步返回且部分环境不触发
 * afterprint，届时由本定时器回收 iframe（printThis 的 printDelay + 删除兜底同思路） */
const CLEANUP_FALLBACK_MS = 60_000

/** print 钩子（均可选；测试注入桩断言真实调用，宿主可接管打印对话框） */
export interface PrintHooks {
  /**
   * 打印触发（缺省 iframe.contentWindow.print()——iframe 文档独立于宿主页面，
   * 打印只含报表内容）。返回 Promise 时等待其完成后再清理。
   */
  print?: (iframe: HTMLIFrameElement) => void | Promise<void>
}

/** 装载 iframe 内容（srcdoc）并等待 load（超时降级直通） */
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

/**
 * 打印输出（触 DOM 环节）：分页 + 页面构建（headless）→ 隐藏 iframe 装载 → 调起打印
 * → afterprint / 兜底定时器清理 iframe（幂等，先到先清理）。
 * 无 DOM 环境（SSR/纯测试）直接抛错——headless 消费方请用 buildPrintDocumentHtml。
 *
 * 清理时机按路径区分：print() 在 Chrome 同步阻塞到对话框关闭，但在 Firefox/Safari
 * 异步返回——返回即移除 iframe 会截断未完成的打印任务打出空白（printThis /
 * react-to-print 的既有坑）。故真实打印路径不在返回时清理，交给 afterprint +
 * 兜底定时器；钩子路径（测试/宿主接管）保持钩子返回/抛错后立即清理。
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
  // 离屏定位而非 visibility/display 隐藏：隐藏态 iframe 在部分 WebKit 版本打印为空白
  iframe.setAttribute('style', 'position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;')
  document.body.appendChild(iframe)

  let cleaned = false
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined
  const cleanup = (): void => {
    if (cleaned) {
      return
    }
    cleaned = true
    if (fallbackTimer !== undefined) {
      clearTimeout(fallbackTimer)
    }
    iframe.remove()
  }
  const armCleanup = (): void => {
    iframe.contentWindow?.addEventListener?.('afterprint', cleanup, { once: true })
    fallbackTimer = setTimeout(cleanup, CLEANUP_FALLBACK_MS)
  }

  await loadIframe(iframe, html)
  armCleanup()
  if (hooks?.print) {
    try {
      await hooks.print(iframe)
    } finally {
      cleanup()
    }
    return
  }
  iframe.contentWindow?.focus?.()
  iframe.contentWindow?.print?.()
}
