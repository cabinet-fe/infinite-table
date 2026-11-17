import { EditorRegistry, type CellEditor, type CellEditorSession } from '@infinitable/table'

import type { CellAddress } from '../core/address'
import type { CellValue } from '../core/cell-store'

/** 统一文本编辑器注册名（未命中路由的回落目标，引擎侧等价于列级 `editor` 声明） */
export const SHEET_TEXT_EDITOR = 'sheet-text'

/** 锚定格视口矩形（CSS 像素，容器坐标系；与引擎文本编辑浮层同口径） */
export interface GridEditorRect {
  x: number
  y: number
  width: number
  height: number
}

/** 编辑会话上下文（`GridCellEditor.open` 入参）：机制负责生命周期与提交通道，宿主只管编辑 UI */
export interface GridEditorSession {
  /** 锚定格（0-based） */
  addr: CellAddress
  /** 编辑 UI 挂载容器（表格容器；绝对定位坐标系，编辑浮层直接挂其内） */
  container: HTMLElement
  /** 锚定格视口矩形（CSS 像素，容器坐标系） */
  rect: GridEditorRect
  /** 编辑初值（基础值口径：公式格为 `'=' + f` 原文） */
  value: CellValue | undefined
  /** 提交：写模型（经命令系统，可 undo）并结束会话 */
  commit(value: CellValue): void
  /** 取消：结束会话，不写模型 */
  cancel(): void
  /** 滚动跟随：会话内锚定格矩形变化时回调（编辑 UI 据此重定位；重复订阅替换前一监听） */
  onRectChange(listener: (rect: GridEditorRect) => void): void
}

/** 类型化单元格编辑器：宿主实现编辑 UI，挂载/回收与提交由机制驱动 */
export interface GridCellEditor {
  /** 编辑器名（注册 key；格级路由返回此名命中） */
  readonly name: string
  /** 会话打开：编辑 UI 挂到 `session.container` 并定位到 `session.rect` */
  open(session: GridEditorSession): void
  /** 会话关闭（提交/取消后机制回收）：摘除编辑 UI */
  close(): void
}

/** 编辑器机制 options（`SheetGridOptions.editors`） */
export interface SheetGridEditorsOptions {
  /** 自定义编辑器集合；`name` 重复以后者为准 */
  editors: GridCellEditor[]
  /** 格级路由：返回编辑器名（须在 `editors` 内）；返回 undefined 或未注册名回落统一文本编辑器 */
  route?: (addr: CellAddress) => string | undefined
}

/**
 * 类型化编辑器路由：直接将 `GridCellEditor` 适配为引擎原生会话型 `CellEditor` 注册到
 * `EditorRegistry`——引擎 `EditManager` 原生托管生命周期、滚动帧矩形跟随、提交通道与事件派发。
 */
export class GridEditorRouting {
  private readonly editors = new Map<string, GridCellEditor>()

  constructor(
    private readonly options: SheetGridEditorsOptions,
    private readonly container?: HTMLElement,
  ) {
    for (const editor of options.editors) {
      this.editors.set(editor.name, editor)
    }
  }

  /**
   * 构造引擎注册表（引擎构造期装配）：注册默认文本编辑器 + 适配后的原生会话型自定义编辑器；
   * route 包装只放行已注册的自定义编辑器名，未命中回落列级 `sheet-text` 声明。
   */
  createRegistry(): EditorRegistry {
    const registry = new EditorRegistry(this.engineRoute)
    registry.registerEditor(SHEET_TEXT_EDITOR, {})
    for (const editor of this.editors.values()) {
      registry.registerEditor(editor.name, this.adaptEditor(editor))
    }
    return registry
  }

  private adaptEditor(editor: GridCellEditor): CellEditor {
    return {
      name: editor.name,
      open: (session: CellEditorSession) => {
        editor.open({
          addr: { row: session.row, col: session.col },
          container: session.container ?? this.container!,
          rect: session.rect,
          value: session.initialValue as CellValue | undefined,
          commit: (value) => session.commit(value),
          cancel: () => session.cancel(),
          onRectChange: (listener) => session.onRectChange(listener),
        })
      },
      close: () => {
        editor.close()
      },
    }
  }

  /** 引擎 route hook：命中已注册自定义编辑器才返回其名（否则 undefined → 列级 sheet-text） */
  private readonly engineRoute: (col: number, row: number) => string | undefined = (col, row) => {
    const name = this.options.route?.({ row, col })
    return name && this.editors.has(name) ? name : undefined
  }
}
