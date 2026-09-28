import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

// bench 是浏览器应用（index.html 入口）；本文件存在即覆盖向上解析到的根库构建配置
export default defineConfig({
  // 仓内应用经 dev 条件吃 workspace 源码（对齐 veltra-dev 约定）；外部消费者走 import → dist
  resolve: {
    conditions: ['dev'],
  },
  build: {
    rollupOptions: {
      // MPA：基准页 + vs-vtable 对比页两个 html 入口
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        vs: fileURLToPath(new URL('./vs.html', import.meta.url)),
      },
    },
  },
})
