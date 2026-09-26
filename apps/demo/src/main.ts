// apps/demo 入口：基于 Vue 3 驱动的示例应用（左侧菜单 + 右侧示例）
// ?smoke=1 时由 App.vue 挂载全量演示区并运行页内冒烟自检（写 window.__SMOKE__ 供 scripts/smoke.mjs 轮询）

import './style.css'

import { createApp } from 'vue'
import App from './App.vue'

import type { DataFormsDemo } from './sections/data-forms'
import type { ChartDemo } from './sections/chart'
import type { DisplayDemo } from './sections/display'
import type { EditingDemo } from './sections/editing'
import type { InteractionDemo } from './sections/interaction'
import type { MediaDemo } from './sections/media'

export interface DemoHandles {
  dataForms: DataFormsDemo
  display: DisplayDemo
  interaction: InteractionDemo
  media: MediaDemo
  chart: ChartDemo
  editing: EditingDemo
}

declare global {
  interface Window {
    __DEMO__?: DemoHandles
  }
}

const app = createApp(App)
app.mount('#app')
