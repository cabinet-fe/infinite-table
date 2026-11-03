// 插件统一注册路径：插件契约与挂载 / 卸载生命周期，注册即生效。
// 具体插件实现在 packages/plugins（@infinitable/plugins：chart、print、watermark）。
// 挂载参数为引擎装配协议面（EngineAssembly，P7）：插件只依赖中立装配原语
// （渲染宿主 / 数据面 / 主题 / painter 槽位 / 生命周期），不绑定具体引擎类型与
// 事件类型（G2/G21）；表格领域操作由插件按需窄化到 TableEngine（table 公共面）。
//
// 插件分三类（挂载点即分类，不另建并行插件系统）：
// 1. 协议插件：实现本契约，mount 只收 EngineAssembly——任意引擎可挂
//    （watermark / print）。跨引擎生效是这一类的判据。
// 2. 领域面插件：不实现本契约，而是消费某引擎领域面的组合模块
//    （chart 经 ListTableOptions.chartMediaResolver 构造缝注入）。判据：挂载依赖
//    特定引擎的领域 API，换引擎即失效。
// 3. 注册表插件：经注册表写入实现的扩展（editor-registry 编辑器、公式函数注册表、
//    媒体解析器）。判据：注册即插拔，机制不换只换实现。

import type { EngineAssembly } from './engine'

export interface EnginePlugin {
  readonly name: string
  /** 挂载：构造传入或引擎 use() 注册时调用，注册即生效；参数为协议装配面 */
  mount(engine: EngineAssembly): void
  /** 卸载：引擎销毁时按注册逆序调用 */
  unmount?(engine: EngineAssembly): void
}
