// 水印插件单测：mount 写顶层 overlay 预留位（承载节点挂 sky 层最顶 + 整层失效）、
// unmount 还原（节点摘除 + 清屏失效）、updateConfig 变更触发 sky 整层失效
// （一帧内生效路径）与开关读写、滚动不波及 sky 层（水印锚定视口，对齐 core 层
// 行为测试手法：断言失效提交的 kind 集合）、overlay 承载节点 pointer 事件透传。

import { describe, expect, it } from 'vitest'

import { ListTable, type TablePlugin } from '@infinitable/core'

import { createWatermarkPlugin, WATERMARK_PLUGIN_NAME } from '../../src/watermark/watermark-plugin'
import { StubHost } from '../testing/stub-host'
import { RecordingContext } from '../testing/recording-context'

/**
 * 直绘 sky 层最顶子节点（overlay 承载节点；StubHost 不走真实 flush）：返回记录型
 * 上下文供内容断言。sky 恒在 body 之上（render LAYER_ORDER 四层叠放），默认主题
 * body 层不透明底色不构成遮挡（B2 根因）。
 */
function paintOverlay(host: StubHost): RecordingContext {
  const ctx = new RecordingContext()
  const children = host.layers.get('sky')?.root.children ?? []
  children[children.length - 1]?.paint(ctx)
  return ctx
}

function skyFullCount(host: StubHost): number {
  return host.submitted.filter((s) => s.kind === 'sky' && s.inv.type === 'full').length
}

function skyChildren(host: StubHost): number {
  return host.layers.get('sky')?.root.children.length ?? 0
}

function createTable(host: StubHost, plugins?: TablePlugin[]): ListTable {
  return new ListTable({
    width: 400,
    height: 200,
    columns: [
      { title: 'a', width: 140 },
      { title: 'b', width: 140 },
      { title: 'c', width: 140 },
    ],
    rowCount: 600,
    rowHeight: 24,
    plugins,
    host,
  })
}

describe('createWatermarkPlugin 预留位接线', () => {
  it('未挂水印 sky 层仅交互浮层节点；mount 挂 overlay 承载节点于最顶并整层失效', () => {
    const bareHost = new StubHost()
    createTable(bareHost)
    expect(skyChildren(bareHost)).toBe(1)
    // 水印改挂顶层 overlay 后不再触碰 ground 层（引擎挂点保留但本插件不用）
    expect(bareHost.layers.has('ground')).toBe(false)

    const host = new StubHost()
    const plugin = createWatermarkPlugin({ enabled: true, text: '内部资料' })
    const table = createTable(host, [plugin])
    expect(plugin.name).toBe(WATERMARK_PLUGIN_NAME)
    expect(skyChildren(host)).toBe(2)
    expect(skyFullCount(host)).toBe(1)
    const painted = paintOverlay(host)
    expect(painted.texts.length).toBeGreaterThan(0)
    expect(painted.texts.every((t) => t.text === '内部资料')).toBe(true)
    expect(() => table.destroy()).not.toThrow()
  })

  it('table.use() 晚挂载同样即时生效（构造后注册路径）', () => {
    const host = new StubHost()
    const table = createTable(host)
    expect(skyChildren(host)).toBe(1)
    table.use(createWatermarkPlugin({ enabled: true, text: '晚挂' }))
    expect(skyChildren(host)).toBe(2)
    expect(paintOverlay(host).texts.length).toBeGreaterThan(0)
  })

  it('unmount 还原预留位：承载节点摘除 + 整层失效清屏，绘制面干净移除', () => {
    const host = new StubHost()
    const plugin = createWatermarkPlugin({ enabled: true, text: '内部资料' })
    const table = createTable(host, [plugin])
    expect(skyChildren(host)).toBe(2)
    plugin.unmount?.(table)
    expect(skyChildren(host)).toBe(1)
    // mount 一次 + unmount 清屏一次
    expect(skyFullCount(host)).toBe(2)
    expect(paintOverlay(host).texts).toEqual([])
  })

  it('enabled: false 挂载不写 painter（空置预留位，无 sky 失效）', () => {
    const host = new StubHost()
    createTable(host, [createWatermarkPlugin({ enabled: false, text: '内部资料' })])
    expect(skyChildren(host)).toBe(1)
    expect(skyFullCount(host)).toBe(0)
  })
})

