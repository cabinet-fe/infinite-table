// 水印演示区装配：watermark 插件经构造 plugins 挂载，文字平铺水印绘制在顶层 overlay
// 预留位（sky 层最顶，覆盖在表格内容之上）——默认主题零宿主配置即可见，滚动表格
// 观察水印锚定视口不随内容移动。控件面（开关/文本/五滑杆）由 WatermarkPage 以
// shadcn 渲染，参数改动经 handle.updateConfig 一帧内重绘即时生效；本文件只承担
// 引擎装配（插件挂载方式不动）。window.__DEMO__.watermark 暴露 handle
// （getConfig/isEnabled）供冒烟判定。

import { createWatermarkPlugin, type WatermarkHandle } from '@infinitable/plugins'

import { createSection, mountTable, type DemoMount } from '../mount'

/** 演示表数据行数（足够滚动） */
const WATERMARK_ROW_COUNT = 400

export interface WatermarkDemo {
  mount: DemoMount
  /** 水印插件句柄（页面控件与冒烟断言共用：updateConfig 即时生效、getConfig/isEnabled 读取） */
  handle: WatermarkHandle
}

export function mountWatermark(root: HTMLElement): WatermarkDemo {
  const section = createSection(
    root,
    '文字水印',
    '水印插件经构造 plugins 挂载：平铺文字绘制在顶层 overlay 预留位（四层 canvas 最上层的' +
      ' sky 层最顶，覆盖在表格内容之上），默认主题零配置即可见。滚动表格观察水印锚定视口不随内容' +
      '移动；右侧开关与滑杆即时生效（updateConfig 一帧内重绘）。',
  )

  const handle = createWatermarkPlugin({ enabled: true, text: 'infinitable 内部资料' })
  const mount = mountTable(section, {
    width: 660,
    height: 360,
    columns: [
      { title: '编号', width: 120 },
      { title: '部门', width: 160 },
      { title: '负责人', width: 140 },
      { title: '金额', width: 160 },
    ],
    rowCount: WATERMARK_ROW_COUNT,
    resolveDisplayValue: (col, row) => {
      if (col === 0) return `NO-${row + 1}`
      if (col === 1) return `部门-${(row % 8) + 1}`
      if (col === 2) return `成员-${(row % 12) + 1}`
      return `${((row * 37) % 900) + 100}.00`
    },
    plugins: [handle],
  })

  return { mount, handle }
}
