import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite-plus'

// 演示应用：标准 vite-plus 应用构建（index.html 入口，非库模式）
export default defineConfig({
  plugins: [vue()],
  // 仓内应用经 dev 条件吃 workspace 源码（对齐 veltra-dev 约定）；外部消费者走 import → dist
  resolve: {
    conditions: ['dev'],
  },
})
