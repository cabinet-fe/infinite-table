// 最小撤销栈：命令对象（undo/redo 闭包对）+ 组合命令 + 上限丢弃最旧。
// bindCellChangeUndo 把引擎 onCellChange 变更转为「值命令」回写 SheetStore
// （undo setValue(oldValue) / redo setValue(newValue)，经模型事件触发表格局部刷新）；
// 结构命令（冻结/合并/尺寸）由宿主包装命令对象入栈。

import type { CellChangeEvent, ListTable } from '@infinite-table/core'

import type { SheetStore } from './sheet-store'

/** 可撤销命令：undo/redo 均要求幂等可重入 */
export interface UndoCommand {
  label?: string
  undo(): void
  redo(): void
}

export class UndoStack {
  private readonly undoStack: UndoCommand[] = []
  private readonly redoStack: UndoCommand[] = []

  constructor(private readonly limit = 100) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /**
   * 入栈命令（数组=组合命令，整体回退/重做：undo 逆序、redo 正序）。
   * 清空 redo 分支（新命令使重做未来失效）；超限丢最旧。
   */
  push(command: UndoCommand | UndoCommand[]): void {
    const commands = Array.isArray(command) ? command : [command]
    if (commands.length === 0) {
      return
    }
    this.undoStack.push(commands.length === 1 ? commands[0]! : composite(commands))
    this.redoStack.length = 0
    while (this.undoStack.length > this.limit) {
      this.undoStack.shift()
    }
  }

  /** 撤销栈顶命令；空栈为空操作 */
  undo(): void {
    const command = this.undoStack.pop()
    if (!command) {
      return
    }
    command.undo()
    this.redoStack.push(command)
  }

  /** 重做栈顶命令；空栈为空操作 */
  redo(): void {
    const command = this.redoStack.pop()
    if (!command) {
      return
    }
    command.redo()
    this.undoStack.push(command)
  }

  clear(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
  }
}

/** 组合命令：undo 逆序回退、redo 正序重做 */
function composite(commands: UndoCommand[]): UndoCommand {
  return {
    undo: () => {
      for (let i = commands.length - 1; i >= 0; i--) {
        commands[i]?.undo()
      }
    },
    redo: () => {
      for (const command of commands) {
        command.redo()
      }
    },
  }
}

export interface CellChangeUndoOptions {
  table: ListTable
  store: SheetStore
  stack: UndoStack
}

export interface CellChangeUndoBinding {
  stack: UndoStack
  dispose(): void
}

/**
 * 引擎编辑提交 → 值命令入栈：
 * undo 回写 oldValue、redo 回写 newValue。回写经 store.setValue 直写模型
 * （模型事件 → 引擎局部刷新），不经过引擎编辑会话，因此不再触发 onCellChange
 * ——撤销产生的回写天然不会生成新命令，无回环。
 */
export function bindCellChangeUndo(options: CellChangeUndoOptions): CellChangeUndoBinding {
  const unsubscribe = options.table.onCellChange((change: CellChangeEvent) => {
    options.stack.push({
      undo: () => options.store.setValue(change.col, change.row, change.oldValue),
      redo: () => options.store.setValue(change.col, change.row, change.newValue),
    })
  })
  return { stack: options.stack, dispose: unsubscribe }
}
