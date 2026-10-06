<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  defineComponent,
  h,
  defineAsyncComponent,
} from 'vue'
import { isSmokeMode } from './mount'
import { mountDataForms } from './sections/data-forms'
import { mountChart, type ChartDemo } from './sections/chart'
import { mountDisplay } from './sections/display'
import { mountWatermark, type WatermarkDemo } from './sections/watermark'
import { mountPrint, type PrintDemo } from './sections/print'
import { mountInteraction } from './sections/interaction'
import { mountMedia } from './sections/media'
import { mountEditing } from './sections/editing'
import { createSheetHandle, mountSheet } from './sections/sheet'
import { createReportHandle, mountReport, type ReportDemo } from './sections/report'
import { runSmoke } from './smoke'
import type { DemoHandles } from './main'

import HomeView from './views/HomeView.vue'
import DataFormsView from './views/DataFormsView.vue'
import DisplayView from './views/DisplayView.vue'
import InteractionView from './views/InteractionView.vue'
import MediaView from './views/MediaView.vue'
import EditingView from './views/EditingView.vue'
import SheetView from './views/SheetView.vue'
import SmokeView from './views/SmokeView.vue'

// vs VTable 对比页异步分包：@visactor/vtable 与对比场景代码仅在进入该页时加载
const CompareView = defineAsyncComponent(() => import('./views/CompareView.vue'))

// 报表式只读快照渲染视图（meta 迁移参考形态）：sections/report.ts 与其它演示区同一挂载形态，
// 内联定义避免只为一个薄壳多建一个 view 文件
const ReportView = defineComponent({
  name: 'ReportView',
  setup() {
    const containerRef = ref<HTMLDivElement | null>(null)
    let demo: ReportDemo | null = null
    onMounted(() => {
      if (containerRef.value) {
        demo = mountReport(containerRef.value)
      }
    })
    onUnmounted(() => {
      demo = null
    })
    return () =>
      h('div', { class: 'view-container' }, [
        h('div', { class: 'view-header' }, [
          h('div', { class: 'title-row' }, [
            h('h2', null, '报表式只读快照渲染'),
            h('div', { class: 'tags' }, [
              h('span', { class: 'tag' }, '九字段快照 restore'),
              h('span', { class: 'tag' }, 'readonly 渲染'),
              h('span', { class: 'tag' }, '行列头关闭'),
              h('span', { class: 'tag' }, '浮动图随快照接线'),
            ]),
          ]),
          h(
            'p',
            { class: 'desc' },
            '报表快照（cells/styles/merges/frozen/rowHeights/colWidths/images/meta/selection）全量灌入 SheetStore，' +
              'readonly 渲染：禁编辑、禁尺寸拖改、不接填充/撤销写路径；meta 迁移时照搬「快照 → restore → 只读渲染」三段。',
          ),
        ]),
        h('div', { ref: containerRef, class: 'demo-mount-area report-mount-area' }),
      ])
  },
})

// 单元格图表视图：sections/chart.ts 与其它演示区同一挂载形态，
// 内联定义避免只为一个薄壳多建一个 view 文件（同 ReportView）
const ChartView = defineComponent({
  name: 'ChartView',
  setup() {
    const containerRef = ref<HTMLDivElement | null>(null)
    let demo: ChartDemo | null = null
    onMounted(() => {
      if (containerRef.value) {
        demo = mountChart(containerRef.value)
      }
    })
    onUnmounted(() => {
      demo = null
    })
    return () =>
      h('div', { class: 'view-container' }, [
        h('div', { class: 'view-header' }, [
          h('div', { class: 'title-row' }, [
            h('h2', null, '单元格图表'),
            h('div', { class: 'tags' }, [
              h('span', { class: 'tag' }, 'Chart.js 按需加载'),
              h('span', { class: 'tag' }, '离屏出图'),
              h('span', { class: 'tag' }, 'L2 位图缓存'),
              h('span', { class: 'tag' }, '滚动无闪'),
            ]),
          ]),
          h(
            'p',
            { class: 'desc' },
            '单元格声明图表（类型 + 数据），chart 插件经既有注册路径启用：Chart.js 离屏同步出图，' +
              '位图经 cell 级 MediaCache blit 到 media 层；滚动滚回命中缓存直接回贴，数据变更按内容换 key 失效重绘。',
          ),
        ]),
        h('div', { ref: containerRef, class: 'demo-mount-area chart-mount-area' }),
      ])
  },
})

