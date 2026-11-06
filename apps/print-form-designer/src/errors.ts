// 异常 → 展示文案的唯一样板，以及「就地报错的编辑动作」包装。
// 数据面板、绑定面板、区域弹框、打印弹框与重塑管线的错误呈现全部经这里，
// 避免同一段三元 / try-catch 在各处复制后文案与行为慢慢走偏。
export function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * 执行一次可能抛错的编辑动作：成功清空错误文案，失败把异常文案交给 setError。
 * 区域列表与区域弹框的每个按钮都走这条，报错只落在就地提示条、不冒到 React。
 */
export function runGuarded(setError: (message: string) => void, action: () => void): void {
  try {
    action()
    setError('')
  } catch (cause) {
    setError(describeError(cause))
  }
}
