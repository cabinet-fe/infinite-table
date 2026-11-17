// 打印插件：print 散装能力（分页 / 文档构建 / 打印输出 / DOM 预览）收拢为 EnginePlugin
// 对象形态。print 链路本身 headless（不接线引擎任何挂点）：mount 仅为记录挂载引擎
// （协议面，P7），既有能力全部经 handle 方法达成——分页 paginate、文档构建
// buildDocumentHtml、打印输出 print（触 DOM）、DOM 预览 openPreview（触 DOM）。
// 数据源与基线配置以插件 options 为中心（GridReadView / PrintConfig），方法调用可逐次
// 覆盖配置（演示区按控件合成配置的形态）；print 钩子（PrintHooks）随 options 注入，
// print 输出与预览内打印按钮共用。供数两路：显式 source（宿主自备 GridReadView）
// 或挂载引擎的能力探测（mountedEngine.capabilities.gridRead）；两者皆缺时 handle 方法
// fail-fast。实现细节模块（paginate/page-html/header-footer/print-output/preview）
// 保留在包内深路径，不经公共入口转出。

import type { EngineAssembly, EnginePlugin, GridReadView } from '@infinitable/protocol'

import { buildPrintDocumentHtml } from './page-html'
import { paginate, type PrintPage } from './paginate'
import { openPrintPreview, type PrintPreviewHandle } from './preview'
import { printPages, type PrintHooks } from './print-output'
import type { PrintConfig } from './types'

/** 打印插件配置：数据源 + 基线打印配置 + 输出钩子 */
export interface PrintPluginOptions {
  /**
   * 打印数据源（@infinitable/protocol 的 GridReadView）；与挂载引擎供数二选一——
   * 缺省时经挂载引擎的 capabilities.gridRead 供数。
   */
  source?: GridReadView
  /** 基线打印配置（方法调用未显式给 config 时回落到此；缺省字段走各模块缺省值） */
  config?: PrintConfig
  /** 打印钩子（print 输出与预览内打印按钮共用；测试注入桩替换真实 print） */
  hooks?: PrintHooks
}

/** 打印插件句柄：EnginePlugin 契约 + 打印链路既有入口（可脱离引擎 headless 调用） */
export interface PrintPluginHandle extends EnginePlugin {
  /** 打印分页（headless）：按配置把数据源划分为页 */
  paginate(config?: PrintConfig): PrintPage[]
  /** 构建完整打印文档 HTML（headless 纯函数：分页 + 各页拼装） */
  buildDocumentHtml(config?: PrintConfig): string
  /** 打印输出（触 DOM）：隐藏 iframe 装载文档 → 调起打印 → 清理 */
  print(config?: PrintConfig): Promise<void>
  /** 打开打印预览弹层（触 DOM）：缩略列表 + 当前页放大预览 + 打印按钮 */
  openPreview(config?: PrintConfig): PrintPreviewHandle
}

/** 从打印配置页眉提取非占位符文本作为缺省表名（用于预览顶栏与文档标题） */
function extractTitleFromConfig(config: PrintConfig): string | undefined {
  const header = config.headerFooter?.header
  if (!header) {
    return undefined
  }
  for (const part of [header.center, header.left, header.right]) {
    const trimmed = part?.trim()
    if (trimmed && !trimmed.includes('{')) {
      return trimmed
    }
  }
  return undefined
}

/** 包装 GridReadView 补齐缺省表名（转发方法调用，保留类实例原型链与 this 绑定） */
function withFallbackName(gridRead: GridReadView, name: string): GridReadView {
  return {
    name,
    get rowCount() {
      return gridRead.rowCount
    },
    get colCount() {
      return gridRead.colCount
    },
    getRowHeight: (row) => gridRead.getRowHeight(row),
    getColWidth: (col) => gridRead.getColWidth(col),
    getCellText: (col, row) => gridRead.getCellText(col, row),
    getCellValue: (col, row) => gridRead.getCellValue(col, row),
    getCellStyle: (col, row) => gridRead.getCellStyle(col, row),
    getMergeRanges: () => gridRead.getMergeRanges(),
    ...(gridRead.getCellImage
      ? { getCellImage: (col: number, row: number) => gridRead.getCellImage!(col, row) }
      : {}),
  }
}

/**
 * 创建打印插件：可经构造 options.plugins / 引擎 use() 注册（mount 只记录挂载引擎，
 * 无引擎侧副作用），也可脱离引擎直接以 handle 形态 headless 消费（须显式给 source）。
 * 供数解析：显式 source 优先；否则挂载引擎提供 capabilities.gridRead 即由其供数；
 * 两者皆缺时 handle 方法抛错（不静默产出空文档）。
 */
export function createPrintPlugin(options: PrintPluginOptions): PrintPluginHandle {
  let mountedEngine: EngineAssembly | null = null
  const resolveConfig = (config?: PrintConfig): PrintConfig => config ?? options.config ?? {}
  const resolveSource = (resolvedConfig: PrintConfig): GridReadView => {
    if (options.source) {
      return options.source
    }
    const gridRead = mountedEngine?.capabilities?.gridRead
    if (!gridRead) {
      throw new Error(
        '打印插件无可供数源：显式给 options.source，或挂载提供 capabilities.gridRead 的引擎',
      )
    }
    if (gridRead.name === undefined) {
      const name = extractTitleFromConfig(resolvedConfig)
      if (name !== undefined) {
        return withFallbackName(gridRead, name)
      }
    }
    return gridRead
  }
  return {
    name: 'print',
    mount(engine) {
      // print 链路不接线引擎挂点（headless 内核与 DOM 薄壳均不依赖引擎实例）：
      // 仅记录挂载引擎，供 source 缺省时经其 capabilities.gridRead 供数
      mountedEngine = engine
      return () => {
        if (mountedEngine === engine) {
          mountedEngine = null
        }
      }
    },
    unmount() {
      mountedEngine = null
    },
    paginate(config) {
      const resolved = resolveConfig(config)
      return paginate(resolveSource(resolved), resolved)
    },
    buildDocumentHtml(config) {
      const resolved = resolveConfig(config)
      return buildPrintDocumentHtml(resolveSource(resolved), resolved)
    },
    print(config) {
      const resolved = resolveConfig(config)
      return printPages(resolveSource(resolved), resolved, options.hooks)
    },
    openPreview(config) {
      const resolved = resolveConfig(config)
      return openPrintPreview(resolveSource(resolved), resolved, options.hooks)
    },
  }
}
