import { defineConfig } from 'vite-plus';

// monorepo 内各包共享的库构建配置：入口为包内 src/index.ts，workspace 依赖保持外部化
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
    },
    rollupOptions: {
      external: /^@infinite-table\//,
    },
  },
});
