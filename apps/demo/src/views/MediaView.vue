<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { mountMedia, type MediaDemo } from '../sections/media'

const containerRef = ref<HTMLDivElement | null>(null)
const demoInstance = ref<MediaDemo | null>(null)

onMounted(() => {
  if (!containerRef.value) return
  demoInstance.value = mountMedia(containerRef.value)
})
</script>

<template>
  <div class="view-container">
    <div class="view-header">
      <div class="title-row">
        <h2>图片与浮动对象</h2>
        <div class="tags">
          <span class="tag">L2 Media 分层</span>
          <span class="tag">位图 LRU 缓存</span>
          <span class="tag">无闪回退</span>
          <span class="tag">视口窗口化加载</span>
          <span class="tag">FloatObjectLayer 浮层跟随</span>
        </div>
      </div>
      <p class="desc">
        第 1 列偶数行为格内图片，经 L2 Media 独立画布层调度：视口内动态加载、位图 LRU
        池化缓存、快速滚动位图无闪回滚；浮动对象层（FloatObjectLayer）锚定在格
        (2,1)~(4,3)，滚动时帧级无抖动跟随。
      </p>
    </div>

    <div ref="containerRef" class="demo-mount-area"></div>
  </div>
</template>

<style scoped>
.view-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.view-header {
  background: #ffffff;
  border: 1px solid #e5e8eb;
  border-radius: 8px;
  padding: 16px 20px;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.title-row h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: #1f2329;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tag {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  background: #f0f4ff;
  color: #3370ff;
}
.desc {
  font-size: 13px;
  color: #646a73;
  margin: 0;
  line-height: 1.5;
}
.demo-mount-area :deep(section) {
  background: #ffffff;
  border: 1px solid #e5e8eb;
  border-radius: 8px;
  padding: 16px 20px;
}
.demo-mount-area :deep(h2),
.demo-mount-area :deep(.desc) {
  display: none;
}
</style>
