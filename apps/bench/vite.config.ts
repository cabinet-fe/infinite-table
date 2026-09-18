import { defineConfig } from 'vite-plus'

// bench 是浏览器应用（index.html 入口）；本文件存在即覆盖向上解析到的根库构建配置
export default defineConfig({
  // 仓内应用经 dev 条件吃 workspace 源码（对齐 veltra-dev 约定）；外部消费者走 import → dist
  resolve: {
    conditions: ['dev'],
  },
})