// 水印视图：sections/watermark.ts 与其它演示区同一挂载形态，
// 内联定义避免只为一个薄壳多建一个 view 文件（同 ChartView/ReportView）
const WatermarkView = defineComponent({
  name: 'WatermarkView',
  setup() {
    const containerRef = ref<HTMLDivElement | null>(null)
    let demo: WatermarkDemo | null = null
    onMounted(() => {
      if (containerRef.value) {
        demo = mountWatermark(containerRef.value)
      }
    })
    onUnmounted(() => {
      demo = null
    })
    return () =>
      h('div', { class: 'view-container' }, [
        h('div', { class: 'view-header' }, [
          h('div', { class: 'title-row' }, [
            h('h2', null, '文字水印'),
            h('div', { class: 'tags' }, [
              h('span', { class: 'tag' }, 'ground 层 L0 预留位'),
              h('span', { class: 'tag' }, '锚定视口'),
              h('span', { class: 'tag' }, '参数即时生效'),
            ]),
          ]),
          h(
            'p',
            { class: 'desc' },
            '水印插件经构造 plugins 挂载：平铺文字绘制在四层 canvas 的 ground 层（惰性创建、恒在最底）。' +
              '滚动表格观察水印锚定视口不随内容移动；开关与滑杆即时生效（updateConfig 一帧内重绘）。',
          ),
        ]),
        h('div', { ref: containerRef, class: 'demo-mount-area watermark-mount-area' }),
      ])
  },
})

// 打印预览视图：sections/print.ts 与其它演示区同一挂载形态，
// 内联定义避免只为一个页面新建 view 文件（同 ReportView/WatermarkView）
const PrintView = defineComponent({
  name: 'PrintView',
  setup() {
    const containerRef = ref<HTMLDivElement | null>(null)
    let demo: PrintDemo | null = null
    onMounted(() => {
      if (containerRef.value) {
        demo = mountPrint(containerRef.value)
      }
    })
    onUnmounted(() => {
      demo = null
    })
    return () =>
      h('div', { class: 'view-container' }, [
        h('div', { class: 'view-header' }, [
          h('div', { class: 'title-row' }, [
            h('h2', null, '打印预览与输出'),
            h('div', { class: 'tags' }, [
              h('span', { class: 'tag' }, 'fitpage/fixrows 分页'),
              h('span', { class: 'tag' }, '每页重复表头'),
              h('span', { class: 'tag' }, '页眉页脚占位符'),
              h('span', { class: 'tag' }, 'window.print 桩计数'),
            ]),
          ]),
          h(
            'p',
            { class: 'desc' },
            'headless 打印内核 + DOM 薄壳预览：超过一页的示例表（两行表头带合并单元格）经 PrintSource 供数，' +
              '配置纸张/方向/缩放/分页模式后打开预览弹层（缩略列表 + 当前页放大 + 打印按钮）；' +
              'window.print 已替换为计数桩，点打印按钮可在状态行与 window.__DEMO__.print 读取调用计数。',
          ),
        ]),
        h('div', { ref: containerRef, class: 'demo-mount-area print-mount-area' }),
      ])
  },
})

interface MenuItem {
  key: string
  label: string
  icon: string
  badge?: string
  desc?: string
  component?: unknown
  /** 外链菜单项（bench 独立页） */
  href?: string
}

interface MenuGroup {
  title: string
  items: MenuItem[]
}

