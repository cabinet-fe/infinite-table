---
name: release
description: infinite-table 发版操作（发版规范 A：公开 npm · CI · changesets）。在本仓库发版、发布、升版本、publish、release、出新版本时使用——即使用户没明说「发版」。
---

# infinite-table 发版

规范 A：公开 npm，一切 publish 由 CI 完成，本地只准备并触发。发版分支 **main**。

> 2026-10-11 起由「手改 version + 推 v* tag」迁移为 changesets 模式。旧 `vX.Y.Z` tag 流程作废。

## 步骤

1. 前置：`git status --porcelain` 干净、在 main、`git pull --ff-only` 不落后。
2. 确认待处理 changeset：`ls .changeset/*.md`（README.md 除外）。没有就用 Write 写 `.changeset/<slug>.md` 并 commit `chore: add changeset`（**不要跑交互式 `bun run changeset`**）：

   ```markdown
   ---
   "infinitable": patch
   ---

   fix: 修复 xxx
   ```

3. `bun run release` —— 自动完成 changeset version + bun install + commit + push（`--dry-run` 演练、`--force` 跳过分支检查）。
4. push 触碰 `packages/*/CHANGELOG.md` 自动触发 release.yml。`gh run list --limit 1` 拿 run 链接告知用户即结束，**不要 watch**。

## 本项目要点

- 唯一发布物：`infinitable`（packages/infinitable，已统一打包内部 @infinitable/* 模块）；其余子包与 playground 私有不发。
- CI（release.yml）：build → check:exports → normalize-manifest.ts（剥离 workspace devDependencies，CI 专用，勿在本地跑）→ changesets/action publish，npm OIDC 免 token + provenance + 固定 npm@11；幂等，同版本重跑自动跳过。
- tag：changeset publish 成功后打 `infinitable@X.Y.Z` 本地 tag（不再用 `vX.Y.Z`），由 workflow「推送版本 tag」步骤按 `refs/tags/infinitable@*` pattern 推送。changesets/action@v1 的 `published` 输出按 v2 时代 `New tag:` 行解析，在 changesets v3 下恒为 false，**勿作任何下游条件**（2026-10-15 修复 0.3.1 前 tag 全漏推的缺陷）。
- 若 `agent-docs/index.md` 引用版本号，发版时一并同步。
- 禁止：本地 `npm publish`；推 `v*` tag 触发发版（旧路径）；watch CI；交互式 changeset CLI。

## 维护

发版配置（workflow、脚本）变动时，以仓库现状为准并同步更新本文件。
