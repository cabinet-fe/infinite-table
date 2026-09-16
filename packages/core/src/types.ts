// core 公共类型：数据供给三形态（records/columns、按格 hook、模型事件订阅）与 ListTable 配置

import type { RenderHost, RenderHostOptions } from '@infinite-table/render';

/** records 形态的一行数据 */
export type DataRecord = Record<string, unknown>;

/** 列定义（records/columns 数组形态的取值与表头描述） */
export interface ColumnDefine {
  /** records 取值字段；缺省时该列无数组值（仍可经 hook / 模型供给） */
  field?: string;
  /** 列头标题 */
  title?: string;
  /** 列宽（缺省用 ListTableOptions.defaultColWidth） */
  width?: number;
}

/**
 * 按格 hook：纯函数、同步、O(1)。
 * value 为取值管线的基础值（模型值或 records 字段值），返回最终显示文本。
 */
export type ResolveDisplayValue = (col: number, row: number, value: unknown) => string;

/** 模型单元格变更事件 */
export interface CellChangeEvent {
  col: number;
  row: number;
}

/**
 * 外部数据模型（模型事件订阅形态）：
 * 表格经 onCellChange 订阅外部变更做局部刷新；可选 setCellValue 为表格回驱入口，
 * 回驱时模型同步 echo 回来的事件由 ModelBinding 吞掉，防回环。
 */
export interface TableModel {
  readonly rowCount?: number;
  getCellValue(col: number, row: number): unknown;
  setCellValue?(col: number, row: number, value: unknown): void;
  onCellChange(listener: (change: CellChangeEvent) => void): () => void;
}

export interface ListTableOptions {
  /** 表格视口尺寸（CSS 像素） */
  width: number;
  height: number;
  columns: ColumnDefine[];
  /** records/columns 数组形态的数据 */
  records?: readonly DataRecord[];
  /** 行数兜底：无 records、模型也未给 rowCount 时（纯 hook 形态）使用 */
  rowCount?: number;
  /** 模型事件订阅形态的数据源 */
  model?: TableModel;
  /** 按格 hook，作用于取值管线末端，可与另两形态叠加 */
  resolveDisplayValue?: ResolveDisplayValue;
  rowHeight?: number;
  defaultColWidth?: number;
  /** 列头高度 */
  headerHeight?: number;
  /** 行号列宽度 */
  rowHeaderWidth?: number;
  /** 注入渲染宿主（测试/自定义管线）；缺省用 hostOptions 创建 */
  host?: RenderHost;
  /** 未注入 host 时创建 RenderHost 的参数（width/height 取上面的视口尺寸） */
  hostOptions?: Omit<RenderHostOptions, 'width' | 'height'>;
}
