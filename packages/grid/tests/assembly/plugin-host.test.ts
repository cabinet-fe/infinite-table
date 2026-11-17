import type { EngineAssembly, EnginePlugin } from '@infinitable/protocol'
import type { RenderHost } from '@infinitable/render'
import { describe, expect, it, vi } from 'vitest'

import { PluginHost } from '../../src/assembly/plugin-host'
import { defaultTheme } from '../../src/theme'

function createStubEngine(): EngineAssembly {
  return {
    host: {} as RenderHost,
    width: 800,
    height: 600,
    resize: () => {},
    getTheme: () => defaultTheme,
    updateTheme: () => {},
    registerPainter: () => () => {},
    use: () => () => {},
    unuse: () => {},
    destroy: () => {},
  }
}

describe('PluginHost 插件宿主', () => {
  it('挂载插件传入 engine，返回的 disposer 依次执行 cleanup 与 unmount 且幂等', () => {
    const engine = createStubEngine()
    const host = new PluginHost(engine)
    const log: string[] = []

    const plugin: EnginePlugin = {
      name: 'demo',
      mount: (target) => {
        expect(target).toBe(engine)
        log.push('mount')
        return () => log.push('cleanup')
      },
      unmount: (target) => {
        expect(target).toBe(engine)
        log.push('unmount')
      },
    }

    const dispose = host.use(plugin)
    expect(log).toEqual(['mount'])

    dispose()
    dispose()
    expect(log).toEqual(['mount', 'cleanup', 'unmount'])
  })

  it('同实例重复挂载返回既有 disposer（幂等，不重复 mount）', () => {
    const engine = createStubEngine()
    const host = new PluginHost(engine)
    const mount = vi.fn<EnginePlugin['mount']>()
    const plugin: EnginePlugin = { name: 'same', mount }

    const d1 = host.use(plugin)
    const d2 = host.use(plugin)
    expect(d2).toBe(d1)
    expect(mount).toHaveBeenCalledTimes(1)
  })

  it('同名不同实例挂载时先卸载旧实例再挂载新实例，旧 disposer 不误删新实例', () => {
    const engine = createStubEngine()
    const host = new PluginHost(engine)
    const log: string[] = []

    const p1: EnginePlugin = {
      name: 'dup',
      mount: () => {
        log.push('mount-1')
        return () => log.push('cleanup-1')
      },
      unmount: () => log.push('unmount-1'),
    }
    const p2: EnginePlugin = {
      name: 'dup',
      mount: () => {
        log.push('mount-2')
        return () => log.push('cleanup-2')
      },
      unmount: () => log.push('unmount-2'),
    }

    const d1 = host.use(p1)
    const d2 = host.use(p2)
    expect(log).toEqual(['mount-1', 'cleanup-1', 'unmount-1', 'mount-2'])

    // 旧 disposer 与旧实例 unuse 均不得误卸载 p2
    d1()
    host.unuse(p1)
    expect(log).toEqual(['mount-1', 'cleanup-1', 'unmount-1', 'mount-2'])

    d2()
    expect(log).toEqual(['mount-1', 'cleanup-1', 'unmount-1', 'mount-2', 'cleanup-2', 'unmount-2'])
  })

  it('unuse 支持按名称或实例卸载且对未挂载项幂等', () => {
    const engine = createStubEngine()
    const host = new PluginHost(engine)
    const log: string[] = []

    const p1: EnginePlugin = {
      name: 'a',
      mount: () => () => log.push('cleanup-a'),
      unmount: () => log.push('unmount-a'),
    }
    const p2: EnginePlugin = {
      name: 'b',
      mount: () => () => log.push('cleanup-b'),
      unmount: () => log.push('unmount-b'),
    }

    host.use(p1)
    host.use(p2)

    host.unuse('a')
    host.unuse('a')
    host.unuse('missing')
    host.unuse(p2)
    host.unuse(p2)

    expect(log).toEqual(['cleanup-a', 'unmount-a', 'cleanup-b', 'unmount-b'])
  })

  it('unmountAll 按注册逆序卸载全部插件并清空', () => {
    const engine = createStubEngine()
    const host = new PluginHost(engine)
    const log: string[] = []

    for (const name of ['first', 'second', 'third']) {
      host.use({
        name,
        mount: () => () => log.push(`cleanup-${name}`),
        unmount: () => log.push(`unmount-${name}`),
      })
    }

    host.unmountAll()
    host.unmountAll()
    expect(log).toEqual([
      'cleanup-third',
      'unmount-third',
      'cleanup-second',
      'unmount-second',
      'cleanup-first',
      'unmount-first',
    ])
  })

  it('mount 抛错时清理半挂载状态，后续同名挂载可恢复', () => {
    const engine = createStubEngine()
    const host = new PluginHost(engine)
    const broken: EnginePlugin = {
      name: 'flaky',
      mount: () => {
        throw new Error('boom')
      },
    }
    expect(() => host.use(broken)).toThrow('boom')

    const healthyMount = vi.fn<EnginePlugin['mount']>()
    host.use({ name: 'flaky', mount: healthyMount })
    expect(healthyMount).toHaveBeenCalledTimes(1)
  })
})
