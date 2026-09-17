<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { mountDataForms } from '../sections/data-forms'
import { mountDisplay } from '../sections/display'
import { mountInteraction } from '../sections/interaction'
import { mountMedia } from '../sections/media'
import { mountEditing } from '../sections/editing'
import { runSmoke, type SmokeResult } from '../smoke'
import type { DemoHandles } from '../main'

const running = ref(false)
const result = ref<SmokeResult | null>(null)
const stagingRef = ref<HTMLDivElement | null>(null)

async function startSmoke() {
  if (running.value || !stagingRef.value) return
  running.value = true
  result.value = null

  // 清空测试暂存区
  stagingRef.value.innerHTML = ''

  try {
    const demos: DemoHandles = {
      dataForms: mountDataForms(stagingRef.value),
      display: mountDisplay(stagingRef.value),
      interaction: mountInteraction(stagingRef.value),
      media: mountMedia(stagingRef.value),
      editing: mountEditing(stagingRef.value),
    }

    await runSmoke(demos)
    result.value = window.__SMOKE__ ?? null
  } catch (err) {
    result.value = {
      done: true,
      pass: false,
      total: 0,
      failures: [err instanceof Error ? err.message : String(err)],
    }
  } finally {
    running.value = false
  }
}

onMounted(() => {
  if (window.__SMOKE__) {
    result.value = window.__SMOKE__
  }
})
</script>

<template>
  <div class="view-container">
    <div class="view-header">
      <div class="title-row">
        <h2>自动化冒烟巡检 (Smoke Test)</h2>
        <div class="tags">
          <span class="tag">端到端断言</span>
          <span class="tag">像素级校验</span>
          <span class="tag">事件仿真</span>
          <span class="tag">滚动/编辑闭环</span>
        </div>
      </div>
      <p class="desc">
        内置冒烟自检套件：覆盖分层画布像素采样（冻结/合并/逐边边框/自定义渲染）、合成事件调度（拖选/Resize/键盘/触控）、图片
        LRU 与无闪回滚、编辑状态机及滚出提交等 20+ 项高要求断言。
      </p>
    </div>

    <div class="action-card">
      <div class="action-row">
        <button type="button" class="btn-primary" :disabled="running" @click="startSmoke">
          <span v-if="running" class="spinner"></span>
          {{ running ? '冒烟测试运行中…' : '立即执行冒烟自检' }}
        </button>
        <div v-if="result" class="result-badge" :class="{ pass: result.pass, fail: !result.pass }">
          <span class="dot"></span>
          {{
            result.pass
              ? `全部通过 (${result.total}/${result.total})`
              : `发现异常 (${result.failures.length}/${result.total})`
          }}
        </div>
      </div>

      <div v-if="result && result.failures.length > 0" class="failure-list">
        <div class="failure-title">失败项清单：</div>
        <ul>
          <li v-for="(f, i) in result.failures" :key="i">{{ f }}</li>
        </ul>
      </div>
    </div>

    <!-- 冒烟执行时的测试挂载区（对用户隐藏或低可视展示） -->
    <div ref="stagingRef" class="smoke-staging" :class="{ active: running }"></div>
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
.action-card {
  background: #ffffff;
  border: 1px solid #e5e8eb;
  border-radius: 8px;
  padding: 20px;
}
.action-row {
  display: flex;
  align-items: center;
  gap: 16px;
}
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: #3370ff;
  color: #ffffff;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-primary:hover:not(:disabled) {
  background: #255adb;
}
.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.result-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  padding: 6px 12px;
  border-radius: 6px;
}
.result-badge.pass {
  background: #eaf8f1;
  color: #00b42a;
}
.result-badge.fail {
  background: #ffece8;
  color: #f53f3f;
}
.result-badge .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}
.failure-list {
  margin-top: 16px;
  padding: 12px;
  border-radius: 6px;
  background: #fff2f0;
  border: 1px solid #ffccc7;
  color: #cf1322;
  font-size: 13px;
}
.failure-title {
  font-weight: 600;
  margin-bottom: 6px;
}
.failure-list ul {
  margin: 0;
  padding-left: 20px;
}
.smoke-staging {
  position: absolute;
  left: -9999px;
  top: -9999px;
  opacity: 0;
  pointer-events: none;
}
</style>
