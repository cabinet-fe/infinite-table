// 演示句柄形态（写 window.__DEMO__）：smoke 全量挂载给全集，单演示页（如 print）只挂
// 自己那一片（Partial）。原出口在旧 Vue 入口 main.ts，随 P2 换 React 迁到本文件。

import type { ChartDemo } from '../sections/chart'
import type { DataFormsDemo } from '../sections/data-forms'
import type { DisplayDemo } from '../sections/display'
import type { EditingDemo } from '../sections/editing'
import type { HyperlinkImageDemo } from '../sections/hyperlink-image'
import type { InteractionDemo } from '../sections/interaction'
import type { MediaDemo } from '../sections/media'
import type { NativeScrollDemo } from '../sections/native-scroll'
import type { PivotDemo } from '../sections/pivot'
import type { PrintDemo } from '../sections/print'
import type { WatermarkDemo } from '../sections/watermark'

export interface DemoHandles {
  dataForms: DataFormsDemo
  display: DisplayDemo
  interaction: InteractionDemo
  hyperlinkImage: HyperlinkImageDemo
  media: MediaDemo
  chart: ChartDemo
  watermark: WatermarkDemo
  print: PrintDemo
  editing: EditingDemo
  nativeScroll: NativeScrollDemo
  pivot: PivotDemo
}

declare global {
  interface Window {
    __DEMO__?: Partial<DemoHandles>
  }
}
