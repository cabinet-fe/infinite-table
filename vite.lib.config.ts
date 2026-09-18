import { defineConfig } from 'vite-plus'

// monorepo 内各包共享的库构建配置：入口为包内 src/index.ts，workspace 依赖保持外部化
export default defineConfig({
  build: {
    // tsc -b 先行产出 dist/types（exports 的 types 条件）；关闭清空避免库构建删掉声明产物
    emptyOutDir: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
    },
    rollupOptions: {
      external: /^@infinite-table\//,
    },
  },
})
