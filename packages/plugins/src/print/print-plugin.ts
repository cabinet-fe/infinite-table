// 打印插件：print 散装能力（分页 / 文档构建 / 打印输出 / DOM 预览）收拢为 TablePlugin
// 对象形态。print 链路本身 headless（不接线引擎任何挂点）：mount 仅为记录挂载引擎
// （协议面，P7），既有能力全部经 handle 方法达成——分页 paginate、文档构建
// buildDocumentHtml、打印输出 print（触 DOM）、DOM 预览 openPreview（触 DOM）。
// 数据源与基线配置以插件 options 为中心（PrintSource/PrintConfig），方法调用可逐次
// 覆盖配置（演示区按控件合成配置的形态）；print 钩子（PrintHooks）随 options 注入，
// print 输出与预览内打印按钮共用。供数两路（G12-G15）：显式 source（宿主自备模型
// 适配）或挂载引擎的导出读取面（engine.read 经 createEnginePrintSource 适配）；
// 两者皆缺时 handle 方法 fail-fast。实现细节模块（paginate/page-html/header-footer/
// print-output/preview/engine-source）保留在包内深路径，不经公共入口转出。

import type { EngineAssembly, TablePlugin } from '@infinitable/table'

import { createEnginePrintSource } from './engine-source'
import { buildPrintDocumentHtml } from './page-html'
import { paginate, type PrintPage } from './paginate'
import { openPrintPreview, type PrintPreviewHandle } from './preview'
import { printPages, type PrintHooks } from './print-output'
import type { PrintConfig, PrintSource } from './types'

/** 打印插件配置：数据源 + 基线打印配置 + 输出钩子 */
export interface PrintPluginOptions {
  /**
   * 打印数据源（宿主/适配器供数的窄接口，字段口径见 print/types）；与挂载引擎
   * 供数二选一——缺省时经挂载引擎的导出读取面（engine.read）适配供数。
   */
  source?: PrintSource
  /** 基线打印配置（方法调用未显式给 config 时回落到此；缺省字段走各模块缺省值） */
  config?: PrintConfig
  /** 打印钩子（print 输出与预览内打印按钮共用；测试注入桩替换真实 print） */
  hooks?: PrintHooks
}

/** 打印插件句柄：TablePlugin 契约 + 打印链路既有入口（可脱离引擎 headless 调用） */
export interface PrintPluginHandle extends TablePlugin {
  /** 打印分页（headless）：按配置把数据源划分为页 */
  paginate(config?: PrintConfig): PrintPage[]
  /** 构建完整打印文档 HTML（headless 纯函数：分页 + 各页拼装） */
  buildDocumentHtml(config?: PrintConfig): string
  /** 打印输出（触 DOM）：隐藏 iframe 装载文档 → 调起打印 → 清理 */
  print(config?: PrintConfig): Promise<void>
  /** 打开打印预览弹层（触 DOM）：缩略列表 + 当前页放大预览 + 打印按钮 */
  openPreview(config?: PrintConfig): PrintPreviewHandle
}

/**
 * 创建打印插件：可经构造 options.plugins / 引擎 use() 注册（mount 只记录挂载引擎，
 * 无引擎侧副作用），也可脱离引擎直接以 handle 形态 headless 消费（须显式给 source）。
 * 供数解析：显式 source 优先；否则挂载引擎提供导出读取面（engine.read）即由其供数；
 * 两者皆缺时 handle 方法抛错（不静默产出空文档）。
 */
export function createPrintPlugin(options: PrintPluginOptions): PrintPluginHandle {
  let mountedEngine: EngineAssembly | null = null
  const resolveConfig = (config?: PrintConfig): PrintConfig => config ?? options.config ?? {}
  const resolveSource = (): PrintSource => {
    if (options.source) {
      return options.source
    }
    if (mountedEngine?.read) {
      return createEnginePrintSource(mountedEngine)
    }
    throw new Error(
      '打印插件无可供数源：显式给 options.source，或挂载到提供导出读取面（engine.read）的引擎',
    )
  }
  return {
    name: 'print',
    mount(engine) {
      // print 链路不接线引擎挂点（headless 内核与 DOM 薄壳均不依赖引擎实例）：
      // 仅记录挂载引擎，供 source 缺省时经其导出读取面建立供数
      mountedEngine = engine
    },
    unmount() {
      mountedEngine = null
    },
    paginate(config) {
      return paginate(resolveSource(), resolveConfig(config))
    },
    buildDocumentHtml(config) {
      return buildPrintDocumentHtml(resolveSource(), resolveConfig(config))
    },
    print(config) {
      return printPages(resolveSource(), resolveConfig(config), options.hooks)
    },
    openPreview(config) {
      return openPrintPreview(resolveSource(), resolveConfig(config), options.hooks)
    },
  }
}
