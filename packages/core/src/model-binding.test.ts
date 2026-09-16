import { describe, expect, it } from 'vitest';

import { ModelBinding } from './model-binding';
import type { CellChangeEvent, TableModel } from './types';

/** 同步 echo 的假模型：setCellValue 内同步发变更事件（模拟回驱 echo） */
class EchoModel implements TableModel {
  readonly rowCount = 100;
  readonly data = new Map<string, unknown>();
  private readonly listeners = new Set<(change: CellChangeEvent) => void>();
  setCalls = 0;

  getCellValue(col: number, row: number): unknown {
    return this.data.get(`${col}:${row}`);
  }

  setCellValue(col: number, row: number, value: unknown): void {
    this.setCalls++;
    this.data.set(`${col}:${row}`, value);
    this.emit({ col, row });
  }

  onCellChange(listener: (change: CellChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(change: CellChangeEvent): void {
    for (const listener of this.listeners) {
      listener(change);
    }
  }
}

describe('ModelBinding 模型事件订阅与回驱防递归', () => {
  it('外部变更事件转发给表格', () => {
    const model = new EchoModel();
    const received: CellChangeEvent[] = [];
    const binding = new ModelBinding(model, (change) => received.push(change));
    binding.attach();
    model.emit({ col: 1, row: 2 });
    expect(received).toEqual([{ col: 1, row: 2 }]);
    binding.dispose();
  });

  it('回驱（writeBack）期间模型同步 echo 的事件被吞掉，不回环', () => {
    const model = new EchoModel();
    const received: CellChangeEvent[] = [];
    const binding = new ModelBinding(model, (change) => received.push(change));
    binding.attach();
    binding.writeBack(0, 0, 'x');
    expect(model.getCellValue(0, 0)).toBe('x');
    expect(model.setCalls).toBe(1);
    expect(received).toEqual([]);
  });

  it('外部事件处理器里回驱模型：echo 被吞掉，不递归重入', () => {
    const model = new EchoModel();
    const received: CellChangeEvent[] = [];
    const binding = new ModelBinding(model, (change) => {
      received.push(change);
      // 外部变更触发的回写：其 echo 同样被吞掉，不会再次进入本处理器
      binding.writeBack(change.col, change.row, 'handled');
    });
    binding.attach();
    model.emit({ col: 3, row: 4 });
    expect(received).toEqual([{ col: 3, row: 4 }]);
    expect(model.setCalls).toBe(1);
    expect(model.getCellValue(3, 4)).toBe('handled');
  });

  it('dispose 后不再接收事件；attach 幂等', () => {
    const model = new EchoModel();
    const received: CellChangeEvent[] = [];
    const binding = new ModelBinding(model, (change) => received.push(change));
    binding.attach();
    binding.attach();
    binding.dispose();
    model.emit({ col: 0, row: 0 });
    expect(received).toEqual([]);
  });

  it('模型未提供 setCellValue 时 writeBack 为空操作', () => {
    const model = new EchoModel();
    const readOnly: TableModel = {
      rowCount: 1,
      getCellValue: () => undefined,
      onCellChange: (l) => model.onCellChange(l),
    };
    const binding = new ModelBinding(readOnly, () => {});
    binding.attach();
    expect(() => binding.writeBack(0, 0, 'x')).not.toThrow();
  });
});
