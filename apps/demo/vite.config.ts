import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite-plus'

// 演示应用：标准 vite-plus 应用构建（index.html 入口，非库模式）
export default defineConfig({
  plugins: [vue()],
})
