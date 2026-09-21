import { defineConfig } from 'vite-plus'

// 库构建配置：与 vite.lib.config.ts 同形态（entry/formats/emptyOutDir 对齐），
// 另把运行时依赖 @cat-kit/core 外部化（与 @infinite-table/* 一样不进产物）
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^@infinite-table\//, /^@cat-kit\//],
    },
  },
})
