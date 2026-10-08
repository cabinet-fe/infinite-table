// 侧栏导航配置：14 个入口的 key 与既有 Vue 壳完全一致（hash 路由契约），bench 为独立页外链。
// 图标一律 lucide-react 矢量图标（替换旧 emoji 菜单）。

import type { LucideIcon } from 'lucide-react'
import {
  ChartColumn,
  Database,
  Droplets,
  FileText,
  FlaskConical,
  Home,
  Image as ImageIcon,
  Infinity as InfinityIcon,
  MousePointerClick,
  Palette,
  Pencil,
  Printer,
  Swords,
  Table2,
  Timer,
} from 'lucide-react'

export const BRAND_ICON = InfinityIcon

/** hash 路由 key（bench 为外链，不走路由但占导航位） */
export type RouteKey =
  | 'home'
  | 'display'
  | 'data-forms'
  | 'interaction'
  | 'media'
  | 'chart'
  | 'watermark'
  | 'print'
  | 'editing'
  | 'sheet'
  | 'report'
  | 'compare'
  | 'bench'
  | 'smoke'

export interface NavRouteItem {
  key: PageKey
  label: string
  icon: LucideIcon
  badge?: string
  desc?: string
}

/** 外链菜单项（bench 独立页） */
export interface NavLinkItem {
  key: RouteKey
  label: string
  icon: LucideIcon
  badge?: string
  desc?: string
  href: string
}

export type NavItem = NavRouteItem | NavLinkItem

export interface NavGroup {
  title: string
  items: NavItem[]
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    title: '开始',
    items: [
      {
        key: 'home',
        label: '总览',
        icon: Home,
        desc: '项目名片 · 关键指标 · 示例导航',
      },
    ],
  },
  {
    title: '功能示例',
    items: [
      {
        key: 'display',
        label: '显示能力',
        icon: Palette,
        badge: '10万行',
        desc: '虚拟滚动 · 冻结 · 合并 · 逐边边框 · 自定义渲染',
      },
      {
        key: 'data-forms',
        label: '数据供给三形态',
        icon: Database,
        desc: 'records / 模型直挂 / rowCount + 钩子',
      },
      {
        key: 'interaction',
        label: '交互能力',
        icon: MousePointerClick,
        desc: '拖选 · resize · 键盘 · 右键菜单 · 批量更新',
      },
      {
        key: 'media',
        label: '图片与浮动对象',
        icon: ImageIcon,
        desc: 'L2 位图缓存 · 窗口化加载 · 浮动对象',
      },
      {
        key: 'chart',
        label: '单元格图表',
        icon: ChartColumn,
        badge: 'Chart.js',
        desc: '格内声明图表 · 离屏出图 · 无闪回滚',
      },
      {
        key: 'watermark',
        label: '文字水印',
        icon: Droplets,
        desc: 'ground 层平铺 · 锚定视口 · 参数即时生效',
      },
      {
        key: 'print',
        label: '打印预览与输出',
        icon: Printer,
        desc: 'fitpage/fixrows 分页 · 重复表头 · 页脚占位符',
      },
      {
        key: 'editing',
        label: '单元格编辑',
        icon: Pencil,
        desc: 'SheetModel · 双击编辑 · 滚出提交',
      },
      {
        key: 'sheet',
        label: 'sheet 电子表格',
        icon: Table2,
        badge: '完整形态',
        desc: '工具栏 · 公式栏 · tabs · 查找替换 · CSV',
      },
      {
        key: 'report',
        label: '报表只读快照',
        icon: FileText,
        desc: '九字段快照灌入 + readonly 渲染',
      },
    ],
  },
  {
    title: '性能',
    items: [
      {
        key: 'compare',
        label: 'vs VTable 对比',
        icon: Swords,
        badge: '按钮即跑',
        desc: '同数据同口径 · 页内实时对比两库',
      },
      {
        key: 'bench',
        label: '量化基准',
        icon: Timer,
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
        icon: FlaskConical,
        badge: '20+ 项',
        desc: '端到端像素级自检断言套件',
      },
    ],
  },
]

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items)

export const ROUTE_KEYS: readonly RouteKey[] = NAV_ITEMS.map((item) => item.key)

/** 可路由页面 key（bench 为独立页外链，不占路由位；hash 落到 #/bench 视为非法，回落 home） */
export type PageKey = Exclude<RouteKey, 'bench'>

export const PAGE_KEYS: readonly PageKey[] = ROUTE_KEYS.filter((key) => key !== 'bench')

export function findNavItem(key: RouteKey): NavItem {
  const item = NAV_ITEMS.find((entry) => entry.key === key)
  if (!item) {
    throw new Error(`未知路由 key：${key}`)
  }
  return item
}
