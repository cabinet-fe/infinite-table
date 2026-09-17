// 插件统一注册路径（预留）：插件接口与挂载/卸载生命周期，注册即生效。
// 具体插件实现（custom-cell-style、invert-highlight 等）在 packages/plugins（规划包）落地。

import type { ListTable } from './list-table'

export interface TablePlugin {
  readonly name: string
  /** 挂载：构造传入或 table.use() 注册时调用，注册即生效 */
  mount(table: ListTable): void
  /** 卸载：表格销毁时按注册逆序调用 */
  unmount?(table: ListTable): void
}
