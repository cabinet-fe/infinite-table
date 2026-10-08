// workspace 级 UI 桥（React 各面板把可被引擎侧/快捷键触达的入口回填进来）：
// 快捷键（撤销/重做/查找）与切表联动经桥调用，避免面板间互相持有句柄。

export interface SheetUiBridge {
  /** Ctrl/Cmd+F：切换查找替换面板 */
  toggleFind(): void
  /** 刷新工具栏按钮态（撤销/重做/样式激活态） */
  refreshToolbar(): void
  /** 立即重取观察区快照（撤销/重做回写后） */
  refreshInspector(): void
  /** 公式栏刷新显示（切表 / book 重建后） */
  refreshFormula(): void
  /** 函数面板插入落点：写入公式栏输入区 */
  insertFormulaSnippet(name: string): void
  /** id → 展示名（含 tabs 本地重命名；观察区 meta 用，由 tabs 面板回填） */
  labelOf?: (id: string) => string
}

const noop = (): void => {}

export function createSheetUiBridge(): SheetUiBridge {
  return {
    toggleFind: noop,
    refreshToolbar: noop,
    refreshInspector: noop,
    refreshFormula: noop,
    insertFormulaSnippet: noop,
  }
}
