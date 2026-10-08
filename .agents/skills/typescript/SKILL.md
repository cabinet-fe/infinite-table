---
name: typescript
description: TypeScript 类型系统、tsconfig 与编译器行为。按已安装的 TypeScript major（优先 5 / 6 / 7）选用该版本写法。在编辑 .ts / .tsx、tsconfig.json 或处理类型与编译选项时使用。
---

# TypeScript

只管类型、`tsconfig`、编译器行为。如何用 Node 跑 `.ts` 交给 node 技能；Vue SFC / Volar 交给 vue 技能。构建工具、CSS、状态库跟项目走，不要在本技能里指定。

禁止凭训练数据写 API。先定版本，再读对应 reference。

## 定版本

1. 读**已安装**的 `typescript` 版本：`node_modules/typescript/package.json` 的 `version`，或 lockfile。不要只看 `package.json` 的 `^` / `>=` 范围。
2. 同时装了 `typescript@7` 与 `@typescript/typescript6`（或 npm alias）时：应用代码与项目已有的 typecheck 入口以 7 为准；需要 programmatic API 的工具以 6 为准。见 [references/7.md](references/7.md)。
3. 取 **major**（`5.8.4` → `5`），打开下表。写代码时只开当前档，不要整夹盲读。**5.x 再记下 minor**：只用 `5.0` … `5.y` 小节。

| major | 文件 |
| ----- | ---- |
| 5 | [references/5.md](references/5.md) |
| 6 | [references/6.md](references/6.md) |
| 7 | [references/7.md](references/7.md) |

未列出的更新 major：以已覆盖的最高档为底，再查官方 Announcing / handbook release notes。更旧：不要使用本技能里的新 API。

## 写法基线（5.0+ 都该用）

- 字面量收窄用 `satisfies`，不要 `as` 一把梭。
- 库作者要保留元组 / 对象字面量时，泛型参数写 `const T`，不要让调用方到处 `as const`。
- 新装饰器用**标准** decorators。不要开 `experimentalDecorators`，除非项目已经钉死旧语义。
- 打开 `verbatimModuleSyntax`：值 import 与 `import type` 分开；不要靠 import elision。
- `moduleResolution`：bundler / Vite 用 `bundler`；直接跑 Node 用当前档的 `nodenext` / `node20` / `node18`。不要用 `node10` / `node`。
- 解析策略必须跟 `--module` 匹配；细节（`bundler` 能否配 `commonjs`、`require(esm)` 落在哪个 `module`）见当前档。