const menuGroups: MenuGroup[] = [
  {
    title: '开始',
    items: [
      {
        key: 'home',
        label: '总览',
        icon: '♾️',
        desc: '项目名片 · 关键指标 · 示例导航',
        component: HomeView,
      },
    ],
  },
  {
    title: '功能示例',
    items: [
      {
        key: 'display',
        label: '显示能力',
        icon: '🎨',
        badge: '10万行',
        desc: '虚拟滚动 · 冻结 · 合并 · 逐边边框 · 自定义渲染',
        component: DisplayView,
      },
      {
        key: 'data-forms',
        label: '数据供给三形态',
        icon: '📊',
        desc: 'records / 模型直挂 / rowCount + 钩子',
        component: DataFormsView,
      },
      {
        key: 'interaction',
        label: '交互能力',
        icon: '⚡',
        desc: '拖选 · resize · 键盘 · 右键菜单 · 批量更新',
        component: InteractionView,
      },
      {
        key: 'media',
        label: '图片与浮动对象',
        icon: '🖼️',
        desc: 'L2 位图缓存 · 窗口化加载 · 浮动对象',
        component: MediaView,
      },
      {
        key: 'chart',
        label: '单元格图表',
        icon: '📈',
        badge: 'Chart.js',
        desc: '格内声明图表 · 离屏出图 · 无闪回滚',
        component: ChartView,
      },
      {
        key: 'watermark',
        label: '文字水印',
        icon: '💧',
        desc: 'ground 层平铺 · 锚定视口 · 参数即时生效',
        component: WatermarkView,
      },
      {
        key: 'print',
        label: '打印预览与输出',
        icon: '🖨️',
        desc: 'fitpage/fixrows 分页 · 重复表头 · 页脚占位符',
        component: PrintView,
      },
      {
        key: 'editing',
        label: '单元格编辑',
        icon: '✏️',
        desc: 'SheetModel · 双击编辑 · 滚出提交',
        component: EditingView,
      },
      {
        key: 'sheet',
        label: 'sheet 电子表格',
        icon: '🧮',
        badge: '完整形态',
        desc: '工具栏 · 公式栏 · tabs · 查找替换 · CSV',
        component: SheetView,
      },
      {
        key: 'report',
        label: '报表只读快照',
        icon: '📄',
        desc: '九字段快照灌入 + readonly 渲染',
        component: ReportView,
      },
    ],
  },
  {
    title: '性能',
    items: [
      {
        key: 'compare',
        label: 'vs VTable 对比',
        icon: '🏁',
        badge: '按钮即跑',
        desc: '同数据同口径 · 页内实时对比两库',
        component: CompareView,
      },
      {
        key: 'bench',
        label: '量化基准',
        icon: '⏱️',
        desc: 'TTFF / 滚动 FPS / 失效面积（独立页）',
        href: 'bench.html',
      },
    ],
  },
  {
    title: '工程',
    items: [
      {
        key: 'smoke',
        label: '冒烟自检',
        icon: '🧪',
        badge: '20+ 项',
        desc: '端到端像素级自检断言套件',
        component: SmokeView,
      },
    ],
  },
]

const menuItems = menuGroups.flatMap((group) => group.items)

