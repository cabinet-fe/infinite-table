import { createLibConfig } from '../../vite.lib.config'

// 库构建配置：复用 vite.lib.config.ts 的共享工厂（entry/formats/emptyOutDir 对齐），
// 另把运行时依赖 @cat-kit/core 外部化（与 @infinitable/* 一样不进产物）
export default createLibConfig({ extraExternals: [/^@cat-kit\//] })
