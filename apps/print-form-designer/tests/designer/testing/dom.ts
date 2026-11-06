// happy-dom DOM 面夹具：bun test 不支持 vitest 的环境注释，需要 DOM 的用例显式调用
// setupDom() 把 happy-dom 的构造器与浏览器 API 挂到 globalThis。
// canvas 2d 上下文 happy-dom 不实现，按 sheet 包 tests/grid/canvas-mock.ts 的最小口径 mock：
// measureText 按字符宽估，其余绘制方法无操作（painter 断言只看调用序列，不看像素）。
import { Window } from 'happy-dom'

const win = new Window()

/** happy-dom 的 window 实例（需要 DOMParser 等非全局构造器时用） */
export const domWindow = win

/** 挂载 happy-dom DOM 面与 canvas 2d 桩（每个测试文件调一次，幂等） */
export function setupDom(): void {
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    HTMLElement: win.HTMLElement,
    HTMLCanvasElement: win.HTMLCanvasElement,
    HTMLInputElement: win.HTMLInputElement,
    HTMLTextAreaElement: win.HTMLTextAreaElement,
    HTMLIFrameElement: win.HTMLIFrameElement,
    Node: win.Node,
    Event: win.Event,
    MouseEvent: win.MouseEvent,
    KeyboardEvent: win.KeyboardEvent,
    WheelEvent: win.WheelEvent,
    CustomEvent: win.CustomEvent,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    devicePixelRatio: 1,
  })
  setupCanvasContextMock()
}

/** getContext('2d') 最小 mock：measureText 按字符宽估，其余绘制方法无操作 */
function setupCanvasContextMock(): void {
  const store: Record<string | symbol, unknown> = {}
  const context = new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (prop === 'measureText') return (text: unknown) => ({ width: String(text).length * 8 })
      return () => {}
    },
    set(target, prop, value) {
      target[prop] = value
      return true
    },
  })
  const proto = win.HTMLCanvasElement.prototype
  proto.getContext = ((contextId: string) =>
    contextId === '2d' ? context : null) as typeof proto.getContext
}