describe('updateConfig 运行时更新', () => {
  it('任一项变更触发 sky 整层失效；同值补丁无操作', () => {
    const host = new StubHost()
    const plugin = createWatermarkPlugin({ enabled: true, text: '内部资料' })
    createTable(host, [plugin])
    host.submitted.length = 0

    plugin.updateConfig({ opacity: 0.45 })
    expect(host.submitted).toEqual([{ kind: 'sky', inv: { type: 'full' } }])
    // 缺省并入后的完整快照 + 开关态
    expect(plugin.getConfig()).toEqual({
      enabled: true,
      text: '内部资料',
      fontSize: 14,
      color: '#000000',
      opacity: 0.45,
      rotate: -30,
      gapX: 160,
      gapY: 120,
    })
    expect(plugin.isEnabled()).toBe(true)

    host.submitted.length = 0
    plugin.updateConfig({ opacity: 0.45 })
    expect(host.submitted).toEqual([])
  })

  it('新配置一帧内生效：重绘内容读到新文本与预混色', () => {
    const host = new StubHost()
    const plugin = createWatermarkPlugin({ enabled: true, text: '旧文本' })
    createTable(host, [plugin])
    plugin.updateConfig({ text: '新文本', opacity: 0.5 })
    const painted = paintOverlay(host)
    expect(painted.texts.length).toBeGreaterThan(0)
    expect(painted.texts.every((t) => t.text === '新文本')).toBe(true)
    expect(painted.fillStyle).toBe('rgba(0, 0, 0, 0.5)')
  })

  it('开关切换即时摘除/恢复 painter', () => {
    const host = new StubHost()
    const plugin = createWatermarkPlugin({ enabled: true, text: '内部资料' })
    createTable(host, [plugin])

    plugin.updateConfig({ enabled: false })
    expect(plugin.isEnabled()).toBe(false)
    expect(skyChildren(host)).toBe(1)

    plugin.updateConfig({ enabled: true })
    expect(plugin.isEnabled()).toBe(true)
    expect(skyChildren(host)).toBe(2)
  })

  it('未挂载时只改配置，mount 按新配置生效', () => {
    const plugin = createWatermarkPlugin({ enabled: true, text: '旧' })
    plugin.updateConfig({ text: '新' })
    const host = new StubHost()
    createTable(host, [plugin])
    expect(paintOverlay(host).texts.every((t) => t.text === '新')).toBe(true)
  })
})

describe('水印锚定视口', () => {
  it('滚动只失效 body/media 带，sky 无任何提交且绘制序列逐字节不变', () => {
    const host = new StubHost()
    const plugin = createWatermarkPlugin({ enabled: true, text: '内部资料' })
    const table = createTable(host, [plugin])
    const before = paintOverlay(host)

    host.submitted.length = 0
    table.setScrollTop(4800)
    table.setScrollLeft(300)
    const kinds = new Set(host.submitted.map((s) => s.kind))
    // 滚动带失效只落在 body（本表无 media 层），sky 不波及（不平移、不重绘）
    expect(kinds.has('body')).toBe(true)
    expect(kinds.has('sky')).toBe(false)

    const after = paintOverlay(host)
    expect(after.texts).toEqual(before.texts)
    expect(after.translates).toEqual(before.translates)
    expect(after.rotations).toEqual(before.rotations)
  })

  it('容器 resize 同步 painter 视口尺寸（平铺随新视口重算）', () => {
    const host = new StubHost()
    const plugin = createWatermarkPlugin({ enabled: true, text: 'wm' })
    const table = createTable(host, [plugin])
    const full = paintOverlay(host).texts.length
    table.resize(200, 120)
    const shrunk = paintOverlay(host).texts.length
    expect(shrunk).toBeLessThan(full)
    expect(shrunk).toBeGreaterThan(0)
  })
})

describe('overlay 事件透传', () => {
  it('承载节点不可命中：覆盖全视口的水印不拦截 pointer 事件（sky 事件语义不受影响）', () => {
    const host = new StubHost()
    const table = createTable(host)
    table.use(createWatermarkPlugin({ enabled: true, text: '内部资料' }))
    const children = host.layers.get('sky')?.root.children ?? []
    const node = children[children.length - 1]
    // pickable=false 且无子节点：命中测试穿透本节点（引擎 SceneNode 契约），
    // 事件继续命中下方 body 层数据格——sky 层既有交互接线不受水印影响
    expect(node?.pickable).toBe(false)
    expect(node?.children).toEqual([])
    expect(node?.width).toBe(400)
    expect(node?.height).toBe(200)
  })
})
