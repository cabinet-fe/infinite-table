// ?smoke=1 全量挂载与冒烟页子集挂载共用的演示句柄形态（写 window.__DEMO__）。
// 原出口在旧 Vue 入口 main.ts，随 P2 换 React 迁到本文件；smoke.ts 与各页面的引用不改语义。

import type { ChartDemo } from '../sections/chart'
import type { DataFormsDemo } from '../sections/data-forms'
import type { DisplayDemo } from '../sections/display'
import type { EditingDemo } from '../sections/editing'
import type { InteractionDemo } from '../sections/interaction'
import type { MediaDemo } from '../sections/media'
import type { PrintDemo } from '../sections/print'
import type { WatermarkDemo } from '../sections/watermark'

export interface DemoHandles {
  dataForms: DataFormsDemo
  display: DisplayDemo
  interaction: InteractionDemo
  media: MediaDemo
  chart: ChartDemo
  watermark: WatermarkDemo
  print: PrintDemo
  editing: EditingDemo
}

declare global {
  interface Window {
    __DEMO__?: DemoHandles
  }
}
