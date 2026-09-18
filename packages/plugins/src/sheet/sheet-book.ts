// 多 sheet 管理：SheetBook 实例池（对标 ultra-ui 切 sheet 的全量重挂语义）。
// 每 sheet 定义惰性创建一个注入宿主的 ListTable（模型走 SheetStore.asModel()，
// 构造即应用 Store 的冻结/合并状态、创建后应用行列尺寸覆盖）；同 id 复用实例（池化）。
// switchTo 返回活跃实例并抛 change 事件，DOM 呈现（容器重挂/显隐）归宿主——即「切换全量重挂」。

import { ListTable, type CellRange, type ListTableOptions } from '@infinite-table/core'

import type { SheetStore } from './sheet-store'

/** 宿主可注入的渲染宿主形态（从 core 公开 options 面提取，插件不直接依赖 render） */
type RenderHostLike = NonNullable<ListTableOptions['host']>

/** sheet 定义：id + Store + 附加表 options（几何/主题/能力开关等，宿主偏好） */
export interface SheetDef {
  id: string
  store: SheetStore
  options?: Partial<ListTableOptions>
}

/** SheetBook 变更事件：切换/创建/移除时抛出（宿主据其重挂 DOM） */
export interface SheetBookChangeEvent {
  /** 新活跃 sheet id（无活跃为 null） */
  activeId: string | null
  /** 活跃实例（无活跃为 null） */
  table: ListTable | null
  /** 本次事件是否为该 sheet 实例首次创建（宿主可区分首挂与复挂） */
  created: boolean
}

/** 宿主注入的实例构造器：node 测试注入 StubHost、demo 注入容器 hostOptions（host 缺省由引擎自建） */
export type HostFactory = (def: SheetDef) => {
  host?: RenderHostLike
  hostOptions?: ListTableOptions['hostOptions']
}

export interface SheetBookOptions {
  /** 实例构造器（必注入：host 无法在插件层缺省创建） */
  createHost: HostFactory
  /** 每实例统一的表 options（列定义/几何/主题等；被 SheetDef.options 覆盖） */
  tableOptions?: Partial<ListTableOptions>
}

/**
 * sheet 实例池：注册/移除定义、惰性创建实例、切换活跃 sheet。
 * 实例以「store 状态 + 定义 options」构造，切换时池内复用——Store 是唯一事实源。
 */
export class SheetBook {
  private readonly defs = new Map<string, SheetDef>()
  private readonly pool = new Map<string, ListTable>()
  private readonly listeners = new Set<(event: SheetBookChangeEvent) => void>()
  private active: string | null = null

  constructor(private readonly options: SheetBookOptions) {}

  /** 注册 sheet 定义（同 id 重复注册替换定义，已建实例保留至下次显式移除） */
  register(def: SheetDef): void {
    this.defs.set(def.id, def)
  }

  /** 移除定义并销毁池内实例；移除活跃 sheet 时 activeId 置空并抛 change */
  remove(id: string): void {
    this.defs.delete(id)
    const table = this.pool.get(id)
    if (table) {
      table.destroy()
      this.pool.delete(id)
    }
    if (this.active === id) {
      this.active = null
      this.emit(null, false)
    }
  }

  has(id: string): boolean {
    return this.defs.has(id)
  }

  /** 池内活跃实例（未切换过为 undefined；无活跃 sheet 为 null） */
  get(id: string): ListTable | undefined {
    return this.pool.get(id)
  }

  get activeId(): string | null {
    return this.active
  }

  /** 当前活跃实例；无活跃为 null */
  get activeTable(): ListTable | null {
    return this.active ? (this.pool.get(this.active) ?? null) : null
  }

  /**
   * 切换活跃 sheet：实例惰性创建（池化复用）。构造 options = 统一 tableOptions
   * × 定义 options × Store 状态（模型/冻结/合并），创建后应用行列尺寸覆盖。
   * 定义不存在抛错；成功抛 change 事件（created 标记首次创建）。
   */
  switchTo(id: string): ListTable {
    const def = this.defs.get(id)
    if (!def) {
      throw new Error(`SheetBook: unknown sheet id "${id}"`)
    }
    let table = this.pool.get(id)
    let created = false
    if (!table) {
      const frozen = def.store.getFrozen()
      const hosted = this.options.createHost(def)
      table = new ListTable({
        width: 800,
        height: 600,
        columns: [{ field: 'name', title: 'A' }],
        ...this.options.tableOptions,
        ...def.options,
        model: def.store.asModel(),
        frozenColCount: frozen.colCount,
        frozenRowCount: frozen.rowCount,
        mergeCells: def.store.getMerges() as CellRange[],
        host: hosted.host,
        hostOptions: hosted.hostOptions,
      })
      this.applyGeometry(table, def.store)
      this.pool.set(id, table)
      created = true
    }
    this.active = id
    this.emit(id, created)
    return table
  }

  /** 订阅切换/创建/移除事件；返回退订函数 */
  onChange(listener: (event: SheetBookChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 销毁全部实例（宿主收尾用）；定义保留可重建 */
  dispose(): void {
    for (const table of this.pool.values()) {
      table.destroy()
    }
    this.pool.clear()
    this.active = null
  }

  /** Store 行列尺寸覆盖逐一落到实例（切 sheet 后尺寸事实源在 Store） */
  private applyGeometry(table: ListTable, store: SheetStore): void {
    for (const [col, width] of store.getColWidthOverrides()) {
      table.setColWidth(col, width)
    }
    for (const [row, height] of store.getRowHeightOverrides()) {
      table.setRowHeight(row, height)
    }
  }

  private emit(id: string | null, created: boolean): void {
    const event: SheetBookChangeEvent = {
      activeId: id,
      table: id ? (this.pool.get(id) ?? null) : null,
      created,
    }
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}
