import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

// 前端壳走 vite-plus（与 playground 同构）；/api 经开发代理转发到 Bun 后端，
// 页面代码统一用相对路径请求，代理目标与 server 启动默认端口一致（8787）。
export default defineConfig({
  // react() 的类型出自 vite 8 类型链，与 vite-plus 内置版本对不上（playground 对 tailwindcss 同款处置）
  plugins: [react() as any],
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
