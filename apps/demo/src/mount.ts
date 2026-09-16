// 演示区装配的公共件：建 section DOM、挂表（滚轮接线）、按钮与状态行。

import { ListTable, type ListTableOptions } from '@infinite-table/core';

export interface DemoMount {
  container: HTMLElement;
  table: ListTable;
}

/** 是否处于冒烟模式（?smoke=1）：dpr 锁 1，保证页内像素断言确定性 */
export function isSmokeMode(): boolean {
  return new URLSearchParams(location.search).has('smoke');
}

export function createSection(root: HTMLElement, title: string, desc: string): HTMLElement {
  const section = document.createElement('section');
  const heading = document.createElement('h2');
  heading.textContent = title;
  const paragraph = document.createElement('p');
  paragraph.className = 'desc';
  paragraph.textContent = desc;
  section.append(heading, paragraph);
  root.appendChild(section);
  return section;
}

export function createSubSection(section: HTMLElement, title: string): HTMLElement {
  const heading = document.createElement('h3');
  heading.textContent = title;
  section.appendChild(heading);
  return section;
}

/**
 * 挂一个表演示：建相对定位容器承载四层 canvas 并创建 ListTable。
 * core 侧滚动接线为触控/键盘；鼠标滚轮由宿主（本 demo）接线到 scrollBy。
 */
export function mountTable(section: HTMLElement, options: ListTableOptions): DemoMount {
  const container = document.createElement('div');
  container.className = 'table-mount';
  container.style.width = `${options.width}px`;
  container.style.height = `${options.height}px`;
  section.appendChild(container);
  const table = new ListTable({
    ...options,
    hostOptions: { container, dpr: isSmokeMode() ? 1 : window.devicePixelRatio || 1 },
  });
  container.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      table.scrollBy(e.deltaX, e.deltaY);
    },
    { passive: false },
  );
  return { container, table };
}

export function addButton(section: HTMLElement, label: string, onClick: () => void): HTMLElement {
  let toolbar = section.querySelector<HTMLElement>(':scope > .toolbar');
  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    section.appendChild(toolbar);
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  toolbar.appendChild(button);
  return button;
}

/** 加一行状态文本（订阅事件的可见化）；返回的元素直接改 textContent */
export function addStatus(section: HTMLElement, initial = ''): HTMLElement {
  const status = document.createElement('div');
  status.className = 'status';
  status.textContent = initial;
  section.appendChild(status);
  return status;
}
