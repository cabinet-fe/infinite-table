import { describe, expect, it } from 'vitest'

import { createTextEditor, type TextEditorKeyAction } from '../../src/editing/text-editor'
import { createFakeDoc, FakeEditorHost } from '../testing/fake-editor-dom'

describe('文本编辑器', () => {
  it('缺省单行 input，multiline 走 textarea', () => {
    const single = createFakeDoc()
    createTextEditor({ doc: single.doc })
    const multi = createFakeDoc()
    createTextEditor({ doc: multi.doc, multiline: true })
    expect(single.created).toHaveLength(1)
    expect(single.created[0]!.tagName).toBe('input')
    expect(multi.created).toHaveLength(1)
    expect(multi.created[0]!.tagName).toBe('textarea')
  })

  it('open 挂载到宿主、按视口矩形定位、赋初值并聚焦', () => {
    const { doc, created } = createFakeDoc()
    const host = new FakeEditorHost()
    const editor = createTextEditor({ doc })
    const actions: TextEditorKeyAction[] = []
    editor.onKey((action) => actions.push(action))

    editor.open(host, { x: 148, y: 36, width: 100, height: 32 }, 'a')
    const element = created[0]!
    expect(host.children).toEqual([element])
    // 定位矩形向外扩 2px 边框宽的一半（边框骑格缘，内外各 1px）；基础视觉含白底与灰边
    expect(element.style).toMatchObject({
      position: 'absolute',
      left: '147px',
      top: '35px',
      width: '102px',
      height: '34px',
    })
    expect(element.style.cssText).toContain('border:2px solid #d9d9d9')
    expect(element.value).toBe('a')
    expect(element.focusCalls).toBe(1)
    expect(actions).toEqual([])
  })

  it('getValue 读当前编辑值', () => {
    const { doc, created } = createFakeDoc()
    const editor = createTextEditor({ doc })
    editor.open(new FakeEditorHost(), { x: 0, y: 0, width: 10, height: 10 }, 'a')
    const element = created[0]!
    element.value = 'edited'
    expect(editor.getValue()).toBe('edited')
  })

  it('moveTo 滚动跟随重定位：不重挂载、不抢焦点、不改值', () => {
    const { doc, created } = createFakeDoc()
    const host = new FakeEditorHost()
    const editor = createTextEditor({ doc })
    editor.open(host, { x: 148, y: 36, width: 100, height: 32 }, 'a')
    const element = created[0]!
    element.value = '输入中'
    editor.moveTo({ x: 20, y: 200, width: 80, height: 24 })
    expect(element.style.left).toBe('19px')
    expect(element.style.top).toBe('199px')
    expect(element.style.width).toBe('82px')
    expect(element.style.height).toBe('26px')
    expect(element.style.position).toBe('absolute')
    expect(host.children).toEqual([element])
    expect(element.focusCalls).toBe(1)
    expect(element.value).toBe('输入中')
  })

  it('键盘语义：Esc 取消、Enter 提交下移、Tab 提交右移，均拦截默认行为与冒泡', () => {
    const { doc, created } = createFakeDoc()
    const editor = createTextEditor({ doc })
    const actions: TextEditorKeyAction[] = []
    editor.onKey((action) => actions.push(action))
    editor.open(new FakeEditorHost(), { x: 0, y: 0, width: 10, height: 10 }, '')
    const element = created[0]!

    const escape = element.dispatchKey('Escape')
    expect(actions).toEqual(['cancel'])
    expect(escape.prevented).toBe(true)
    expect(escape.stopped).toBe(true)

    const enter = element.dispatchKey('Enter')
    expect(actions).toEqual(['cancel', 'commitDown'])
    expect(enter.prevented).toBe(true)
    expect(enter.stopped).toBe(true)

    const tab = element.dispatchKey('Tab')
    expect(actions).toEqual(['cancel', 'commitDown', 'commitRight'])
    expect(tab.prevented).toBe(true)
    expect(tab.stopped).toBe(true)

    // 其余按键不产生语义动作
    element.dispatchKey('a')
    expect(actions).toEqual(['cancel', 'commitDown', 'commitRight'])
  })

  it('字符上限：设定后初值与提交口径均截断、元素接线原生 maxLength；未配置不截断', () => {
    // 设定上限 3：元素接线原生 maxLength（真实 DOM 输入期原生截断），open 初值超限截断
    const { doc, created } = createFakeDoc()
    const editor = createTextEditor({ doc, maxLength: 3 })
    editor.open(new FakeEditorHost(), { x: 0, y: 0, width: 10, height: 10 }, 'abcdef')
    const element = created[0]!
    expect(element.maxLength).toBe(3)
    expect(element.value).toBe('abc')

    // 程序化赋值绕过原生 maxLength（真实 DOM 亦如此）：提交口径兜底截断
    element.value = 'abcdef'
    expect(editor.getValue()).toBe('abc')

    // 未配置：不接线、初值与提交口径均不截断（缺省行为不变）
    const plain = createFakeDoc()
    const unlimited = createTextEditor({ doc: plain.doc })
    unlimited.open(new FakeEditorHost(), { x: 0, y: 0, width: 10, height: 10 }, 'abcdef')
    const plainElement = plain.created[0]!
    expect(plainElement.maxLength).toBeUndefined()
    expect(plainElement.value).toBe('abcdef')
    plainElement.value = 'abcdefgh'
    expect(unlimited.getValue()).toBe('abcdefgh')
  })

  it('close 摘除元素、解绑键盘并幂等；重开后键盘接线恢复', () => {
    const { doc, created } = createFakeDoc()
    const host = new FakeEditorHost()
    const editor = createTextEditor({ doc })
    const actions: TextEditorKeyAction[] = []
    editor.onKey((action) => actions.push(action))
    const element = created[0]!

    editor.open(host, { x: 0, y: 0, width: 10, height: 10 }, 'a')
    editor.close()
    expect(host.children).toEqual([])
    editor.close()
    expect(host.children).toEqual([])

    // 关闭后按键不再产生动作；重开后恢复
    editor.open(host, { x: 0, y: 0, width: 10, height: 10 }, 'b')
    editor.close()
    element.dispatchKey('Enter')
    expect(actions).toEqual([])
    editor.open(host, { x: 0, y: 0, width: 10, height: 10 }, 'c')
    element.dispatchKey('Enter')
    expect(actions).toEqual(['commitDown'])
  })

  it('onBlur 订阅失焦动作：元素 blur 触发，重复订阅替换前一处理器', () => {
    const { doc, created } = createFakeDoc()
    const editor = createTextEditor({ doc })
    const calls: string[] = []
    const host = new FakeEditorHost()
    editor.open(host, { x: 0, y: 0, width: 10, height: 10 }, 'a')
    const element = created[0]!

    editor.onBlur(() => calls.push('first'))
    element.dispatchBlur()
    expect(calls).toEqual(['first'])

    // 与 onKey 同口径：重复订阅替换，前一处理器不再触发
    editor.onBlur(() => calls.push('second'))
    element.dispatchBlur()
    expect(calls).toEqual(['first', 'second'])
  })

  it('close 后失焦不再触发；重开后接线恢复', () => {
    const { doc, created } = createFakeDoc()
    const editor = createTextEditor({ doc })
    let calls = 0
    editor.onBlur(() => calls++)
    const host = new FakeEditorHost()
    const element = created[0]!

    editor.open(host, { x: 0, y: 0, width: 10, height: 10 }, 'a')
    element.dispatchBlur()
    expect(calls).toBe(1)

    editor.close()
    element.dispatchBlur()
    expect(calls).toBe(1)

    editor.open(host, { x: 0, y: 0, width: 10, height: 10 }, 'b')
    element.dispatchBlur()
    expect(calls).toBe(2)
  })

  it('无 DOM 环境且未注入 doc 时抛错提示', () => {
    const globalDoc = globalThis.document
    // @ts-expect-error 测试模拟无 DOM 环境
    delete globalThis.document
    try {
      expect(() => createTextEditor()).toThrow('createTextEditor 需要 DOM 文档')
    } finally {
      globalThis.document = globalDoc
    }
  })
})
