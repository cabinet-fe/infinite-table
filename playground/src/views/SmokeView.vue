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
