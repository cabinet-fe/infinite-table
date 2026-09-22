<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, defineComponent, h } from 'vue'
import { isSmokeMode } from './mount'
import { mountDataForms } from './sections/data-forms'
import { mountDisplay } from './sections/display'
import { mountInteraction } from './sections/interaction'
import { mountMedia } from './sections/media'
import { mountEditing } from './sections/editing'
import { createSheetHandle, mountSheet } from './sections/sheet'
import { createReportHandle, mountReport, type ReportDemo } from './sections/report'
import { runSmoke } from './smoke'
import type { DemoHandles } from './main'

import DataFormsView from './views/DataFormsView.vue'
import DisplayView from './views/DisplayView.vue'
import InteractionView from './views/InteractionView.vue'
import MediaView from './views/MediaView.vue'
import EditingView from './views/EditingView.vue'
import SheetView from './views/SheetView.vue'
import SmokeView from './views/SmokeView.vue'

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

interface MenuItem {
  key: string
  label: string
  icon: string
  badge?: string
  desc: string
  component: any
}

const menuItems: MenuItem[] = [
  {
    key: 'display',
    label: '显示能力',
    icon: '🎨',
    badge: '10万行',
    desc: '虚拟滚动、冻结行列、合并、逐边边框、自定义渲染',
    component: DisplayView,
  },
  {
    key: 'data-forms',
    label: '数据供给三形态',
    icon: '📊',
    desc: 'records 数组、按格 hook 计算、模型事件驱动与防回环',
    component: DataFormsView,
  },
  {
    key: 'interaction',
    label: '交互能力',
    icon: '⚡',
    desc: '区域拖选、行列选择、Resize、快捷键、右键菜单、批量更新',
    component: InteractionView,
  },
  {
    key: 'media',
    label: '图片与浮动对象',
    icon: '🖼️',
    desc: 'L2 离屏位图 LRU 缓存、窗口化加载、浮动对象跟随',
    component: MediaView,
  },
  {
    key: 'editing',
    label: '单元格编辑',
    icon: '✏️',
    desc: 'SheetModel 内存模型、双击编辑、快捷键流、滚出提交',
    component: EditingView,
  },
  {
    key: 'sheet',
    label: 'sheet 电子表格',
    icon: '🧮',
    badge: '对标 ultra-ui',
    desc: '工具栏/公式栏/底部 tabs/右键菜单/查找替换/CSV/数据观察区',
    component: SheetView,
  },
  {
    key: 'report',
    label: '报表只读快照',
    icon: '📄',
    badge: 'meta 迁移参考',
    desc: '九字段快照全量灌入模型 + readonly 渲染（禁编辑/禁尺寸/无写路径）',
    component: ReportView,
  },
  {
    key: 'smoke',
    label: '冒烟自动化自检',
    icon: '🧪',
    badge: '20+ 项',
    desc: '全量端到端像素级自检断言套件',
    component: SmokeView,
  },
]