// 路由与 Hash 监听
function getInitialTab(): string {
  const hash = location.hash.replace(/^#\/?/, '')
  if (menuItems.some((item) => item.key === hash)) {
    return hash
  }
  return 'home'
}

const activeKey = ref(getInitialTab())
const activeItem = computed(
  () => menuItems.find((item) => item.key === activeKey.value) ?? menuItems[0]!,
)

function selectMenu(key: string) {
  activeKey.value = key
  location.hash = `#/${key}`
}

window.addEventListener('hashchange', () => {
  const hash = location.hash.replace(/^#\/?/, '')
  if (menuItems.some((item) => item.key === hash)) {
    activeKey.value = hash
  }
})

// 冒烟测试专用模式（?smoke=1）
const smokeMode = isSmokeMode()
const smokeMountRef = ref<HTMLDivElement | null>(null)

onMounted(() => {
  if (smokeMode) {
    const mountPoint = smokeMountRef.value
    if (!mountPoint) return

    const demos: DemoHandles = {
      dataForms: mountDataForms(mountPoint),
      display: mountDisplay(mountPoint),
      interaction: mountInteraction(mountPoint),
      media: mountMedia(mountPoint),
      chart: mountChart(mountPoint),
      watermark: mountWatermark(mountPoint),
      print: mountPrint(mountPoint),
      editing: mountEditing(mountPoint),
    }
    window.__DEMO__ = demos
    // sheet 区：插件之上的完整 sheet 面（句柄供 checkSheet 断言）
    const sheetDemo = mountSheet(mountPoint)
    window.__SHEET_DEMO__ = createSheetHandle(sheetDemo)
    // 报表区：快照灌入 + readonly 渲染（句柄供 checkReport 断言）
    const reportDemo = mountReport(mountPoint)
    window.__REPORT_DEMO__ = createReportHandle(reportDemo)
    // 自检异常也写结果信号（裸 void 会让超时方无从分辨挂错与卡死）
    void runSmoke(demos).catch((error) => {
      window.__SMOKE__ = {
        done: true,
        pass: false,
        total: 1,
        failures: [`runSmoke 异常：${error instanceof Error ? error.stack : String(error)}`],
      }
      document.title = 'SMOKE FAIL'
    })
  }
})
</script>

<template>
  <div class="app-layout">
    <!-- 冒烟测试模式下的挂载区 -->
    <div v-if="smokeMode" class="smoke-mode-container">
      <div class="smoke-mode-banner">
        <h2>🧪 冒烟自动化测试进行中 (?smoke=1)</h2>
        <p>正在后台执行全量像素与交互自检断言，结果将写入 window.__SMOKE__ …</p>
      </div>
      <div ref="smokeMountRef" class="smoke-mount-target"></div>
    </div>

    <!-- 正常演示模式 -->
    <template v-else>
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">∞</div>
          <div class="brand-text">
            <span class="brand-name">infinitable</span>
            <span class="brand-sub">playground</span>
          </div>
        </div>

        <nav class="nav-menu">
          <div v-for="group in menuGroups" :key="group.title" class="menu-group">
            <div class="menu-group-title">{{ group.title }}</div>
            <template v-for="item in group.items" :key="item.key">
              <a
                v-if="item.href"
                class="menu-item link"
                :href="item.href"
                target="_blank"
                rel="noopener"
              >
                <span class="menu-icon">{{ item.icon }}</span>
                <div class="menu-content">
                  <div class="menu-title-row">
                    <span class="menu-label">{{ item.label }}</span>
                    <span class="menu-arrow">↗</span>
                  </div>
                  <div class="menu-desc">{{ item.desc }}</div>
                </div>
              </a>
              <button
                v-else
                type="button"
                class="menu-item"
                :class="{ active: activeKey === item.key }"
                @click="selectMenu(item.key)"
              >
                <span class="menu-icon">{{ item.icon }}</span>
                <div class="menu-content">
                  <div class="menu-title-row">
                    <span class="menu-label">{{ item.label }}</span>
                    <span v-if="item.badge" class="menu-badge">{{ item.badge }}</span>
                  </div>
                  <div class="menu-desc">{{ item.desc }}</div>
                </div>
              </button>
            </template>
          </div>
        </nav>

        <div class="sidebar-footer">
          <div class="sidebar-kpi">
            <span class="sidebar-kpi-num">27.3KB</span>
            <span class="sidebar-kpi-label">gzip · 零依赖</span>
          </div>
        </div>
      </aside>

      <div class="app-main">
        <header class="topbar">
          <div class="topbar-title">
            <span class="topbar-crumb">playground</span>
            <span class="topbar-sep">/</span>
            <span class="topbar-page">{{ activeItem.label }}</span>
          </div>
          <div class="topbar-pills">
            <span class="pill">零 vrender 依赖</span>
            <span class="pill">Canvas 分层渲染</span>
            <span class="pill highlight">100K 虚拟滚动</span>
          </div>
        </header>

        <main class="main-content">
          <div class="content-wrapper">
            <component :is="activeItem.component" />
          </div>
        </main>
      </div>
    </template>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--bg);
  color: var(--text-1);
  font-family: var(--font);
}

