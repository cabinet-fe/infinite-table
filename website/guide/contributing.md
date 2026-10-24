# 参与开发

本仓库是 TypeScript monorepo，包管理与脚本统一走 Bun，格式化、lint、类型检查与测试统一收敛在仓库根的 `vite-plus` 配置。

## 环境要求

| 项         | 版本 / 说明                                                              |
| ---------- | ------------------------------------------------------------------------ |
| Bun        | `1.4.2`（根 `package.json` 的 `packageManager`）                         |
| vite-plus  | `1.3.0`，提供 `vp build` / `vp test` / `vp check` / `vp lint` / `vp fmt` |
| TypeScript | `~7.0.2`，`tsc -b` 只负责产出 `.d.ts`                                    |
| Vitest     | `5.0.5`                                                                  |
| happy-dom  | `^21.0.3`，仅按需在单测文件头启用                                        |
| Node.js    | CI 发版链用 Node 24 + npm 11；日常开发不需要                             |

```bash
git clone https://github.com/cabinet-fe/infinite-table.git
cd infinite-table
bun install
```

::: tip
`bun install` 后，仓内包经 `exports` 的 `dev` 条件直接解析到各包 `src/index.ts`。测试与 playground 吃源码，不依赖先构建 dist。
:::

## 目录结构

```text
infinitable/
├── packages/
│   ├── render/          # 自研 canvas 渲染引擎：场景树、四层 canvas、失效、事件、canvas 池
│   ├── grid/            # 共享网格内核：ScrollManager、虚拟窗口/二分命中、布局与主题投影、选区、浮动对象
│   ├── table/           # 表格引擎：ListTable、交互、编辑、主题、媒体、插件注册路径
│   ├── formulas/        # 公式引擎：地址、tokenizer、Pratt parser、求值、内置函数、依赖图
│   ├── plugins/         # 官方插件：TablePlugin 契约 + chart / print / watermark
│   ├── pivot/           # 透视表引擎：PivotGrid 装配协议接入的领域引擎
│   ├── sheet/           # 电子表格核心：Sheet/Workbook、命令、IO、SheetGrid 适配
│   └── infinitable/     # 唯一 npm 发布包：re-export 五层 + ./sheet、./pivot 子路径
├── playground/          # 唯一应用：示例总览、架构与 API 边界、量化基准、冒烟自检
├── website/             # VitePress 文档站点
├── scripts/             # 依赖检查、导出检查、增量测试、发版脚本
├── agent-docs/          # 面向 agent 的 API 文档
└── .agents/             # agent 入口、文档、技能（含发版技能）
```

依赖方向（源码级）：

```text
grid → render
table → grid, render
plugins → table, grid
sheet → table, grid, formulas
infinitable → render, grid, table, formulas, plugins, sheet
playground → 各内部包源码
```

`render` 与 `grid` / `table` 只经 `RenderHost` 窄接口耦合；`formulas` 与 `grid` / `table` 互不依赖，求值接线在宿主侧。`packages/grid` 与 `packages/table` 禁止 import 任何 `@visactor/*`。

## 常用命令

根 `package.json` 没有 `dev` 脚本；开发服务器在 `playground` 与 `website` 子包里。

| 命令                                | 作用                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `bun run build`                     | `tsc -b` 产出类型，再对 `packages/*` 逐个 `vp build` 打包 dist           |
| `bun run test`                      | `vp test run`，跑全部单测与量化基准回归（吃 workspace 源码）             |
| `bun run test:changed`              | 按 git 改动映射受影响包，只跑相关测试                                    |
| `bun run check`                     | `vp check`：oxfmt + oxlint + tsgolint 类型检查三合一                     |
| `bun run lint`                      | `vp lint` + `bun run check:deps`                                         |
| `bun run fmt` / `bun run fmt:check` | 格式化写入 / 只检查                                                      |
| `bun run check:deps`                | 校验 `packages/grid` 与 `packages/table` 对 `@visactor/*` 零依赖         |
| `bun run check:exports`             | 空项目消费冒烟：校验各包 dist、类型树与 `./sheet` 子路径；**需先 build** |
| `bun run changeset`                 | changesets CLI（发版流程中不推荐交互式使用，见下文）                     |
| `bun run release`                   | 发版准备：changeset version + install + commit + push                    |
| `cd playground && bun run dev`      | 启动 playground（React + Vite MPA）                                      |
| `cd website && bun run dev`         | 启动 VitePress 文档站点                                                  |

::: tip 收尾口径
日常任务收尾跑 `bun run lint` + `bun run test:changed` 即可。全量 `bun run test` 留给发版前；发版流水线本身不跑测试。
:::

## 测试规范

- 单测放在包内 `packages/<pkg>/tests/`，与 `src/` 平级，子目录结构镜像源码；测试专用辅助（fake/stub）放 `tests/testing/`。禁止把测试与源码混放。
- 文件命名 `*.test.ts`。
- 默认测试环境是 `node`（根配置统一声明）。需要 DOM 的文件在文件头加：

```ts
// @vitest-environment happy-dom
```

happy-dom 比 jsdom 快；禁止改回全量 DOM 默认。

- 测试解析一律走 `exports` 的 `dev` 条件，吃 workspace 源码，不吃可能陈旧的 `dist` 产物。
- `fileParallelism: false`：量化基准需要独占 CPU，不要另行引入并行负载。
- `bun run test:changed` 的映射规则：`packages/<pkg>/**` 只跑该包；`playground/**` 跑 playground；纯文档、`.agents/`、`agent-docs/`、`docs/` 跳过；根级文件（`bun.lock`、根 `package.json`、`vite.config.ts` 等）回退全量。跨包影响不在增量脚本职责内，发版前用全量兜底。
- 渲染相关行为除单测外，用浏览器冒烟验证：

