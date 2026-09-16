// apps/demo 入口：装配四个演示区（数据三形态 / 显示能力 / 交互能力 / 图片与浮动对象）；
// ?smoke=1 时运行页内冒烟自检（结果写 window.__SMOKE__，供 scripts/smoke.mjs 轮询）。

import './style.css';

import { isSmokeMode } from './mount';
import { mountDataForms, type DataFormsDemo } from './sections/data-forms';
import { mountDisplay, type DisplayDemo } from './sections/display';
import { mountInteraction, type InteractionDemo } from './sections/interaction';
import { mountMedia, type MediaDemo } from './sections/media';
import { runSmoke } from './smoke';

export interface DemoHandles {
  dataForms: DataFormsDemo;
  display: DisplayDemo;
  interaction: InteractionDemo;
  media: MediaDemo;
}

declare global {
  interface Window {
    __DEMO__?: DemoHandles;
  }
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('缺少 #app 挂载点');
}

const title = document.createElement('h1');
title.textContent = 'infinite-table 演示（自研渲染引擎 MVP）';
app.appendChild(title);

const demos: DemoHandles = {
  dataForms: mountDataForms(app),
  display: mountDisplay(app),
  interaction: mountInteraction(app),
  media: mountMedia(app),
};
window.__DEMO__ = demos;

if (isSmokeMode()) {
  void runSmoke(demos);
}
