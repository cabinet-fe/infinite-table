// 水印插件（univer watermark 移植，文字平铺形态）：EnginePlugin 契约经引擎装配协议的
// 顶层 overlay 槽位挂载（P7：挂载参数为协议面 EngineAssembly，不绑定具体引擎类型）
// ——mount 经协议 registerPainter({ id: 'watermark', slot: 'overlay', paint }) 注册绘制器
// （enabled 时），unmount 或 disabled 时调用注销函数还原槽位。
// overlay 挂 sky 层（四层最上）最顶：水印覆盖在表格内容之上，任意主题（含 body 层
// 不透明缺省白底）都可见，零宿主配置；内容之下的衬底水印场景由宿主改用引擎
// ground 槽位（slot: 'underlay'）。
// 配置与打印水印共享 P1 的 WatermarkTextConfig（三端同模型）；handle 支持运行时
// updateConfig（任一项变更重新注册一帧内重绘）与读取当前配置/开关态。
// import 面零引擎内部 API：只经 @infinitable/protocol 契约面。

import type { EngineAssembly, EnginePlugin, LayerPainter } from '@infinitable/protocol'

import type { WatermarkTextConfig } from '../print/types'
import { drawTextWatermark, resolveWatermarkStyle } from './tile'

/** 水印插件句柄：EnginePlugin 契约 + 运行时配置读写 */
export interface WatermarkHandle extends EnginePlugin {
  /** 运行时更新配置（浅合并；任一项变更触发 sky 整层失效，一帧内重绘生效；值未变的补丁无操作） */
  updateConfig(patch: Partial<WatermarkTextConfig>): void
  /** 当前完整配置快照（缺省值已并入，返回副本） */
  getConfig(): WatermarkTextConfig
  /** 当前开关态（config.enabled） */
  isEnabled(): boolean
}

/** 两份配置是否逐字段相同（updateConfig 的无变化守卫） */
function sameWatermarkConfig(a: WatermarkTextConfig, b: WatermarkTextConfig): boolean {
  return (
    a.enabled === b.enabled &&
    a.text === b.text &&
    a.fontSize === b.fontSize &&
    a.color === b.color &&
    a.opacity === b.opacity &&
    a.rotate === b.rotate &&
    a.gapX === b.gapX &&
    a.gapY === b.gapY
  )
}

/**
 * 创建水印插件：配置必给 enabled/text（样式字段可选，缺省见 WATERMARK_TEXT_DEFAULTS）。
 * 构造 options.plugins 或引擎 use() 注册即挂载；返回值既是 EnginePlugin 也是运行时句柄。
 */
export function createWatermarkPlugin(config: WatermarkTextConfig): WatermarkHandle {
  let current: WatermarkTextConfig = { ...config }
  let engine: EngineAssembly | null = null
  let unregister: (() => void) | null = null

  // painter 捕获配置引用（updateConfig 整体换引用，重绘帧读到的是最新配置）
  const painter: LayerPainter = (ctx, viewport) => {
    drawTextWatermark(ctx, current, viewport)
  }

  /** 注销已注册的 overlay painter 并清空引用（幂等） */
  const clearPainter = (): void => {
    unregister?.()
    unregister = null
  }

  /** 按当前配置同步 overlay 槽位：enabled 注册（或同 id 覆写）painter，否则注销清空（开关即时可见） */
  const applyPainter = (): void => {
    if (!engine) {
      return
    }
    if (current.enabled) {
      unregister = engine.registerPainter({ id: 'watermark', slot: 'overlay', paint: painter })
    } else {
      clearPainter()
    }
  }

  /** 卸载清理：注销 painter 并清除引擎引用（幂等） */
  const dispose = (): void => {
    clearPainter()
    engine = null
  }

  return {
    // 插件名（引擎插件注册路径用；常量内化，不经公共入口转出）
    name: 'watermark',
    mount(target: EngineAssembly) {
      engine = target
      applyPainter()
      return dispose
    },
    unmount() {
      dispose()
    },
    updateConfig(patch: Partial<WatermarkTextConfig>) {
      const next = { ...current, ...patch }
      if (sameWatermarkConfig(next, current)) {
        return
      }
      current = next
      // 挂载态即时重绘；未挂载只改配置，mount 时按新配置生效
      applyPainter()
    },
    getConfig(): WatermarkTextConfig {
      // 缺省值并入后返回完整配置（enabled/text 原样 + 样式解析结果）
      return { enabled: current.enabled, text: current.text, ...resolveWatermarkStyle(current) }
    },
    isEnabled(): boolean {
      return current.enabled
    },
  }
}
