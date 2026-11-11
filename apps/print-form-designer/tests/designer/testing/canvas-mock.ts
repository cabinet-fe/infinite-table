// canvas 2d 桩：happy-dom（// @vitest-environment happy-dom）不实现 canvas 2d 上下文，
// 按 sheet 包 tests/grid/canvas-mock.ts 的最小口径在环境自带的 HTMLCanvasElement 上打补丁：
// measureText 按字符宽估，其余绘制方法无操作（painter 断言只看调用序列，不看像素）。
// 需要画布的测试文件在模块顶层调用一次（幂等，上下文全局共享）。
export function setupCanvasMock(): void {
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
  const proto = HTMLCanvasElement.prototype
  proto.getContext = ((contextId: string) =>
    contextId === '2d' ? context : null) as typeof proto.getContext
}
