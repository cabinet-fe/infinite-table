// 演示侧值写路径的撤销命令接线：填充/查找替换/清空等内容变更直写 SheetStore，
// 不经过引擎编辑会话（onCellChange 不触发，bindCellChangeUndo 捕捉不到），
// 统一经 applyValueWrites 落栈——命令口径与 bindCellChangeUndo 一致
// （undo 回写旧值 / redo 回写新值；结构/样式/尺寸命令不入栈）。

import type { SheetStore, UndoCommand, UndoStack } from '@infinite-table/plugins'

/** 单格值写入（value 为新值） */
export interface ValueWrite {
  col: number
  row: number
  value: unknown
}

/**
 * 批量写值并入栈一条值命令（组合命令整体回退/重做）。
 * 同格多写按末次为准；新值与现值相同的格不写也不入命令。
 */
export function applyValueWrites(
  store: SheetStore,
  stack: UndoStack,
  writes: readonly ValueWrite[],
): void {
  // 末次为准：同格重复写只留最终新值
  const targets = new Map<string, ValueWrite>()
  for (const write of writes) {
    targets.set(`${write.col},${write.row}`, write)
  }
  const commands: UndoCommand[] = []
  for (const write of targets.values()) {
    const oldValue = store.getValue(write.col, write.row)
    if (oldValue === write.value) {
      continue
    }
    store.setValue(write.col, write.row, write.value)
    commands.push({
      undo: () => store.setValue(write.col, write.row, oldValue),
      redo: () => store.setValue(write.col, write.row, write.value),
    })
  }
  if (commands.length > 0) {
    stack.push(commands)
  }
}
