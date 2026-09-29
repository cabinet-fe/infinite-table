<script setup lang="ts">
// 总览页：项目名片 + 关键指标 + 示例导航网格。KPI 数字取自最近一次 vs-vtable 基准采样（results/）。

interface Feature {
  key: string
  icon: string
  title: string
  desc: string
}

const features: Feature[] = [
  {
    key: 'display',
    icon: '🎨',
    title: '显示能力',
    desc: '10 万行虚拟滚动 · 冻结行列 · 合并 · 逐边边框 · 自定义渲染',
  },
  {
    key: 'data-forms',
    icon: '📊',
    title: '数据供给三形态',
    desc: 'records 数组 / model 模型直挂 / rowCount + 取值钩子',
  },
  {
    key: 'interaction',
    icon: '⚡',
    title: '交互能力',
    desc: '区域拖选 · 行列 resize · 键盘导航 · 右键菜单 · 批量更新',
  },
  {
    key: 'media',
    icon: '🖼️',
    title: '图片与浮动对象',
    desc: 'L2 位图 LRU 缓存 · 窗口化加载 · 浮动对象跟随与拖拽',
  },
  {
    key: 'chart',
    icon: '📈',
    title: '单元格图表',
    desc: '格内声明图表 · Chart.js 离屏出图 · 滚动无闪回滚',
  },
  {
    key: 'editing',
    icon: '✏️',
    title: '单元格编辑',
    desc: 'SheetModel 内存模型 · 双击/键盘编辑 · 滚出视口自动提交',
  },
  {
    key: 'sheet',
    icon: '🧮',
    title: 'sheet 电子表格',
    desc: '工具栏 · 公式栏 · 底部 tabs · 查找替换 · CSV/xlsx 导入导出',
  },
  {
    key: 'report',
    icon: '📄',
    title: '报表只读快照',
    desc: '九字段快照 restore · readonly 渲染 · 浮动图随快照接线',
  },
]

const kpis = [
  { value: '1,000,000', unit: '行', label: '虚拟滚动数据规模' },
  { value: '27.3', unit: 'KB', label: '最小构建 gzip 体积' },
  { value: '17 / 22', unit: '项', label: 'vs VTable 领先指标' },
  { value: '0', unit: '依赖', label: 'core 运行时三方依赖' },
]

/** gzip 体积对比条（27.3KB vs 514.8KB，取自最近一次采样） */
const bundleBars = [
  { name: 'infinitable', kb: 27.3, width: (27.3 / 514.8) * 100, ours: true },
  { name: '@visactor/vtable', kb: 514.8, width: 100, ours: false },
]

function go(key: string): void {
  location.hash = `#/${key}`
}
</script>

