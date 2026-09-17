import { describe, expect, it } from 'vitest';

import { createTextEditor, type TextEditorKeyAction } from './text-editor';
import { createFakeDoc, FakeEditorHost } from '../testing/fake-editor-dom';

describe('文本编辑器', () => {
  it('缺省单行 input，multiline 走 textarea', () => {
    const single = createFakeDoc();
    createTextEditor({ doc: single.doc });
    const multi = createFakeDoc();
    createTextEditor({ doc: multi.doc, multiline: true });
    expect(single.created).toHaveLength(1);
    expect(single.created[0]!.tagName).toBe('input');
    expect(multi.created).toHaveLength(1);
    expect(multi.created[0]!.tagName).toBe('textarea');
  });

  it('open 挂载到宿主、按视口矩形定位、赋初值并聚焦', () => {
    const { doc, created } = createFakeDoc();
    const host = new FakeEditorHost();
    const editor = createTextEditor({ doc });
    const actions: TextEditorKeyAction[] = [];
    editor.onKey((action) => actions.push(action));

    editor.open(host, { x: 148, y: 36, width: 100, height: 32 }, 'a');
    const element = created[0]!;
    expect(host.children).toEqual([element]);
    expect(element.style).toEqual({
      position: 'absolute',
      left: '148px',
      top: '36px',
      width: '100px',
      height: '32px',
    });
    expect(element.value).toBe('a');
    expect(element.focusCalls).toBe(1);
    expect(actions).toEqual([]);
  });

  it('getValue 读当前编辑值', () => {
    const { doc, created } = createFakeDoc();
    const editor = createTextEditor({ doc });
    editor.open(new FakeEditorHost(), { x: 0, y: 0, width: 10, height: 10 }, 'a');
    const element = created[0]!;
    element.value = 'edited';
    expect(editor.getValue()).toBe('edited');
  });

  it('键盘语义：Esc 取消、Enter 提交下移、Tab 提交右移，均拦截默认行为与冒泡', () => {
    const { doc, created } = createFakeDoc();
    const editor = createTextEditor({ doc });
    const actions: TextEditorKeyAction[] = [];
    editor.onKey((action) => actions.push(action));
    editor.open(new FakeEditorHost(), { x: 0, y: 0, width: 10, height: 10 }, '');
    const element = created[0]!;

    const escape = element.dispatchKey('Escape');
    expect(actions).toEqual(['cancel']);
    expect(escape.prevented).toBe(true);
    expect(escape.stopped).toBe(true);

    const enter = element.dispatchKey('Enter');
    expect(actions).toEqual(['cancel', 'commitDown']);
    expect(enter.prevented).toBe(true);
    expect(enter.stopped).toBe(true);

    const tab = element.dispatchKey('Tab');
    expect(actions).toEqual(['cancel', 'commitDown', 'commitRight']);
    expect(tab.prevented).toBe(true);
    expect(tab.stopped).toBe(true);

    // 其余按键不产生语义动作
    element.dispatchKey('a');
    expect(actions).toEqual(['cancel', 'commitDown', 'commitRight']);
  });

  it('close 摘除元素、解绑键盘并幂等；重开后键盘接线恢复', () => {
    const { doc, created } = createFakeDoc();
    const host = new FakeEditorHost();
    const editor = createTextEditor({ doc });
    const actions: TextEditorKeyAction[] = [];
    editor.onKey((action) => actions.push(action));
    const element = created[0]!;

    editor.open(host, { x: 0, y: 0, width: 10, height: 10 }, 'a');
    editor.close();
    expect(host.children).toEqual([]);
    editor.close();
    expect(host.children).toEqual([]);

    // 关闭后按键不再产生动作；重开后恢复
    editor.open(host, { x: 0, y: 0, width: 10, height: 10 }, 'b');
    editor.close();
    element.dispatchKey('Enter');
    expect(actions).toEqual([]);
    editor.open(host, { x: 0, y: 0, width: 10, height: 10 }, 'c');
    element.dispatchKey('Enter');
    expect(actions).toEqual(['commitDown']);
  });

  it('无 DOM 环境且未注入 doc 时抛错提示', () => {
    const globalDoc = globalThis.document;
    // @ts-expect-error 测试模拟无 DOM 环境
    delete globalThis.document;
    try {
      expect(() => createTextEditor()).toThrow('createTextEditor 需要 DOM 文档');
    } finally {
      globalThis.document = globalDoc;
    }
  });
});
