import { defineConfig } from 'vite-plus';

// vite-plus 统一配置：oxfmt + oxlint + vitest 全部收敛在仓库根
export default defineConfig({
  fmt: {
    singleQuote: true,
    printWidth: 100,
    semi: false,
    ignorePatterns: ['vtable-core/**', 'docs/**', '.agents/**', 'AGENTS.md'],
  },
  lint: {
    plugins: ['typescript', 'unicorn', 'oxc', 'vitest'],
    categories: {
      correctness: 'error',
    },
    ignorePatterns: ['vtable-core/**', '**/dist/**'],
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
  },
});
