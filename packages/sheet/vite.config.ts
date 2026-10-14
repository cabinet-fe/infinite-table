import { createLibConfig } from '../../vite.lib.config'

// 库构建配置：复用 vite.lib.config.ts 的共享工厂。
// src 已不引用 @cat-kit/core（仅 tests 直连，vitest 不走 rollup external），无需额外外部化
export default createLibConfig()
