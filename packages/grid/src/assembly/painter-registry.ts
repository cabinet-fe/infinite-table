// 整层绘制器注册表：按 (slot, id) 唯一登记并依 order + 注册序稳定排序。

import type { PainterRegistration, PainterSlot } from '@infinitable/protocol'
import type { RenderContext, Size } from '@infinitable/render'

interface PainterEntry {
  readonly registration: PainterRegistration
  readonly order: number
  readonly seq: number
}

/**
 * 整层绘制器注册表（underlay / overlay 槽位）：
 * - 按 (slot, id) 覆盖替换；
 * - 同一槽位内按 (order ?? 0) 升序、同 order 按注册先后排序；
 * - register 返回幂等注销函数（被同 id 替换后旧注销函数不误删新项）。
 */
export class PainterRegistry {
  private readonly slots = new Map<PainterSlot, PainterEntry[]>()
  private readonly cached = new Map<PainterSlot, readonly PainterRegistration[]>()
  private nextSeq = 0

  register(registration: PainterRegistration): () => void {
    const slot = registration.slot
    let entries = this.slots.get(slot)
    if (!entries) {
      entries = []
      this.slots.set(slot, entries)
    }

    const existingIndex = entries.findIndex((item) => item.registration.id === registration.id)
    if (existingIndex !== -1) {
      entries.splice(existingIndex, 1)
    }

    const entry: PainterEntry = {
      registration,
      order: registration.order ?? 0,
      seq: this.nextSeq++,
    }
    entries.push(entry)
    entries.sort((a, b) => a.order - b.order || a.seq - b.seq)
    this.cached.set(
      slot,
      entries.map((item) => item.registration),
    )

    return () => {
      const current = this.slots.get(slot)
      if (!current) {
        return
      }
      const index = current.indexOf(entry)
      if (index === -1) {
        return
      }
      current.splice(index, 1)
      if (current.length === 0) {
        this.slots.delete(slot)
        this.cached.delete(slot)
      } else {
        this.cached.set(
          slot,
          current.map((item) => item.registration),
        )
      }
    }
  }

  getPainters(slot: PainterSlot): readonly PainterRegistration[] {
    return this.cached.get(slot) ?? []
  }

  has(slot: PainterSlot): boolean {
    const entries = this.slots.get(slot)
    return entries !== undefined && entries.length > 0
  }

  paint(slot: PainterSlot, ctx: RenderContext, viewport: Size): void {
    const painters = this.getPainters(slot)
    for (const painter of painters) {
      painter.paint(ctx, viewport)
    }
  }

  clear(): void {
    this.slots.clear()
    this.cached.clear()
  }
}
