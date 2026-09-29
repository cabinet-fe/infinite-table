<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { VsProgress } from '../bench/vs/scenarios'

// vs VTable 性能对比页：按钮触发在当前页面跑同口径对比（数据/视口/跑序与 scripts/vs.mjs 完全一致），
// 进度条实时展示当前规模 × 库 × 场景，跑完渲染自包含报告（renderReportHtml）。
// 对比引擎（含 @visactor/vtable）经动态 import 独立分包，仅在本页触发时才加载。

const running = ref(false)
const progress = ref<VsProgress | null>(null)
const reportHtml = ref('')
const errorText = ref('')
const elapsedMs = ref(0)
const stageRef = ref<HTMLDivElement | null>(null)
const hostRef = ref<HTMLDivElement | null>(null)
const reportRef = ref<HTMLDivElement | null>(null)

declare global {
  interface Window {
    __VS_REPORT__?: unknown
  }
}

let elapsedTimer: ReturnType<typeof setInterval> | null = null
let resizeObserver: ResizeObserver | null = null

/** 对比视口 1280×720 按容器宽等比缩放展示（transform 不影响布局尺寸，两库测量口径不变） */
function applyStageScale(): void {
  const stage = stageRef.value
  const host = hostRef.value
  if (!stage || !host) return
  const scale = Math.min(1, stage.clientWidth / 1280)
  host.style.transform = `scale(${scale})`
  host.style.transformOrigin = '0 0'
  stage.style.height = `${Math.round(720 * scale)}px`
}

const progressLabel = computed(() => {
  const p = progress.value
  if (!p) return ''
  const scale = p.scale >= 10_000 ? `${p.scale / 10_000} 万行` : `${p.scale} 行`
  return [scale, p.library, p.scenario].filter(Boolean).join(' · ')
})

