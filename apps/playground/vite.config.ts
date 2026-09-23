// 演练场：ultra-ui 的 USheet（@veltra/sheet）跑在 infinite-table 引擎上。
// 关键机制：
// - resolve.conditions 加 veltra-dev：@veltra/* 走 ultra-ui 仓源码（真链路调试）；
// - alias '@veltra/sheet-core/grid' → 本仓 veltra-grid 适配层：VTable 引擎在这里被
//   整体替换为 @infinite-table/core 的 ListTable，Vue 层（USheet）零改动。
import fs from 'node:fs'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import { NodePackageImporter } from 'sass-embedded'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

const ultraRoot = fileURLToPath(new URL('../../../ultra-ui', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const gridAdapter = fileURLToPath(new URL('./src/veltra-grid/index.ts', import.meta.url))

export default defineConfig({
  plugins: [
    // compiler-sfc 解析 SFC 内 defineProps<T>() 的类型导入需要 fs；本仓 typescript@7
    //（原生版）无 ts.sys 回退，显式注入 node fs（compiler-sfc 会先试探目录路径，
    // ts.sys 对目录返回空串，node fs 抛 EISDIR——需容错）
    vue({
      script: {
        fs: {
          fileExists: (file: string) => {
            try {
              return fs.statSync(file).isFile()
            } catch {
              return false
            }
          },
          readFile: (file: string): string => {
            try {
              return fs.readFileSync(file, 'utf-8')
            } catch {
              return ''
            }
          },
        },
      } as object,
    }),
    vueJsx(),
  ],
  resolve: {
    // dev：仓内 workspace 包吃源码；veltra-dev：ultra-ui 包吃其仓源码
    conditions: ['dev', 'veltra-dev'],
    // vue 单实例：应用与 ultra-ui 组件共享同一份 vue
    dedupe: ['vue'],
    alias: {
      '@veltra/sheet-core/grid': gridAdapter,
    },
  },
  css: {
    preprocessorOptions: {
      scss: { importers: [new NodePackageImporter(ultraRoot)] },
    },
  },
  // @veltra/* 走源码（veltra-dev 条件）+ 含 .vue SFC：必须排除预打包，经 vue 插件管线编译
  optimizeDeps: {
    exclude: [
      '@veltra/sheet',
      '@veltra/sheet-core',
      '@veltra/styles',
      '@veltra/desktop',
      '@veltra/icons',
      '@veltra/utils',
    ],
  },
  server: {
    port: 7790,
    fs: { allow: [repoRoot, ultraRoot] },
  },
})
