import { SheetGrid, type CellAddress, type CellStyle } from '@infinitable/sheet'

import { FORM_CANVAS_THEME } from './canvas-theme'
import { createCanvasOverlay, type CanvasOverlay } from './canvas-overlay'
import type { FormDoc } from './form-doc'
import type { PaperGuidesConfig } from './paper-guides'
import {
  FORM_BINDING_META_NAMESPACE,
  formatBindingPlaceholder,
  regionsAt,
  type FormCellBinding,
  type FormRegion,
} from './template'

/**
 * 设计画布挂载层：SheetGrid 为所见即所得画布（WPS 式无限单元格，随滚动扩容）。
 *
 * 尺寸口径：不传 rows/cols，画布随滚动增长；序列化时由 FormDoc 收紧到内容包围盒。
 * 因此引擎的 sheet.rows 会随滚动膨胀，**不能**拿它当「是否需要重建网格」的依据——
 * 重建只看几何键集缩小与合并区变化（见 syncView）。
 *
 * - 配置态口径：绑定格只显示占位符（resolveDisplayValue 读 sidecar，数据行
 *   永不进画布；数据态渲染在预览/打印管线，P5/P6 接线）；
 * - 底色标记（resolveCellStyle 叠加淡色填充，不写模型、不进快照）：展开区淡蓝优先，
 *   其余已绑定格给一层极淡品牌蓝，让「哪些格绑了数据」一眼可见；
 * - 选区即绑定目标：画布常规选区正常流动，宿主从 sheet 选区读活动格，无需任何开关；
 *   选区变化回带所在区域（区域/格选中语义）；
 * - 纸张边界/分页参考线（P4）：overlay painter 经协议 setOverlayPainter 挂 sky 层，
 *   网格重建时随 createGrid 重挂；仅显示层——配置由宿主持有，不写模型、不进快照。
 */

/** 展开区底色（无显式填充的格叠加；仅画布显示层） */
const EXPAND_REGION_TINT = '#eef4ff'

/** 非展开区已绑定格的极淡品牌蓝底色（仅显示层，用户显式填充优先） */
const BOUND_CELL_TINT = '#f5f8ff'

/** 视图几何态：行高/列宽自定义键集 + 合并区签名（静默 restore 后的失配检测基准） */
interface ViewGeometry {
  rowKeys: ReadonlySet<number>
  colKeys: ReadonlySet<number>
  merges: string
}

/** 读取当前模型几何态（快照级静默 restore 不发事件，靠比对发现失配） */
function captureGeometry(doc: FormDoc): ViewGeometry {
  return {
    rowKeys: new Set(doc.sheet.getRowHeights().keys()),
    colKeys: new Set(doc.sheet.getColWidths().keys()),
    merges: JSON.stringify(doc.sheet.merges.getMerges()),
  }
}

/** 键集缩小检测：已应用到引擎的键在模型中消失（清除语义，引擎覆盖无清除 API） */
function keySetShrunk(prev: ReadonlySet<number>, next: ReadonlySet<number>): boolean {
  for (const key of prev) {
    if (!next.has(key)) return true
  }
  return false
}

interface FormCanvasOptions {
  container: HTMLElement
  doc: FormDoc
  /** 选区变化（含所在区域；区域面板与绑定面板据此高亮/跟随） */
  onSelectionChange?(info: { addr: CellAddress; region: FormRegion | undefined }): void
  /** 纸张边界/分页参考线初始配置（overlay 显示层；缺省关闭，运行时经 setPaperGuides 切换） */
  paperGuides?: PaperGuidesConfig
  width?: number
  height?: number
}

export interface FormCanvas {
  /**
   * 整表重绘（几何同步 + repaint）：cell-meta 单格写入不发引擎事件，
   * 绑定编辑写入/清除占位符后由宿主调用
   */
  refresh(): void
  /** 纸张边界/分页参考线开关/配置（null 关闭；仅 overlay 显示层，不落模板） */
  setPaperGuides(config: PaperGuidesConfig | null): void
  /** 当前画布实例（画布级回归测试断言引擎几何/合并用；业务代码不要依赖） */
  getGrid(): SheetGrid | undefined
  release(): void
}