```bash
node playground/scripts/smoke.mjs
```

该脚本构建 + preview 并在页内断言，依赖全局 playwright-cli。

## 包导出规范

- 每个包 `src/index.ts` 是唯一公共入口，公共 API 从此处**显式具名导出**。
- 禁止 `export *` 全量转售依赖包 API；旧 `src/vrender.ts` 的教训。
- 每个包的 `exports` 条件为 `types` / `dev` / `import`：类型走 dist，仓内开发走 `src/index.ts`，发布消费走 dist。
- 唯一发布包 `infinitable` 的 exports 只有主入口与 `./sheet` 子路径，产物自包含，不残留 `@infinitable/*` 裸导入。
- `packages/infinitable/tests/public-surface.test.ts` 以显式快照冻结主入口与 `./sheet` 的导出符号集合。增删导出必须同步改快照。
- 新增或改动导出后先 `bun run build`，再 `bun run check:exports`。后者以外部消费者姿态动态 import 各包 dist，校验产物文件、类型树无裸导入、`./sheet` 可无头建簿求值。
- 通用工具优先取 `@cat-kit/core`；表格域专用工具出现时再议落地位置。

## 性能回归门禁

量化基准并入统一测试入口，没有独立 bench 命令：

- 用例：`playground/src/bench/headless.test.ts`。
- 浏览器入口：`playground/bench.html`。
- 运行：任何一次 `bun run test` / `bun run test:changed` 命中 playground 时都会执行。
- 未达标即测试失败，性能回归不允许进 `main`。
- 报告与 JSON 基线落档 `playground/results/`，保留最近 30 份。

当前阈值（`playground/src/bench/thresholds.ts`）：

| 指标                                  | 阈值            |
| ------------------------------------- | --------------- |
| TTFF P50（固定尺寸）                  | `≤ 80ms`        |
| 稳态滚动帧率                          | `≥ 55fps`       |
| 滚动/交互期间 body 层 `full` 失效次数 | `0`             |
| 每帧 body 失效面积 / 视口面积         | `≤ 1`           |
| sheet 切换全量重建均值                | `≤ 10ms`        |
| sheet 逐格写吞吐                      | `≥ 190 ops/ms`  |
| sheet 大块粘贴 500 格                 | `≤ 5ms`         |
| sheet 冻结切换均值                    | `≤ 0.2ms`       |
| sheet 大批量初始化写合计吞吐          | `≥ 2500 ops/ms` |

性能相关改动先看[渲染管线与失效模型](/guide/rendering-pipeline)与[性能与虚拟滚动](/guide/performance)，避免引入整层重绘或按数据量线性增长的路径。

## 发版流程

发版规范为 changesets + CI，发布分支 **main**，唯一发布物是 `infinitable`。详细清单见仓库内 `.agents/skills/release/SKILL.md`。

流程要点：

1. 确认工作区干净、在 `main`、`git pull --ff-only` 不落后。
2. 准备 changeset：在 `.changeset/` 写 `<slug>.md`：

   ```markdown
   ---
   'infinitable': patch
   ---

   fix: 修复 xxx
   ```

   发版技能明确要求不要跑交互式 `bun run changeset`。

3. 执行 `bun run release`：自动完成 changeset version、`bun install`、commit、push。支持 `--dry-run` 演练与 `--force` 跳过分支检查。
4. push 触碰 `packages/*/CHANGELOG.md` 后自动触发 `.github/workflows/release.yml`：
   - `bun install --frozen-lockfile` → `bun run build` → `bun run check:exports`；
   - 剥离发布清单的 workspace devDependencies；
   - 经 npm trusted publishing（OIDC、provenance）发布；
   - 成功后推送 `infinitable@X.Y.Z` 本地 tag。

禁止事项：

- 本地 `npm publish`。
- 推 `v*` tag 触发发版（旧流程已作废）。
- watch CI；拿到 run 链接即结束。
- 依赖 `changesets/action` 的 `published` 输出做下游条件（changesets v3 下恒为 false）。

发布链不跑测试，发布前必须手动跑一次全量 `bun run test`。

## 代码风格

- 格式化与 lint 统一由根 `vite.config.ts` 的 vite-plus 配置驱动：`oxfmt` + `oxlint` + `tsgolint`。
- oxfmt：单引号、无分号、`printWidth: 100`；忽略 `docs/**`、`agent-docs/**`、`.agents/**`、`AGENTS.md`。
- oxlint：启用 typescript / unicorn / oxc / vitest 插件，`correctness` 为 error；`typeAware` 与 `typeCheck` 开启，`vp check` 即静态检查统一入口，`tsc -b` 只在 build 链产出 d.ts。
- TypeScript：`strict`、`noUncheckedIndexedAccess`、`verbatimModuleSyntax`、`noEmit`。
- 命名：包名 `@infinitable/<name>`，目录 `packages/<name>`；文件 kebab-case；类型/类 PascalCase；变量/函数 camelCase。
- 注释与文档用中文。
- 禁止引入任何 `@visactor/vrender*` / `@visactor/vutils` 等旧引擎依赖；`packages/grid` 与 `packages/table` 对 `@visactor/*` 零依赖由 `check:deps` 双向校验。

提交前至少确认：

```bash
bun run lint
bun run test:changed
```

## 相关

- [快速开始](/guide/getting-started)：从外部使用者视角接入 `infinitable`。
- [架构总览](/guide/architecture)：分层、失效模型与包边界。
- [ListTable API](/api/list-table)：改引擎或写示例时对照公共面。
