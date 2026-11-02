import { SheetGrid, type CellAddress, type CellStyle } from '@infinitable/sheet'

import type { FormDoc } from './form-doc'
import {
  createPaperGuidesOverlay,
  type PaperGuidesConfig,
  type PaperGuidesOverlay,
} from './paper-guides'
import {
  FORM_BINDING_META_NAMESPACE,
  bandAtRow,
  formatBindingPlaceholder,
  type FormBand,
  type FormCellBinding,
} from './template'

/**
 * 设计画布挂载层：SheetGrid 为所见即所得画布（固定行列、关闭滚动扩容）。
 *
 * - 配置态口径：绑定格只显示占位符（resolveDisplayValue 读 sidecar，数据行
 *   永不进画布；数据态渲染在预览/打印管线，P5/P6 接线）；
 * - 明细波段底色标记（resolveCellStyle 叠加淡色填充，不写模型、不进快照）；
 * - 选区拦截：拾取模式下经 interceptSelection 接管画布选区（选区不落模型），
 *   点选以 onCellPick 回交——绑定编辑（P6）的唤起入口；常规模式选区正常流动，
 *   选区变化回带所在波段（波段/格选中语义）；
 * - 纸张边界/分页参考线（P4）：overlay painter 经协议 setOverlayPainter 挂 sky 层，
 *   网格重建时随 createGrid 重挂；仅显示层——配置由宿主持有，不写模型、不进快照。
 */

/** 明细波段底色（无显式填充的格叠加；仅画布显示层） */
const DETAIL_BAND_TINT = '#eef4ff'

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

export interface FormCanvasOptions {
  container: HTMLElement
  doc: FormDoc
  /** 常规模式选区变化（含所在波段；波段面板据此高亮） */
  onSelectionChange?(info: { addr: CellAddress; band: FormBand | undefined }): void
  /** 拾取模式点选格（选区被拦截不落模型；P6 绑定编辑入口） */
  onCellPick?(addr: CellAddress): void
  /** 纸张边界/分页参考线初始配置（overlay 显示层；缺省关闭，运行时经 setPaperGuides 切换） */
  paperGuides?: PaperGuidesConfig
  width?: number
  height?: number
}

export interface FormCanvas {
  /** 拾取模式开关（true = 画布点选走拦截回调，不改变选区） */
  setPickMode(on: boolean): void
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
  let pickMode = false
  let released = false
  let grid: SheetGrid | undefined
  let wrapper: HTMLDivElement | undefined
  /** 当前挂载的引擎行数（与 doc.rows 比对决定重建） */
  let mountedRows = 0
  /** 上次同步到引擎的几何态（键集缩小或合并区变化须重建网格） */
  let mountedGeometry = captureGeometry(doc)
  const disposers: (() => void)[] = []
  /** 纸张边界/分页参考线 overlay（每次网格创建/重建随 createGrid 重挂新引擎） */
  const guides: PaperGuidesOverlay = createPaperGuidesOverlay(options.paperGuides ?? null)

  const createGrid = (): SheetGrid => {
    const host = document.createElement('div')
    host.className = 'canvas-host'
    container.appendChild(host)
    const instance = new SheetGrid({
      container: host,
      sheet: doc.sheet,
      rows: doc.rows,
      cols: doc.cols,
      width: options.width,
      height: options.height,
      // 设计画布固定行列：模板行数即画布行数，滚动不扩容
      growOnScroll: false,
      // 配置态占位符：绑定格显示 {{path}}，其余回落存储值；数据行不进画布
      resolveDisplayValue: (addr, base) => {
        const binding = doc.sheet.getCellMeta<FormCellBinding>(addr, FORM_BINDING_META_NAMESPACE)
        return binding ? formatBindingPlaceholder(binding) : base
      },
      // 明细波段淡色标记：仅叠加在无显式填充的格上（用户填充优先）
      resolveCellStyle: (addr, base): CellStyle | undefined => {
        const band = bandAtRow(doc.bands, addr.row)
        if (band?.kind !== 'detail' || base?.fill) return undefined
        return { ...base, fill: { color: DETAIL_BAND_TINT } }
      },
      // 选区拦截：拾取模式接管（选区不落模型，点选回交宿主）
      interceptSelection: () => pickMode,
      onSelectionIntercept: (range) => options.onCellPick?.(range.start),
    })
    mountedRows = doc.rows
    mountedGeometry = captureGeometry(doc)
    wrapper = host
    guides.attach(instance)
    return instance
  }

  grid = createGrid()

  /**
   * 模型变更后的视图同步：行数变化、行高/列宽键清除或合并区变化（快照级静默
   * restore 清空模型键、波段平移改写合并——引擎侧行高覆盖无清除 API、合并 Map
   * 仅事件驱动同步，非重建路径无法表达）时重建网格；其余同步尺寸并整表重绘。
   */
  function syncView(): void {
    if (released) return
    if (doc.rows !== mountedRows) {
      remount()
      return
    }
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
    // 行高/列宽就地同步后参考线随 sky 整层失效重绘（重建路径经 createGrid 重挂已覆盖）
    guides.refresh()
  }

  // 波段结构或撤销链变化（快照级编辑的静默 restore 不发 sheet 事件，统一走这里）
  disposers.push(doc.on('bands-change', syncView))
  disposers.push(doc.on('history-change', syncView))
  // 常规模式选区流动：回带活动格所在波段（波段/格选中语义）
  disposers.push(
    doc.sheet.on('selection-change', (state) => {
      if (released || pickMode || !state.activeCell) return
      options.onSelectionChange?.({
        addr: state.activeCell,
        band: bandAtRow(doc.bands, state.activeCell.row),
      })
    }),
  )

  function remount(): void {
    grid?.release()
    wrapper?.remove()
    grid = createGrid()
  }

  return {
    setPickMode(on: boolean): void {
      pickMode = on
    },
    refresh(): void {
      syncView()
    },
    setPaperGuides(config: PaperGuidesConfig | null): void {
      guides.update(config)
    },
    getGrid(): SheetGrid | undefined {
      return grid
    },
    release(): void {
      if (released) return
      released = true
      guides.detach()
      for (const dispose of disposers) dispose()
      disposers.length = 0
      grid?.release()
      wrapper?.remove()
      grid = undefined
      wrapper = undefined
    },
  }
}
