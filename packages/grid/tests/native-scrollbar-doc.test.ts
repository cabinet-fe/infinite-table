// @vitest-environment happy-dom
// 原生滚动条 DOM 装配的文档源注入缝（无头收尾）：wrapper/spacer/viewport 三件套经
// 注入 doc 创建，缺省链路（未注入）取 globalThis.document 等价装配；SSR/测试宿主
// 可注入自有文档接管元素创建来源。离屏空转语义见 native-scrollbar.test.ts。

import { describe, expect, it } from 'vitest'

import { NativeScrollbarHost, type NativeScrollbarDoc } from '../src/native-scrollbar'
import { ScrollManager } from '../src/scroll-manager'

function mountHost(parent: HTMLElement, doc?: NativeScrollbarDoc) {
  return new NativeScrollbarHost({
    parent,
    doc,
    width: 300,
    height: 200,
    scroll: new ScrollManager(),
  })
}

describe('NativeScrollbarHost 文档源注入', () => {
  it('缺省链路：未注入 doc 时取 globalThis.document 装配（浏览器档同路径）', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const host = mountHost(parent)
    const wrapper = parent.querySelector<HTMLElement>('[data-native-scroll]')
    expect(wrapper).not.toBeNull()
    expect(host.viewportElement).toBe(wrapper!.firstElementChild!.firstElementChild)
    host.destroy()
    expect(parent.querySelector('[data-native-scroll]')).toBeNull()
  })

  it('注入 doc：wrapper/spacer/viewport 三件套经注入源创建并照常装配', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const created: string[] = []
    const doc: NativeScrollbarDoc = {
      createElement: (tag) => {
        created.push(tag)
        return document.createElement(tag)
      },
    }
    const host = mountHost(parent, doc)
    expect(created).toEqual(['div', 'div', 'div'])
    const wrapper = parent.querySelector<HTMLElement>('[data-native-scroll]')
    expect(wrapper).not.toBeNull()
    expect(host.viewportElement).toBe(wrapper!.firstElementChild!.firstElementChild)
    host.destroy()
    expect(parent.childNodes.length).toBe(0)
  })
})