/* ── 左侧深色 Sidebar ─────────────────────── */

.sidebar {
  width: 264px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #15161d 0%, #101116 100%);
  border-right: 1px solid #23242e;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 18px 14px;
}

.brand-mark {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 21px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #312e81);
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4);
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.brand-name {
  font-size: 15px;
  font-weight: 700;
  color: #f4f5fa;
  letter-spacing: -0.2px;
}

.brand-sub {
  font-size: 11px;
  color: #6f7280;
  letter-spacing: 0.6px;
}

.nav-menu {
  flex: 1;
  overflow-y: auto;
  padding: 4px 12px 12px;
}

.nav-menu::-webkit-scrollbar {
  width: 4px;
}

.nav-menu::-webkit-scrollbar-thumb {
  background: #2b2d38;
  border-radius: 2px;
}

.menu-group {
  margin-bottom: 6px;
}

.menu-group-title {
  font-size: 11px;
  font-weight: 600;
  color: #5b5e6b;
  padding: 12px 10px 6px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.menu-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  margin-bottom: 2px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.14s ease;
}

.menu-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.menu-item.active {
  background: linear-gradient(90deg, rgba(99, 102, 241, 0.22), rgba(99, 102, 241, 0.08));
  border-color: rgba(99, 102, 241, 0.35);
  box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.12);
}

.menu-icon {
  flex: none;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
}

.menu-item.active .menu-icon {
  background: rgba(99, 102, 241, 0.25);
}

.menu-content {
  flex: 1;
  min-width: 0;
}

.menu-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.menu-label {
  font-size: 13px;
  font-weight: 600;
  color: #c8cad4;
}

.menu-item.active .menu-label {
  color: #fff;
}

.menu-badge {
  flex: none;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.28);
  color: #c7d2fe;
}

.menu-arrow {
  font-size: 11px;
  color: #5b5e6b;
}

.menu-desc {
  font-size: 11px;
  color: #6f7280;
  line-height: 1.45;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menu-item.active .menu-desc {
  color: #9ba0b4;
}

.sidebar-footer {
  padding: 14px 18px;
  border-top: 1px solid #1e1f28;
}

.sidebar-kpi {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.sidebar-kpi-num {
  font-size: 16px;
  font-weight: 800;
  color: #a5b4fc;
  font-variant-numeric: tabular-nums;
}

.sidebar-kpi-label {
  font-size: 11px;
  color: #5b5e6b;
}

/* ── 右侧主区 ─────────────────────────────── */

.app-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.topbar {
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
}

.topbar-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.topbar-crumb {
  color: var(--text-3);
}

.topbar-sep {
  color: var(--text-3);
}

.topbar-page {
  font-weight: 600;
  color: var(--text-1);
}

.topbar-pills {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pill {
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-2);
}

.pill.highlight {
  background: var(--brand-soft);
  border-color: rgba(79, 70, 229, 0.22);
  color: var(--brand);
  font-weight: 600;
}

.main-content {
  flex: 1;
  overflow-y: auto;
  padding: 26px 28px 48px;
}

.content-wrapper {
  max-width: 1160px;
  margin: 0 auto;
}

/* ── 冒烟模式 ─────────────────────────────── */

.smoke-mode-container {
  padding: 24px;
  overflow-y: auto;
  height: 100vh;
}

.smoke-mode-banner {
  background: var(--brand-soft);
  border: 1px solid rgba(79, 70, 229, 0.3);
  border-radius: var(--radius-md);
  padding: 16px 20px;
  margin-bottom: 24px;
}

.smoke-mode-banner h2 {
  margin: 0 0 8px;
  font-size: 18px;
  color: var(--text-1);
}

.smoke-mode-banner p {
  margin: 0;
  font-size: 13px;
  color: var(--text-2);
}
</style>
