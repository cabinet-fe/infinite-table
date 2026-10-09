import { defineConfig } from 'vite-plus'

// 统一发布包构建：入口 re-export 五个内部包（import 条件吃各自的 dist 产物），
// @infinitable/* 不再外部化而是整体打进产物；主入口与 ./sheet 子路径各出一个
// bundle（entry 键即产物名：infinitable.js / sheet.js），共享代码走 chunk 分包。
// chart.js 保持源码内动态分包形态出独立 chunk，仅 @cat-kit/core 与 formulas 同口径外部化（运行时依赖）。
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: {
        infinitable: 'src/index.ts',
        sheet: 'src/sheet.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^@cat-kit\//],
    },
  },
})
