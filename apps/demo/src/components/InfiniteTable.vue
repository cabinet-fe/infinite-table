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

onMounted(() => {
  const container = containerRef.value
  if (!container) return

  const dpr = isSmokeMode() ? 1 : window.devicePixelRatio || 1
  const table = new ListTable({
    ...props.options,
    hostOptions: { container, dpr },
  })
  tableInstance = table

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault()
    table.scrollBy(e.deltaX, e.deltaY)
  }

  container.addEventListener('wheel', handleWheel, { passive: false })

  emit('ready', { table, container })
})

onUnmounted(() => {
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
