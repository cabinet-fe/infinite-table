import { defineConfig } from 'vite-plus'

type LibConfigOptions = {
  /** 包自身需外部化的依赖（运行时/peer 依赖不进产物），追加在 @infinitable/* 之后 */
  extraExternals?: (RegExp | string)[]
}

/** monorepo 内各包共享的库构建配置工厂：入口为包内 src/index.ts，workspace 依赖保持外部化 */
export function createLibConfig({ extraExternals = [] }: LibConfigOptions = {}) {
  return defineConfig({
    build: {
      // tsc -b 先行产出 dist/types（exports 的 types 条件）；关闭清空避免库构建删掉声明产物
      emptyOutDir: false,
      lib: {
        entry: 'src/index.ts',
        formats: ['es'],
      },
      rollupOptions: {
        external: [/^@infinitable\//, ...extraExternals],
      },
    },
  })
}