// 路由与 Hash 监听
function getInitialTab(): string {
  const hash = location.hash.replace(/^#\/?/, '')
  if (menuItems.some((item) => item.key === hash)) {
    return hash
  }
  return 'display'
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
      <!-- 顶部 Header -->
      <header class="app-header">
        <div class="brand">
          <div class="logo-badge">IT</div>
          <div class="brand-text">
            <h1>infinite-table</h1>
            <span class="version-tag">自研渲染引擎 MVP</span>
          </div>
        </div>
        <div class="header-status">
          <span class="status-pill">零 vrender 依赖</span>
          <span class="status-pill">Canvas 2D 分层</span>
          <span class="status-pill highlight">100K 虚拟滚动</span>
        </div>
      </header>

      <!-- 下半部：左侧菜单 + 右侧内容 -->
      <div class="app-body">
        <!-- 左侧菜单栏 -->
        <aside class="sidebar">
          <div class="menu-section-title">功能示例清单</div>
          <nav class="nav-menu">
            <button
              v-for="item in menuItems"
              :key="item.key"
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
          </nav>

          <div class="sidebar-footer">
            <div class="hint-box">
              <span class="hint-title">💡 交互提示</span>
              <p>支持滚轮滚动、触摸手势、框选与键盘方向键导航。</p>
            </div>
          </div>
        </aside>

        <!-- 右侧主内容区 -->
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
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: #f5f6f8;
  color: #1f2329;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB',
    'Microsoft YaHei', sans-serif;
}

/* Header 样式 */
.app-header {
  height: 56px;
  background: #ffffff;
  border-bottom: 1px solid #dee0e3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  flex-shrink: 0;
  z-index: 10;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-badge {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: linear-gradient(135deg, #3370ff, #1d4ed8);
  color: #ffffff;
  font-weight: 700;
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 4px rgba(51, 112, 255, 0.2);
}

.brand-text {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-text h1 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: #1f2329;
}

.version-tag {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #f2f3f5;
  color: #646a73;
  font-weight: 500;
}

.header-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-pill {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 12px;
  background: #f2f3f5;
  color: #646a73;
}

.status-pill.highlight {
  background: #e8f3ff;
  color: #3370ff;
  font-weight: 500;
}

/* 主体布局 */
.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 左侧 Sidebar */
.sidebar {
  width: 280px;
  background: #ffffff;
  border-right: 1px solid #dee0e3;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.menu-section-title {
  font-size: 12px;
  font-weight: 600;
  color: #8f959e;
  padding: 16px 20px 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.nav-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 12px;
  flex: 1;
  overflow-y: auto;
}

.menu-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
  width: 100%;
  box-sizing: border-box;
}

.menu-item:hover {
  background: #f5f6f7;
}

.menu-item.active {
  background: #e8f3ff;
  border-color: #bedaff;
}

.menu-icon {
  font-size: 18px;
  line-height: 1.2;
}

.menu-content {
  flex: 1;
  min-width: 0;
}

.menu-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 3px;
}

.menu-label {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
}

.menu-item.active .menu-label {
  color: #3370ff;
}

.menu-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 10px;
  background: #ebedf0;
  color: #646a73;
}

.menu-item.active .menu-badge {
  background: #3370ff;
  color: #ffffff;
}

.menu-desc {
  font-size: 11px;
  color: #8f959e;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-footer {
  padding: 16px;
  border-top: 1px solid #f2f3f5;
}

.hint-box {
  background: #f9f9fa;
  border: 1px solid #eef0f2;
  border-radius: 6px;
  padding: 10px 12px;
}

.hint-title {
  font-size: 12px;
  font-weight: 600;
  color: #3370ff;
  display: block;
  margin-bottom: 4px;
}

.hint-box p {
  font-size: 11px;
  color: #646a73;
  margin: 0;
  line-height: 1.4;
}

/* 右侧 Main Content */
.main-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.content-wrapper {
  max-width: 1100px;
  margin: 0 auto;
}

/* 冒烟模式样式 */
.smoke-mode-container {
  padding: 24px;
  overflow-y: auto;
  height: 100vh;
}

/* 报表视图（App.vue 内联定义）：视图卡片样式经 :deep 穿透（其它视图各自 scoped 私有） */
.main-content :deep(.report-mount-area section) {
  background: #ffffff;
  border: 1px solid #e5e8eb;
  border-radius: 8px;
  padding: 16px 20px;
}

.main-content :deep(.report-mount-area section h2),
.main-content :deep(.report-mount-area section .desc) {
  display: none;
}

.smoke-mode-banner {
  background: #e8f3ff;
  border: 1px solid #3370ff;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 24px;
}

.smoke-mode-banner h2 {
  margin: 0 0 8px;
  font-size: 18px;
  color: #1f2329;
}

.smoke-mode-banner p {
  margin: 0;
  font-size: 13px;
  color: #646a73;
}
</style>
