// 插件统一注册路径（预留）：插件接口与挂载/卸载生命周期，注册即生效。
// 具体插件实现在 packages/plugins（@infinitable/plugins：chart、print、watermark）。
// 挂载参数为引擎装配协议面（EngineAssembly，P7）：插件只依赖中立装配原语
// （渲染宿主 / 数据面 / 主题 / painter 槽位 / 生命周期），不绑定具体引擎类型与
// 事件类型（G2/G21）；表格领域操作由插件按需窄化到 TableEngine（table 公共面）。

import type { EngineAssembly } from './engine'

export interface TablePlugin {
  readonly name: string
  /** 挂载：构造传入或引擎 use() 注册时调用，注册即生效；参数为协议装配面 */
  mount(engine: EngineAssembly): void
  /** 卸载：引擎销毁时按注册逆序调用 */
  unmount?(engine: EngineAssembly): void
}
