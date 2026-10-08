// 打印插件：print 散装能力（分页 / 文档构建 / 打印输出 / DOM 预览）收拢为 TablePlugin
// 对象形态。print 链路本身 headless（不接线表格任何挂点）：mount 仅为契约占位（无表侧
// 副作用），既有能力全部经 handle 方法达成——分页 paginate、文档构建 buildDocumentHtml、
// 打印输出 print（触 DOM）、DOM 预览 openPreview（触 DOM）。数据源与基线配置以插件
// options 为中心（PrintSource/PrintConfig），方法调用可逐次覆盖配置（演示区按控件合成
// 配置的形态）；print 钩子（PrintHooks）随 options 注入，print 输出与预览内打印按钮
// 共用。实现细节模块（paginate/page-html/header-footer/print-output/preview）保留在
// 包内深路径，不经公共入口转出。

import type { TablePlugin } from '@infinitable/core'

import { buildPrintDocumentHtml } from './page-html'
import { paginate, type PrintPage } from './paginate'
import { openPrintPreview, type PrintPreviewHandle } from './preview'
import { printPages, type PrintHooks } from './print-output'
import type { PrintConfig, PrintSource } from './types'

/** 打印插件配置：数据源 + 基线打印配置 + 输出钩子 */
export interface PrintPluginOptions {
  /** 打印数据源（宿主/适配器供数的窄接口，字段口径见 print/types） */
  source: PrintSource
  /** 基线打印配置（方法调用未显式给 config 时回落到此；缺省字段走各模块缺省值） */
  config?: PrintConfig
  /** 打印钩子（print 输出与预览内打印按钮共用；测试注入桩替换真实 print） */
  hooks?: PrintHooks
}

/** 打印插件句柄：TablePlugin 契约 + 打印链路既有入口（可脱离表格 headless 调用） */
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
 * 创建打印插件：可经构造 options.plugins / table.use() 注册（mount 为契约占位，
 * 注册与销毁均无表侧副作用），也可脱离表格直接以 handle 形态 headless 消费。
 */
export function createPrintPlugin(options: PrintPluginOptions): PrintPluginHandle {
  const resolveConfig = (config?: PrintConfig): PrintConfig => config ?? options.config ?? {}
  return {
    name: 'print',
    mount() {
      // print 链路不接线表格挂点（headless 内核与 DOM 薄壳均不依赖表格实例）
    },
    paginate(config) {
      return paginate(options.source, resolveConfig(config))
    },
    buildDocumentHtml(config) {
      return buildPrintDocumentHtml(options.source, resolveConfig(config))
    },
    print(config) {
      return printPages(options.source, resolveConfig(config), options.hooks)
    },
    openPreview(config) {
      return openPrintPreview(options.source, resolveConfig(config), options.hooks)
    },
  }
}