async function run(): Promise<void> {
  if (running.value || !hostRef.value) return
  running.value = true
  errorText.value = ''
  reportHtml.value = ''
  progress.value = { percent: 0, scale: 100_000, library: '', scenario: '准备数据' }
  const t0 = performance.now()
  elapsedMs.value = 0
  elapsedTimer = setInterval(() => {
    elapsedMs.value = performance.now() - t0
  }, 200)
  try {
    const [
      { oursLibrary, vtableLibrary },
      { runComparison },
      { buildComparisonReport, renderReportHtml },
    ] = await Promise.all([
      import('../bench/vs/adapters'),
      import('../bench/vs/scenarios'),
      import('../bench/vs/report'),
    ])
    const runResult = await runComparison(hostRef.value, [oursLibrary, vtableLibrary], (p) => {
      progress.value = p
    })
    const report = buildComparisonReport(runResult)
    reportHtml.value = renderReportHtml(report)
    window.__VS_REPORT__ = report
    await nextTick()
    reportRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (error) {
    errorText.value = error instanceof Error ? (error.stack ?? error.message) : String(error)
  } finally {
    running.value = false
    if (elapsedTimer) {
      clearInterval(elapsedTimer)
      elapsedTimer = null
    }
    elapsedMs.value = performance.now() - t0
  }
}

onMounted(() => {
  applyStageScale()
  resizeObserver = new ResizeObserver(() => applyStageScale())
  if (stageRef.value) {
    resizeObserver.observe(stageRef.value)
  }
  // 驱动脚本自动模式：?vsrun=1 直接开跑（scripts/vs.mjs 提取 window.__VS_REPORT__ 与 #vs-report）
  if (new URLSearchParams(location.search).has('vsrun')) {
    void run()
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (elapsedTimer) {
    clearInterval(elapsedTimer)
  }
})
</script>

<template>
  <div class="view-container">
    <div class="view-header">
      <div class="title-row">
        <h2>性能对比：infinitable vs @visactor/vtable</h2>
        <div class="tags">
          <span class="tag">同数据同口径</span>
          <span class="tag">10 万 / 100 万行 × 20 列</span>
          <span class="tag">对称跑序取均值</span>
          <span class="tag">页内真实渲染</span>
        </div>
      </div>
      <p class="desc">
        同一份 10 万 / 100 万行 × 20 列数据、同视口 1280×720，在两库各跑一遍：TTFF / 构造 / 稳态滚动
        FPS 与 JS 耗时 / 大幅跳转 / 逐格写吞吐 / 批量写 / 整表重建。每规模按 [infinitable, VTable,
        VTable, infinitable] 对称跑序取均值，抗 JIT 与顺序偏差。全程约 2~4 分钟，
        期间下方视口可实时看到两库交替渲染与滚动。
      </p>
    </div>

    <div class="vs-control">
      <button type="button" class="btn-primary vs-run-btn" :disabled="running" @click="run">
        <span v-if="running" class="spinner"></span>
        <span v-else class="vs-run-icon">⚡</span>
        {{ running ? '对比运行中…' : '运行对比' }}
      </button>
      <span v-if="!running && !reportHtml && !errorText" class="vs-control-hint">
        点击按钮开始，两库将交替在下方视口内渲染百万行数据
      </span>
      <span v-if="!running && reportHtml" class="vs-control-hint done">
        ✓ 对比完成（耗时 {{ (elapsedMs / 1000).toFixed(0) }}s），可再次运行复测
      </span>
    </div>

    <div v-if="running || progress" class="vs-progress-card">
      <div class="vs-progress-head">
        <span class="vs-progress-spinner"></span>
        <span class="vs-progress-label">{{ progressLabel }}</span>
        <span class="vs-progress-percent">{{ progress?.percent ?? 0 }}%</span>
        <span class="vs-progress-elapsed">{{ (elapsedMs / 1000).toFixed(1) }}s</span>
      </div>
      <div class="vs-progress-track">
        <div class="vs-progress-bar" :style="{ width: `${progress?.percent ?? 0}%` }"></div>
      </div>
      <div class="vs-progress-note">
        2 个数据规模 × 4 轮对称跑序（infinitable → VTable → VTable → infinitable）× 6 组场景
      </div>
    </div>

    <div v-show="!reportHtml" class="vs-stage-card">
      <div ref="stageRef" class="vs-stage">
        <div ref="hostRef" class="vs-stage-host"></div>
        <div v-if="!running" class="vs-stage-idle">
          <span class="vs-stage-idle-icon">♾️</span>
          <p>对比运行时，两库的表格将在此视口内交替渲染</p>
        </div>
      </div>
    </div>

    <div v-if="errorText" class="vs-error">
      <div class="vs-error-title">对比运行失败</div>
      <pre>{{ errorText }}</pre>
    </div>

    <div
      v-if="reportHtml"
      ref="reportRef"
      id="vs-report"
      class="vs-report-host"
      v-html="reportHtml"
    ></div>
  </div>
</template>

<style scoped>
.vs-control {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.vs-run-btn {
  font-size: 14px;
  font-weight: 600;
  padding: 10px 28px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.vs-run-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.vs-run-icon {
  font-size: 15px;
  line-height: 1;
}

.vs-control-hint {
  font-size: 13px;
  color: var(--text-3, #8a90a2);
}

.vs-control-hint.done {
  color: #15803d;
  font-weight: 500;
}

.vs-progress-card {
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e7e9f0);
  border-radius: var(--radius-md, 10px);
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vs-progress-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.vs-progress-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-1, #191b23);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.vs-progress-percent {
  font-weight: 700;
  color: var(--brand, #4f46e5);
  font-variant-numeric: tabular-nums;
}

.vs-progress-elapsed {
  color: var(--text-3, #8a90a2);
  font-variant-numeric: tabular-nums;
  min-width: 52px;
  text-align: right;
}

.vs-progress-spinner {
  flex: none;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(79, 70, 229, 0.25);
  border-top-color: var(--brand, #4f46e5);
  border-radius: 50%;
  animation: vs-spin 0.8s linear infinite;
}

@keyframes vs-spin {
  to {
    transform: rotate(360deg);
  }
}

.vs-progress-track {
  height: 8px;
  border-radius: 4px;
  background: linear-gradient(90deg, #eef0fa, #e7e9f0);
  overflow: hidden;
}

.vs-progress-bar {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--brand, #4f46e5), #818cf8);
  transition: width 0.3s ease;
}

.vs-progress-note {
  font-size: 12px;
  color: var(--text-3, #8a90a2);
}

.vs-stage-card {
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e7e9f0);
  border-radius: var(--radius-md, 10px);
  padding: 12px;
}

.vs-stage {
  position: relative;
  overflow: hidden;
  border-radius: 6px;
  background: repeating-conic-gradient(#f2f3f8 0% 25%, #ffffff 0% 50%) 0 0 / 20px 20px;
  height: 405px;
}

.vs-stage-host {
  position: absolute;
  left: 0;
  top: 0;
  width: 1280px;
  height: 720px;
}

.vs-stage-idle {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-3, #8a90a2);
  font-size: 13px;
}

.vs-stage-idle-icon {
  font-size: 34px;
  opacity: 0.5;
}

.vs-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: var(--radius-md, 10px);
  padding: 14px 18px;
  color: #b91c1c;
}

.vs-error-title {
  font-weight: 600;
  margin-bottom: 8px;
}

.vs-error pre {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow: auto;
}

.vs-report-host {
  margin-top: 4px;
}
</style>
