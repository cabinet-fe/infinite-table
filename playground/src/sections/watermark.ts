// 水印演示区：watermark 插件经构造 plugins 挂载，文字平铺水印绘制在顶层 overlay
// 预留位（sky 层最顶）——默认主题即覆盖在表格内容之上可见（零宿主配置），
// 滚动表格观察水印锚定视口不随内容移动；开关与 text/rotate/opacity/gapX/gapY/
// fontSize 控件即时生效（updateConfig 一帧内重绘）。
// window.__DEMO__.watermark 暴露 handle（getConfig/isEnabled）供冒烟判定。

import { createWatermarkPlugin, type WatermarkHandle } from '@infinitable/plugins'

import { addButton, addStatus, createSection, mountTable, type DemoMount } from '../mount'

/** 演示表数据行数（足够滚动） */
export const WATERMARK_ROW_COUNT = 400

export interface WatermarkDemo {
  mount: DemoMount
  /** 水印插件句柄（冒烟断言用：getConfig 读取当前配置、isEnabled 读取开关态） */
  handle: WatermarkHandle
}

/** 控件行内联样式（不进共享 style.css：水印区自包含，原生 input 即可用） */
function styleControlRow(row: HTMLLabelElement): void {
  row.style.display = 'flex'
  row.style.alignItems = 'center'
  row.style.gap = '10px'
  row.style.margin = '8px 0'
  const caption = row.firstElementChild as HTMLElement | null
  if (caption) {
    caption.style.flex = '0 0 64px'
    caption.style.fontSize = '12px'
    caption.style.color = 'var(--text-2)'
  }
  const input = row.querySelector('input')
  if (input) {
    input.style.flex = '1'
    input.style.maxWidth = '320px'
  }
}

/** 建一个带标签的滑杆行，onInput 回填 config 并刷状态行 */
function addSlider(
  section: HTMLElement,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (value: number) => void,
): HTMLInputElement {
  const row = document.createElement('label')
  row.className = 'watermark-control'
  const caption = document.createElement('span')
  caption.textContent = label
  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  input.addEventListener('input', () => onInput(Number(input.value)))
  row.append(caption, input)
  styleControlRow(row)
  section.appendChild(row)
  return input
}

export function mountWatermark(root: HTMLElement): WatermarkDemo {
  const section = createSection(
    root,
    '文字水印',
    '水印插件经构造 plugins 挂载：平铺文字绘制在顶层 overlay 预留位（挂四层 canvas 最上层的' +
      ' sky 层最顶，覆盖在表格内容之上），默认主题零配置即可见。滚动表格观察水印锚定视口不随内容' +
      '移动；下方开关与滑杆即时生效（updateConfig 一帧内重绘）。',
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

  const status = addStatus(section)
  const refreshStatus = (): void => {
    const config = handle.getConfig()
    status.textContent =
      `水印${handle.isEnabled() ? '开' : '关'}：text「${config.text}」 fontSize ${config.fontSize} ` +
      `rotate ${config.rotate}° opacity ${config.opacity} gap ${config.gapX}×${config.gapY}`
  }
  refreshStatus()

  addButton(section, '开关水印', () => {
    handle.updateConfig({ enabled: !handle.isEnabled() })
    refreshStatus()
  })

  const textInput = document.createElement('input')
  textInput.type = 'text'
  textInput.value = 'infinitable 内部资料'
  textInput.className = 'watermark-text'
  textInput.addEventListener('input', () => {
    handle.updateConfig({ text: textInput.value })
    refreshStatus()
  })
  const textRow = document.createElement('label')
  textRow.className = 'watermark-control'
  const textCaption = document.createElement('span')
  textCaption.textContent = '文本'
  textRow.append(textCaption, textInput)
  styleControlRow(textRow)
  section.appendChild(textRow)

  addSlider(section, '字号', 8, 32, 1, 14, (fontSize) => {
    handle.updateConfig({ fontSize })
    refreshStatus()
  })
  addSlider(section, '旋转角', -90, 90, 5, -30, (rotate) => {
    handle.updateConfig({ rotate })
    refreshStatus()
  })
  addSlider(section, '透明度', 0.02, 1, 0.02, 0.12, (opacity) => {
    handle.updateConfig({ opacity })
    refreshStatus()
  })
  addSlider(section, '横向间距', 40, 400, 10, 160, (gapX) => {
    handle.updateConfig({ gapX })
    refreshStatus()
  })
  addSlider(section, '纵向间距', 30, 300, 10, 120, (gapY) => {
    handle.updateConfig({ gapY })
    refreshStatus()
  })

  return { mount, handle }
}
