import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite-plus'

// playground 是浏览器应用（index.html 入口）；本文件存在即覆盖向上解析到的根库构建配置
export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    // 仓内应用经 dev 条件吃 workspace 源码（对齐 veltra-dev 约定）；外部消费者走 import → dist
    conditions: ['dev'],
    // shadcn 约定：@/* → src/*
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      // MPA：示例主应用 + 量化基准页两个 html 入口
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        bench: fileURLToPath(new URL('./bench.html', import.meta.url)),
      },
    },
  },
})
