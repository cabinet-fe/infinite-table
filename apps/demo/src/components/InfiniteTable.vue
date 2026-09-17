<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { ListTable, type ListTableOptions } from '@infinite-table/core'
import { attachWheel, resolveDpr } from '../mount'

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
let detachWheel: (() => void) | null = null

onMounted(() => {
  const container = containerRef.value
  if (!container) return

  const table = new ListTable({
    ...props.options,
    hostOptions: { container, dpr: resolveDpr() },
  })
  tableInstance = table
  detachWheel = attachWheel(container, table)

  emit('ready', { table, container })
})

onUnmounted(() => {
  // 卸载即释放表格资源：滚轮接线解绑，RenderHost canvas、场景事件监听、ImageService 全部随 destroy 清理
  detachWheel?.()
  detachWheel = null
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
