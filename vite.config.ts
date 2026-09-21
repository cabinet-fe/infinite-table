import { defineConfig } from 'vite-plus'

// vite-plus 统一配置：oxfmt + oxlint + vitest 全部收敛在仓库根
export default defineConfig({
  fmt: {
    singleQuote: true,
    printWidth: 100,
    semi: false,
    ignorePatterns: ['docs/**', '.agents/**', 'AGENTS.md'],
  },
  lint: {
    plugins: ['typescript', 'unicorn', 'oxc', 'vitest'],
    categories: {
      correctness: 'error',
    },
    // expectError 是 packages/formulas 测试里的错误码断言助手（内部包装 expect）
    rules: {
      'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'expectError'] }],
    },
    ignorePatterns: ['**/dist/**'],
  },
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
  },
})
