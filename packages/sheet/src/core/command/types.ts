/**
 * 命令系统类型定义（自 sheet-core 迁入的底座部分）。
 *
 * 本文件先只携带底座（cell-meta / cell-meta-store）所需的 `StructureChange`；
 * 其余命令系统类型（Patch / Mutation / Command 等）随命令骨架迁入时补全。
 */

/** 结构变更（行列插入/删除；undo = 反向结构操作，见 Sheet.reverseStructureChange） */
export type StructureChange =
  | { kind: 'insert-rows'; at: number; count: number }
  | { kind: 'delete-rows'; at: number; count: number }
  | { kind: 'insert-cols'; at: number; count: number }
  | { kind: 'delete-cols'; at: number; count: number }
