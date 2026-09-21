// 底部 sheet tabs（对标 ultra-ui sheet-tabs）：激活白底蓝字、+ 新建、
// 右键菜单重命名/删除（删除走危险确认）、溢出箭头 + 滚轮横滚、激活 tab 自动滚入视野。

import { icon } from './icons'
import { openFixedPopup, confirmDanger } from './popup'
import type { SheetBookBundle } from './book'

export interface TabsHandle {
  /** id → 展示名（观察区 meta 用） */
  labelOf(id: string): string
  /** 重渲染 tabs（xlsx 导入重建 book 后调用） */
  refresh(): void
  destroy(): void
}

export function mountTabs(
  area: HTMLElement,
  ctx: {
    bundle: SheetBookBundle
    notify: (text: string, kind?: 'info' | 'warn') => void
    /** 切换/新建/删除后的联动刷新（公式栏重挂等） */
    onSwitched: () => void
  },
): TabsHandle {
  const bar = document.createElement('div')
  bar.className = 'sheet-app__tabs'
  const navPrev = document.createElement('button')
  navPrev.type = 'button'
  navPrev.className = 'sheet-tabs__nav is-prev'
  navPrev.title = '向左'
  navPrev.innerHTML = icon('arrowLeft')
  const navNext = document.createElement('button')
  navNext.type = 'button'
  navNext.className = 'sheet-tabs__nav is-next'
  navNext.title = '向右'
  navNext.innerHTML = icon('arrowRight')
  const viewport = document.createElement('div')
  viewport.className = 'sheet-tabs__viewport'
  const list = document.createElement('div')
  list.className = 'sheet-tabs__list'
  viewport.appendChild(list)
  const addButton = document.createElement('button')
  addButton.type = 'button'
  addButton.className = 'sheet-tab-add'
  addButton.title = '添加工作表'
  addButton.textContent = '+'
  bar.append(navPrev, viewport, navNext, addButton)
  area.appendChild(bar)

  // 本地重命名（手动右键改名，不跟随跨表引用）优先；其次 book 注册名（xlsx 导入沿用的文件名）
  const labels = new Map<string, string>()
  const labelOf = (id: string): string => labels.get(id) ?? ctx.bundle.nameOf(id)

  const refreshNav = (): void => {
    const overflow = viewport.scrollWidth > viewport.clientWidth + 1
    navPrev.style.display = overflow ? '' : 'none'
    navNext.style.display = overflow ? '' : 'none'
  }

  const scrollActiveIntoView = (): void => {
    const active = list.querySelector('.sheet-tab.is-active')
    if (active instanceof HTMLElement) {
      const left = active.offsetLeft
      const right = left + active.offsetWidth
      if (left < viewport.scrollLeft || right > viewport.scrollLeft + viewport.clientWidth) {
        viewport.scrollTo({
          left: Math.max(0, left - (viewport.clientWidth - active.offsetWidth) / 2),
          behavior: 'smooth',
        })
      }
    }
    refreshNav()
  }

  const beginRename = (tab: HTMLElement, id: string): void => {
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'sheet-tab__rename-input'
    input.maxLength = 31
    input.value = labelOf(id)
    tab.textContent = ''
    tab.appendChild(input)
    input.focus()
    input.select()
    const commit = (): void => {
      const name = input.value.trim()
      input.remove()
      renderTabs()
      if (!name || name === labelOf(id)) {
        return
      }
      const taken = ctx.bundle.ids().some((other) => labelOf(other) === name)
      if (taken) {
        ctx.notify(`无法重命名：名称“${name}”无效或已被占用`, 'warn')
        return
      }
      labels.set(id, name)
      // 改名可能改变跨表引用的名称解析面（当前 labels 不进 resolveSheet，此处为防御性全量标脏）
      ctx.bundle.invalidateFormulas()
      renderTabs()
      ctx.notify(`已重命名为 ${name}`)
    }
    input.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Enter') {
        input.blur()
      } else if (event.key === 'Escape') {
        input.value = labelOf(id)
        input.blur()
      }
    })
    input.addEventListener('blur', commit)
  }

  const removeWithConfirm = (id: string): void => {
    const name = labelOf(id)
    void confirmDanger({
      message: `确定删除工作表“${name}”吗？删除后不可恢复。`,
      confirmText: '删除',
    }).then((confirmed) => {
      if (!confirmed) {
        return
      }
      const ids = ctx.bundle.ids()
      if (ids.length <= 1) {
        ctx.notify('至少保留一个工作表', 'warn')
        return
      }
      // 活跃表不可直接删：先切到相邻表
      if (id === ctx.bundle.book.activeId) {
        const neighbor = ids.find((other) => other !== id)!
        ctx.bundle.switchTo(neighbor)
      }
      if (ctx.bundle.removeSheet(id)) {
        labels.delete(id)
        renderTabs()
        ctx.onSwitched()
        ctx.notify(`已删除 ${name}`)
      }
    })
  }

  const renderTabs = (): void => {
    list.textContent = ''
    const activeId = ctx.bundle.book.activeId
    for (const id of ctx.bundle.ids()) {
      const tab = document.createElement('button')
      tab.type = 'button'
      tab.className = `sheet-tab${id === activeId ? ' is-active' : ''}`
      tab.textContent = labelOf(id)
      tab.title = '右键重命名 / 删除'
      tab.addEventListener('click', () => {
        if (id === ctx.bundle.book.activeId) {
          return
        }
        ctx.bundle.switchTo(id)
        renderTabs()
        ctx.onSwitched()
      })
      tab.addEventListener('contextmenu', (event) => {
        event.preventDefault()
        event.stopPropagation()
        openFixedPopup(event.clientX, event.clientY, {
          build(el, close) {
            el.classList.add('sheet-popup', 'sheet-popup--menu')
            const rename = document.createElement('button')
            rename.type = 'button'
            rename.className = 'sheet-menu__item'
            rename.textContent = '重命名'
            rename.addEventListener('click', () => {
              close()
              beginRename(tab, id)
            })
            const remove = document.createElement('button')
            remove.type = 'button'
            remove.className = 'sheet-menu__item'
            remove.textContent = '删除'
            if (ctx.bundle.ids().length <= 1) {
              remove.disabled = true
            }
            remove.addEventListener('click', () => {
              close()
              removeWithConfirm(id)
            })
            el.append(rename, remove)
          },
        })
      })
      list.appendChild(tab)
    }
    window.setTimeout(scrollActiveIntoView, 0)
  }

  addButton.addEventListener('click', () => {
    const id = ctx.bundle.createSheet()
    ctx.bundle.switchTo(id)
    renderTabs()
    ctx.onSwitched()
    ctx.notify(`已新建 ${labelOf(id)}`)
  })

  const step = (direction: 1 | -1): void => {
    viewport.scrollBy({ left: direction * viewport.clientWidth * 0.8, behavior: 'smooth' })
  }
  navPrev.addEventListener('click', () => step(-1))
  navNext.addEventListener('click', () => step(1))
  viewport.addEventListener(
    'wheel',
    (event) => {
      if (event.deltaY !== 0 && viewport.scrollWidth > viewport.clientWidth) {
        event.preventDefault()
        viewport.scrollLeft += event.deltaY
      }
    },
    { passive: false },
  )

  renderTabs()

  return {
    labelOf,
    refresh() {
      // 导入重建 book 后旧 id 的重命名记录已失效，一并清掉（Map 迭代中删除当前键安全）
      for (const id of labels.keys()) {
        if (!ctx.bundle.ids().includes(id)) {
          labels.delete(id)
        }
      }
      renderTabs()
    },
    destroy() {
      bar.remove()
    },
  }
}
