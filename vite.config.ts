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
    // tsgolint（TypeScript Go 工具链）承担类型检查：vp check 即静态检查统一入口，替代 tsc 的检查职能
    options: {
      typeAware: true,
      typeCheck: true,
    },
    // expectError 是 packages/formulas 测试里的错误码断言助手（内部包装 expect）；
    // 值→文本两条降 warn：单元格显示管线对任意类型值做运行时兜底（String()/模板）是刻意设计
    rules: {
      'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'expectError'] }],
      'typescript/no-base-to-string': 'warn',
      'typescript/restrict-template-expressions': 'warn',
    },
    ignorePatterns: ['**/dist/**'],
  },
  // 测试/SSR 解析一律吃 workspace 源码（exports dev 条件 → src/index.ts），不吃可能陈旧的 dist 产物
  ssr: {
    resolve: {
      conditions: ['dev'],
    },
  },
  resolve: {
    conditions: ['dev'],
  },
  test: {
    include: ['packages/*/tests/**/*.test.ts', 'playground/src/bench/*.test.ts'],
    // bench 场景做性能采样，须独占 CPU（其余单测也快，串行无感）
    fileParallelism: false,
  },
})
