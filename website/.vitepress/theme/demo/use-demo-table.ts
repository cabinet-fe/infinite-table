import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { ListTable, type ListTableOptions } from '@infinitable/core'

type DemoOptions = Omit<ListTableOptions, 'width' | 'height' | 'hostOptions'>

/**
 * 文档演示用的表格生命周期封装：挂载时构造、容器宽度变化时 resize、卸载时销毁。
 * 同时转发鼠标滚轮（引擎内置触控/键盘/滚动条，滚轮由宿主接线）。
 */
export function useDemoTable(createOptions: (width: number) => DemoOptions, height: number) {
  const container = ref<HTMLElement | null>(null)
  const table = shallowRef<ListTable | null>(null)
  let dispose: (() => void) | undefined

  onMounted(() => {
    const element = container.value
    if (!element) {
      return
    }
    const width = Math.max(320, element.clientWidth)
    const instance = new ListTable({
      ...createOptions(width),
      width,
      height,
      hostOptions: { container: element },
    })
    table.value = instance

    const onWheel = (event: WheelEvent): void => {
      if (instance.usesNativeScrollbar) {
        return
      }
      event.preventDefault()
      instance.scrollBy(event.deltaX, event.deltaY)
    }
    element.addEventListener('wheel', onWheel, { passive: false })

    const observer = new ResizeObserver(() => {
      const next = element.clientWidth
      if (next > 0) {
        instance.resize(next, height)
      }
    })
    observer.observe(element)

    dispose = () => {
      observer.disconnect()
      element.removeEventListener('wheel', onWheel)
      instance.destroy()
    }
  })

  onBeforeUnmount(() => {
    dispose?.()
    dispose = undefined
    table.value = null
  })

  return { container, table }
}
