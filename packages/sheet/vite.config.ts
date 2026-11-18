import { defineConfig } from 'vite-plus'

// 库构建配置：主入口 src/index.ts（dist/sheet.js）与 XLSX/CSV IO 子路径 src/io.ts（dist/io.js）双入口构建。
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: {
        sheet: 'src/index.ts',
        io: 'src/io.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^@infinitable\/[a-z-]+$/],
    },
  },
})