export function mountFormCanvas(options: FormCanvasOptions): FormCanvas {
  const { container, doc } = options
  let released = false
  let grid: SheetGrid | undefined
  let wrapper: HTMLDivElement | undefined
  /** 上次同步到引擎的几何态（键集缩小或合并区变化须重建网格） */
  let mountedGeometry = captureGeometry(doc)
  const disposers: (() => void)[] = []
  /** 纸张参考线配置（显示层状态，由宿主经 setPaperGuides 写入） */
  let guidesConfig: PaperGuidesConfig | null = options.paperGuides ?? null
  /** 指针命中的区域下标（悬停态：overlay 只在有值时画区域名 pill） */
  let hoveredRegionIndex: number | undefined
  /** sky 层组合 overlay（区域轨道 + 参考线；每次网格创建/重建随 createGrid 重挂新引擎） */
  const overlay: CanvasOverlay = createCanvasOverlay({
    getGrid: () => grid,
    getPaperGuides: () => guidesConfig,
    getRegions: () => doc.regions,
    // 当前选中格（overlay 据此判定「现在说的是哪个区域」并加粗描边）
    getActiveCell: () => doc.sheet.getSelection().activeCell ?? undefined,
    // 无限画布下引擎行列含大量扩容空行：参考线只在内容包围盒内估算换页
    getContentBounds: () => doc.bounds,
    // 悬停区域（默认不显示区域名，指针落在区域内才出 pill）
    getHoveredRegionIndex: () => hoveredRegionIndex,
  })

  /**
   * 指针跟踪：只在「命中区域下标变化」时失效 sky 层——区域内逐格移动不重绘，
   * 移出区域即清除悬停。监听随 host 节点一起销毁（remount 会整体移除 host），
   * 因此不需要额外的 disposer。
   */
  const bindHover = (host: HTMLDivElement, instance: SheetGrid): void => {
    host.addEventListener('pointermove', (event) => {
      const rect = host.getBoundingClientRect()
      const addr = instance.hitTestSheetAddr(event.clientX - rect.left, event.clientY - rect.top)
      const region = addr ? regionsAt(doc.regions, addr.row, addr.col) : undefined
      const next = region ? doc.regions.indexOf(region) : undefined
      if (next === hoveredRegionIndex) return
      hoveredRegionIndex = next
      overlay.refresh()
    })
    host.addEventListener('pointerleave', () => {
      if (hoveredRegionIndex === undefined) return
      hoveredRegionIndex = undefined
      overlay.refresh()
    })
  }

  const createGrid = (): SheetGrid => {
    const host = document.createElement('div')
    host.className = 'canvas-host'
    container.appendChild(host)
    const instance = new SheetGrid({
      container: host,
      sheet: doc.sheet,
      // 不传 rows/cols：WPS 式无限单元格，初始按视口给足，滚动触界再扩容
      width: options.width,
      height: options.height,
      // 设计器观感：表头/网格线/选区配色（仅颜色，不改行列尺寸与字号）
      theme: FORM_CANVAS_THEME,
      // 无限画布：序列化时 FormDoc.toTemplate 会收紧到内容包围盒
      growOnScroll: true,
      // 配置态占位符：绑定格显示 {{path}}，其余回落存储值；数据行不进画布
      resolveDisplayValue: (addr, base) => {
        const binding = doc.sheet.getCellMeta<FormCellBinding>(addr, FORM_BINDING_META_NAMESPACE)
        return binding ? formatBindingPlaceholder(binding) : base
      },
      // 底色标记：仅叠加在无显式填充的格上（用户填充优先）
      // 优先级保持现状：展开区淡蓝 > 已绑定格淡蓝
      resolveCellStyle: (addr, base): CellStyle | undefined => {
        if (base?.fill) return undefined
        const region = regionsAt(doc.regions, addr.row, addr.col)
        if (region && region.expand !== 'none') {
          return { ...base, fill: { color: EXPAND_REGION_TINT } }
        }
        const binding = doc.sheet.getCellMeta<FormCellBinding>(addr, FORM_BINDING_META_NAMESPACE)
        return binding ? { ...base, fill: { color: BOUND_CELL_TINT } } : undefined
      },
    })
    mountedGeometry = captureGeometry(doc)
    wrapper = host
    hoveredRegionIndex = undefined
    bindHover(host, instance)
    overlay.attach(instance)
    return instance
  }

  grid = createGrid()

  /**
   * 模型变更后的视图同步：只按行高/列宽键集缩小、合并区变化重建网格（快照级静默
   * restore 清空模型键、区域平移改写合并——引擎侧行高覆盖无清除 API、合并 Map 仅
   * 事件驱动同步，非重建路径无法表达）；其余同步尺寸并整表重绘。
   *
   * 不比对行列数：无限画布下 sheet.rows 随滚动增长，把它当重建依据会一滚就重建。
   */
  function syncView(): void {
    if (released) return
    const geometry = captureGeometry(doc)
    if (
      keySetShrunk(mountedGeometry.rowKeys, geometry.rowKeys) ||
      keySetShrunk(mountedGeometry.colKeys, geometry.colKeys) ||
      geometry.merges !== mountedGeometry.merges
    ) {
      remount()
      return
    }
    mountedGeometry = geometry
    grid?.applyAxisSizes('row', [...geometry.rowKeys])
    grid?.applyAxisSizes('col', [...geometry.colKeys])
    grid?.updateTheme({})
    // 行高/列宽就地同步后区域轨道/参考线随 sky 整层失效重绘（重建路径经 createGrid 重挂已覆盖）
    overlay.refresh()
  }

  // 区域结构或撤销链变化（快照级编辑的静默 restore 不发 sheet 事件，统一走这里）
  disposers.push(doc.on('regions-change', syncView))
  disposers.push(doc.on('history-change', syncView))
  // 选区流动：回带活动格所在区域（区域/格选中语义）
  disposers.push(
    doc.sheet.on('selection-change', (state) => {
      if (released || !state.activeCell) return
      options.onSelectionChange?.({
        addr: state.activeCell,
        region: regionsAt(doc.regions, state.activeCell.row, state.activeCell.col),
      })
    }),
  )

  function remount(): void {
    grid?.release()
    wrapper?.remove()
    grid = createGrid()
  }

  return {
    refresh(): void {
      syncView()
    },
    setPaperGuides(config: PaperGuidesConfig | null): void {
      guidesConfig = config
      overlay.refresh()
    },
    getGrid(): SheetGrid | undefined {
      return grid
    },
    release(): void {
      if (released) return
      released = true
      overlay.detach()
      for (const dispose of disposers) dispose()
      disposers.length = 0
      grid?.release()
      wrapper?.remove()
      grid = undefined
      wrapper = undefined
    },
  }
}
