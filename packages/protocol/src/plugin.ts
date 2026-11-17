// 插件统一注册路径：插件契约与挂载 / 卸载生命周期，注册即生效。
// 具体插件实现在 packages/plugins（@infinitable/plugins：chart、print、watermark）。
// 挂载参数为引擎装配协议面（EngineAssembly）：插件只依赖中立装配原语
// （渲染宿主 / 视口尺寸 / 主题 / painter 槽位 / 能力探测 / 生命周期），不绑定具体引擎类型。
//
// 插件分三类（挂载点即分类，不另建并行插件系统）：
// 1. 协议插件：实现本契约，mount 只收 EngineAssembly——任意引擎可挂（watermark / print）。
// 2. 领域面插件：消费某引擎领域面的组合模块。
// 3. 注册表插件：经注册表写入实现的扩展（编辑器、公式函数注册表、媒体解析器）。

import type { EngineAssembly } from './engine'

export interface EnginePlugin {
  readonly name: string
  /** 挂载：构造传入或引擎 use() 注册时调用；可返回清理函数（函数属性写法强制逆变检查） */
  readonly mount: (engine: EngineAssembly) => void | (() => void)
  /** 卸载：引擎销毁或 unuse() 时调用 */
  readonly unmount?: (engine: EngineAssembly) => void
}
