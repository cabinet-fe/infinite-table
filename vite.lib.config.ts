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
        // 只外部化公共入口说明符（@infinitable/<pkg>，经各包 exports import 条件吃 dist）。
        // 深路径（@infinitable/<pkg>/src/*，跨包内部原语接线，如 table → grid）无独立
        // dist 产物，外部化会残留运行时不可解析的裸说明符——一律随消费方打包进产物。
        external: [/^@infinitable\/[a-z-]+$/, ...extraExternals],
      },
    },
  })
}
