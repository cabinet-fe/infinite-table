// 测试通用夹具：地址/区间构造器。
// 这些是纯数据字面量的简写，散在各测试文件里逐份复制时，一处改口径其余会悄悄漂移。
import type { CellAddress, CellRange } from '@infinitable/sheet'

import type { FormCellBinding } from '../../../src/designer/template'

/** 单元格地址（0 基行列） */
export const ADDR = (row: number, col: number): CellAddress => ({ row, col })

/** 矩形区间（左上 → 右下，含端点） */
export const RANGE = (r1: number, c1: number, r2: number, c2: number): CellRange => ({
  start: { row: r1, col: c1 },
  end: { row: r2, col: c2 },
})

/** 展开区内的相对绑定：形状只有 `{ path }`（datasetId/expression 继承数据块 source） */
export const relativeBinding = (path: string): FormCellBinding => ({ path })
