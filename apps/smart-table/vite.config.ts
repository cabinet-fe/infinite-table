import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

// 前端壳走 vite-plus；/api 经开发代理转发到 Bun 后端（默认端口 8788）。
export default defineConfig({
  plugins: [react() as any],
  resolve: {
    conditions: ['dev'],
  },
  server: {
    port: 5175,
    proxy: {
      '/api': 'http://localhost:8788',
    },
  },
})
