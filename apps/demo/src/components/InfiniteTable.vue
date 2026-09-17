<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { ListTable, type ListTableOptions } from '@infinite-table/core'
import { isSmokeMode } from '../mount'

const props = defineProps<{
  options: ListTableOptions
  width?: number
  height?: number
}>()

const emit = defineEmits<{
  (e: 'ready', payload: { table: ListTable; container: HTMLElement }): void
}>()

const containerRef = ref<HTMLDivElement | null>(null)
let tableInstance: ListTable | null = null
let handleWheel: ((e: WheelEvent) => void) | null = null

onMounted(() => {
  const container = containerRef.value
  if (!container) return

  const dpr = isSmokeMode() ? 1 : window.devicePixelRatio || 1
  const table = new ListTable({
    ...props.options,
    hostOptions: { container, dpr },
  })
  tableInstance = table

  handleWheel = (e: WheelEvent) => {
    e.preventDefault()
    table.scrollBy(e.deltaX, e.deltaY)
  }

  container.addEventListener('wheel', handleWheel, { passive: false })

  emit('ready', { table, container })
})

onUnmounted(() => {
  // 卸载即释放表格资源：RenderHost canvas、场景事件监听、ImageService 全部随 destroy 清理
  const container = containerRef.value
  if (container && handleWheel) {
    container.removeEventListener('wheel', handleWheel)
  }
  handleWheel = null
  tableInstance?.destroy()
  tableInstance = null
})

defineExpose({
  getTable: () => tableInstance,
  getContainer: () => containerRef.value,
})
</script>

<template>
  <div
    ref="containerRef"
    class="table-mount"
    :style="{
      width: `${width ?? options.width}px`,
      height: `${height ?? options.height}px`,
    }"
  ></div>
</template>