<template>
  <div class="view-container home-view">
    <section class="home-hero">
      <div class="home-hero-glow"></div>
      <div class="home-hero-badge">自研 Canvas 表格引擎</div>
      <h1 class="home-hero-title">
        <span class="home-hero-mark">∞</span>
        infinitable
      </h1>
      <p class="home-hero-sub">
        零 vrender 依赖 · 分层 canvas 渲染 · 百万行虚拟滚动。原 vtable 精简版浴火重生， 自研渲染引擎
        + 表格主体 + 公式引擎 + 官方插件。
      </p>
      <div class="home-hero-actions">
        <button type="button" class="btn-primary" @click="go('display')">浏览示例</button>
        <button type="button" class="home-btn-ghost" @click="go('compare')">
          ⚡ 运行 vs VTable 对比
        </button>
      </div>
    </section>

    <section class="home-kpis">
      <div v-for="kpi in kpis" :key="kpi.label" class="home-kpi">
        <div class="home-kpi-value">
          {{ kpi.value }}<span class="home-kpi-unit">{{ kpi.unit }}</span>
        </div>
        <div class="home-kpi-label">{{ kpi.label }}</div>
      </div>
    </section>

    <section class="home-bundle">
      <div class="home-section-head">
        <h3>最小构建体积</h3>
        <span class="home-section-note"
          >bun build --minify，gzip 传输口径 · 采样详见 playground/results/</span
        >
      </div>
      <div class="home-bundle-rows">
        <div v-for="bar in bundleBars" :key="bar.name" class="home-bundle-row">
          <span class="home-bundle-name" :class="{ ours: bar.ours }">{{ bar.name }}</span>
          <div class="home-bundle-track">
            <div
              class="home-bundle-bar"
              :class="{ ours: bar.ours }"
              :style="{ width: `${Math.max(bar.width, 2)}%` }"
            ></div>
          </div>
          <span class="home-bundle-kb" :class="{ ours: bar.ours }">{{ bar.kb }} KB</span>
        </div>
      </div>
    </section>

    <section class="home-features">
      <div class="home-section-head">
        <h3>功能示例</h3>
        <span class="home-section-note">点击卡片进入对应演示</span>
      </div>
      <div class="home-feature-grid">
        <button
          v-for="feature in features"
          :key="feature.key"
          type="button"
          class="home-feature-card"
          @click="go(feature.key)"
        >
          <span class="home-feature-icon">{{ feature.icon }}</span>
          <span class="home-feature-title">{{ feature.title }}</span>
          <span class="home-feature-desc">{{ feature.desc }}</span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home-hero {
  position: relative;
  overflow: hidden;
  padding: 44px 40px 40px;
  border-radius: var(--radius-lg, 14px);
  border: 1px solid var(--border, #e7e9f0);
  background:
    radial-gradient(1200px 300px at 85% -40%, rgba(99, 102, 241, 0.16), transparent 60%),
    radial-gradient(800px 260px at 0% 120%, rgba(56, 189, 248, 0.1), transparent 60%),
    var(--surface, #fff);
}

.home-hero-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.home-hero-badge {
  display: inline-block;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.4px;
  color: var(--brand, #4f46e5);
  background: var(--brand-soft, #eef0ff);
  border: 1px solid rgba(79, 70, 229, 0.18);
  border-radius: 999px;
  padding: 3px 12px;
  margin-bottom: 16px;
}

.home-hero-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 40px;
  font-weight: 800;
  letter-spacing: -0.5px;
  margin: 0 0 12px;
  color: var(--text-1, #191b23);
}

.home-hero-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  font-size: 30px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #312e81);
  box-shadow: 0 8px 20px rgba(79, 70, 229, 0.35);
}

.home-hero-sub {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-2, #575d6e);
  max-width: 640px;
  margin: 0 0 22px;
}

.home-hero-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.home-hero-actions .btn-primary {
  font-size: 14px;
  font-weight: 600;
  padding: 10px 24px;
  border-radius: 10px;
}

.home-btn-ghost {
  font-size: 14px;
  font-weight: 600;
  padding: 10px 24px;
  border-radius: 10px;
  border: 1px solid var(--border-strong, #d9dce6);
  background: var(--surface, #fff);
  color: var(--text-1, #191b23);
  cursor: pointer;
  transition: all 0.15s ease;
}

.home-btn-ghost:hover {
  border-color: var(--brand, #4f46e5);
  color: var(--brand, #4f46e5);
  background: var(--brand-soft, #eef0ff);
}

.home-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.home-kpi {
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e7e9f0);
  border-radius: var(--radius-md, 10px);
  padding: 18px 20px 16px;
}

.home-kpi-value {
  font-size: 26px;
  font-weight: 800;
  color: var(--text-1, #191b23);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.5px;
}

.home-kpi-unit {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-3, #8a90a2);
  margin-left: 5px;
}

.home-kpi-label {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-3, #8a90a2);
}

.home-bundle,
.home-features {
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e7e9f0);
  border-radius: var(--radius-md, 10px);
  padding: 18px 20px;
}

.home-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.home-section-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-1, #191b23);
}

.home-section-note {
  font-size: 12px;
  color: var(--text-3, #8a90a2);
}

.home-bundle-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.home-bundle-row {
  display: grid;
  grid-template-columns: 150px 1fr 84px;
  align-items: center;
  gap: 14px;
}

.home-bundle-name {
  font-size: 13px;
  color: var(--text-2, #575d6e);
  font-family: var(--mono, ui-monospace, Menlo, monospace);
}

.home-bundle-name.ours {
  color: var(--brand, #4f46e5);
  font-weight: 700;
}

.home-bundle-track {
  height: 14px;
  border-radius: 7px;
  background: #f1f2f7;
  overflow: hidden;
}

.home-bundle-bar {
  height: 100%;
  border-radius: 7px;
  background: #c6cad8;
}

.home-bundle-bar.ours {
  background: linear-gradient(90deg, #4f46e5, #818cf8);
}

.home-bundle-kb {
  font-size: 13px;
  color: var(--text-2, #575d6e);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.home-bundle-kb.ours {
  color: var(--brand, #4f46e5);
  font-weight: 700;
}

.home-feature-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.home-feature-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  text-align: left;
  padding: 16px 18px;
  border: 1px solid var(--border, #e7e9f0);
  border-radius: var(--radius-md, 10px);
  background: var(--surface, #fff);
  cursor: pointer;
  transition: all 0.15s ease;
}

.home-feature-card:hover {
  border-color: rgba(79, 70, 229, 0.45);
  background: linear-gradient(180deg, rgba(99, 102, 241, 0.05), transparent 70%);
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(23, 25, 35, 0.08);
}

.home-feature-icon {
  font-size: 22px;
  line-height: 1;
}

.home-feature-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-1, #191b23);
}

.home-feature-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-3, #8a90a2);
}

@media (max-width: 1080px) {
  .home-kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
