import { defineConfig } from 'vite-plus'

// 统一发布包构建：入口 re-export 七个内部包（render/grid/table/formulas/plugins，
// ./sheet 子路径再含 sheet，./pivot 子路径再含 pivot；import 条件吃各自的 dist 产物），
// @infinitable/* 不再外部化而是整体打进产物；主入口与 ./sheet、./pivot 子路径各出
// 一个 bundle（entry 键即产物名：infinitable.js / sheet.js / pivot.js）。
// chart.js 保持源码内动态分包形态出独立 chunk，仅 @cat-kit/core 与 formulas 同口径外部化（运行时依赖）。
// 引擎单副本契约：render/grid/table/formulas 四包 dist 钉进单一具名 'engine' 共享
// chunk（manualChunks，路径钉死不依赖 Rollup 自动分组的偶然行为）——主入口与
// ./sheet、./pivot 三个 entry 消费同一份类实现，跨入口 instanceof 必然成立，由
// scripts/check-package-exports.mjs 的契约校验守卫回归。仅单入口可达的模块
// （plugins 静态部分、pivot 领域状态机）不落该 chunk，随所属 entry 内联。
export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        infinitable: 'src/index.ts',
        sheet: 'src/sheet.ts',
        pivot: 'src/pivot.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^@cat-kit\//],
      output: {
        manualChunks(id: string) {
          return /[\\/]packages[\\/](render|grid|table|formulas)[\\/]dist[\\/]/.test(id)
            ? 'engine'
            : undefined
        },
      },
    },
  },
})
