---
'infinitable': minor
---

协议归位：引擎装配协议契约独立为 `@infinitable/protocol` 契约包（纯类型、零运行时），`TablePlugin` 更名 `EnginePlugin`

**破坏性变更（类型层）**：

- 插件契约 `TablePlugin` 更名 `EnginePlugin`（契约成员不变：`name` / `mount(EngineAssembly)` / 可选 `unmount`）。import 语句从 `@infinitable/table` 改为 `@infinitable/protocol`；`infinitable` 主入口同步转出 `EnginePlugin`，旧名不再导出。
- `EngineAssembly` / `EngineReadView` / `UnderlayPainter` / `OverlayPainter` / `CellChangeEvent` 的定义家迁至 `@infinitable/protocol`；`@infinitable/table` 与 `infinitable` 主入口继续转出同名类型，import 路径不变。
- 运行时零变化：契约包为纯类型，无任何运行时代码与行为改动。

**新增**：`EnginePlugin`（主入口与 `@infinitable/protocol` 导出）；插件三分类正式化——协议插件（watermark / print：mount 只收 `EngineAssembly`，任意引擎可挂）、领域面插件（chart：经构造缝注入引擎领域面）、注册表插件（编辑器 / 公式函数 / 媒体解析器），判据见 `@infinitable/protocol` 的 `plugin.ts` 头注。

**动机**：装配契约只有一个家——不消费 `TableEngine` 的引擎与插件（watermark / print、未来的甘特等）不再依赖具体引擎包即可完成契约消费，包图层面兑现「四类平级引擎」。
