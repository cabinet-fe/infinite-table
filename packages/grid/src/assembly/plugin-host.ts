// 引擎插件宿主：统一按 plugin.name 去重、挂载清理与逆序卸载。

import type { EngineAssembly, EnginePlugin } from '@infinitable/protocol'

interface MountedPlugin {
  readonly plugin: EnginePlugin
  cleanup?: () => void
  readonly disposer: () => void
}

/**
 * 引擎插件挂载宿主：
 * - 同实例重复挂载返回既有 disposer（幂等）；
 * - 同名不同实例挂载先卸载旧实例再挂载新实例；
 * - 卸载时依次执行 mount 返回的 cleanup（若有）与 plugin.unmount；
 * - unmountAll 按注册逆序全部卸载并清空。
 */
export class PluginHost {
  private readonly mounted = new Map<string, MountedPlugin>()

  constructor(private readonly engine: EngineAssembly) {}

  use(plugin: EnginePlugin): () => void {
    const existing = this.mounted.get(plugin.name)
    if (existing) {
      if (existing.plugin === plugin) {
        return existing.disposer
      }
      this.unmountEntry(existing)
    }

    const entry: MountedPlugin = {
      plugin,
      disposer: () => {
        if (this.mounted.get(plugin.name) === entry) {
          this.unmountEntry(entry)
        }
      },
    }
    this.mounted.set(plugin.name, entry)

    try {
      const cleanup = plugin.mount(this.engine)
      if (typeof cleanup === 'function' && this.mounted.get(plugin.name) === entry) {
        entry.cleanup = cleanup
      }
    } catch (error) {
      if (this.mounted.get(plugin.name) === entry) {
        this.mounted.delete(plugin.name)
      }
      throw error
    }

    return entry.disposer
  }

  unuse(pluginOrName: EnginePlugin | string): void {
    if (typeof pluginOrName === 'string') {
      const entry = this.mounted.get(pluginOrName)
      if (entry) {
        this.unmountEntry(entry)
      }
      return
    }
    const entry = this.mounted.get(pluginOrName.name)
    if (entry && entry.plugin === pluginOrName) {
      this.unmountEntry(entry)
    }
  }

  unmountAll(): void {
    const entries = [...this.mounted.values()].reverse()
    for (const entry of entries) {
      if (this.mounted.get(entry.plugin.name) === entry) {
        this.unmountEntry(entry)
      }
    }
  }

  private unmountEntry(entry: MountedPlugin): void {
    this.mounted.delete(entry.plugin.name)
    try {
      entry.cleanup?.()
    } finally {
      entry.plugin.unmount?.(this.engine)
    }
  }
}
