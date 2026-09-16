import { describe, expect, it } from 'vitest';

import { projectCellStyle, type CellStyle } from './cell-style';

const BASE: CellStyle = {
  background: '#ffffff',
  color: '#1f2329',
  font: '12px sans-serif',
};

describe('projectCellStyle 样式投影', () => {
  it('hook 返回 null：沿用基础样式', () => {
    expect(projectCellStyle(BASE, null)).toEqual(BASE);
  });

  it('逐字段覆盖：未覆盖字段继承基础样式', () => {
    const result = projectCellStyle(BASE, { background: '#fafafa' });
    expect(result).toEqual({ ...BASE, background: '#fafafa' });
  });

  it('逐边边框：override 只给一边时基础样式其余边保留', () => {
    const base: CellStyle = {
      border: {
        top: { width: 1, color: '#ddd' },
        bottom: { width: 1, color: '#ddd' },
      },
    };
    const result = projectCellStyle(base, {
      border: { left: { width: 2, color: '#f00' } },
    });
    expect(result.border).toEqual({
      top: { width: 1, color: '#ddd' },
      bottom: { width: 1, color: '#ddd' },
      left: { width: 2, color: '#f00' },
    });
  });

  it('同边覆盖以 override 为准', () => {
    const base: CellStyle = { border: { top: { width: 1, color: '#ddd' } } };
    const result = projectCellStyle(base, { border: { top: { width: 3, color: '#000' } } });
    expect(result.border?.top).toEqual({ width: 3, color: '#000' });
  });

  it('不改入参（投影产出新对象）', () => {
    const base: CellStyle = { border: { top: { width: 1, color: '#ddd' } } };
    projectCellStyle(base, { border: { left: { width: 2, color: '#f00' } } });
    expect(base.border).toEqual({ top: { width: 1, color: '#ddd' } });
  });

  it('override 给空 border 对象：保留基础边框', () => {
    const base: CellStyle = { border: { right: { width: 1, color: '#ddd' } } };
    const result = projectCellStyle(base, { border: {} });
    expect(result.border).toEqual({ right: { width: 1, color: '#ddd' } });
  });
});
