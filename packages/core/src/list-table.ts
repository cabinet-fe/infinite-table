// ListTable 主类：布局计算、虚拟滚动窗口、行列头渲染，经 RenderHost 窄接口提交渲染。
// 场景内容只建在可视窗口内（窗口外行列不进入场景树）；
// 滚动由 ScrollManager 唯一状态源驱动，滚动 → 窗口重建 → band 失效登记的主循环。

import { createRenderHost, type LayerHandle, type RenderHost } from '@infinite-table/render';

import { TextCellNode } from './cell-node';
import { CellValuePipeline } from './cell-value';
import {
  computeColOffsets,
  computeColWindow,
  computeRowWindow,
  type WindowRange,
} from './grid-layout';
import { ModelBinding } from './model-binding';
import { ScrollManager, type ScrollState } from './scroll-manager';
import type { ListTableOptions } from './types';

const DEFAULT_ROW_HEIGHT = 32;
const DEFAULT_COL_WIDTH = 100;
const DEFAULT_HEADER_HEIGHT = 36;
const DEFAULT_ROW_HEADER_WIDTH = 48;
const HEADER_BACKGROUND = '#f5f6f7';
const CELL_BACKGROUND = '#ffffff';

/** 行号列/表头节点用 -1 标记非数据格坐标 */
const HEADER_COORD = -1;

export class ListTable {
  private readonly host: RenderHost;
  private readonly ownHost: boolean;
  private readonly body: LayerHandle;
  private readonly pipeline: CellValuePipeline;
  private readonly scroll = new ScrollManager();
  private readonly binding: ModelBinding | null = null;
  private readonly colOffsets: readonly number[];
  private readonly colWidths: readonly number[];
  private readonly width: number;
  private readonly height: number;
  private readonly rowHeight: number;
  private readonly headerHeight: number;
  private readonly rowHeaderWidth: number;
  /** 当前窗口内的数据格节点，key 为 `col:row`（随窗口重建） */
  private readonly cellNodes = new Map<string, TextCellNode>();
  private rows: WindowRange = { start: 0, end: 0 };
  private cols: WindowRange = { start: 0, end: 0 };
  private destroyed = false;

  constructor(private readonly options: ListTableOptions) {
    this.width = options.width;
    this.height = options.height;
    this.rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT;
    this.headerHeight = options.headerHeight ?? DEFAULT_HEADER_HEIGHT;
    this.rowHeaderWidth = options.rowHeaderWidth ?? DEFAULT_ROW_HEADER_WIDTH;
    const defaultColWidth = options.defaultColWidth ?? DEFAULT_COL_WIDTH;
    this.colWidths = options.columns.map((col) => col.width ?? defaultColWidth);
    this.colOffsets = computeColOffsets(this.colWidths);
    this.pipeline = new CellValuePipeline({
      columns: options.columns,
      records: options.records,
      model: options.model,
      resolveDisplayValue: options.resolveDisplayValue,
      rowCount: options.rowCount,
    });
    this.host =
      options.host ??
      createRenderHost({ width: this.width, height: this.height, ...options.hostOptions });
    this.ownHost = !options.host;
    this.body = this.host.createLayer({ kind: 'body' });
    this.scroll.setViewportSize(this.viewportWidth, this.viewportHeight);
    this.scroll.setContentSize(this.contentWidth, this.contentHeight);
    this.scroll.onScroll(() => this.onScroll());
    if (options.model) {
      this.binding = new ModelBinding(options.model, (change) =>
        this.refreshCell(change.col, change.row),
      );
      this.binding.attach();
    }
    this.rebuildScene();
    this.host.submitInvalidation('body', { type: 'full' });
  }

  getScrollState(): ScrollState {
    return this.scroll.state;
  }

  /** 当前可视窗口（[start, end) 行列区间） */
  getVisibleRange(): { rows: WindowRange; cols: WindowRange } {
    return { rows: this.rows, cols: this.cols };
  }

  scrollTo(left: number, top: number): void {
    this.scroll.scrollTo(left, top);
  }

  scrollBy(dx: number, dy: number): void {
    this.scroll.scrollBy(dx, dy);
  }

  /** 单元格最终显示文本（经取值管线，同步 O(1)） */
  getCellText(col: number, row: number): string {
    return this.pipeline.resolveText(col, row);
  }

  /** 表格回驱模型：模型 echo 由 ModelBinding 吞掉防回环，随后本格局部刷新一次 */
  updateCell(col: number, row: number, value: unknown): void {
    if (!this.binding) {
      return;
    }
    this.binding.writeBack(col, row, value);
    this.refreshCell(col, row);
  }

  /** 局部刷新单格：窗口内则更新节点文本并登记 cell 失效，窗口外忽略 */
  refreshCell(col: number, row: number): void {
    const node = this.cellNodes.get(`${col}:${row}`);
    if (!node) {
      return;
    }
    node.setText(this.pipeline.resolveText(col, row));
    this.host.submitInvalidation('body', { type: 'cell', region: node.getGlobalBounds() });
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.binding?.dispose();
    if (this.ownHost) {
      this.host.destroy();
    }
  }

  private get viewportWidth(): number {
    return Math.max(0, this.width - this.rowHeaderWidth);
  }

  private get viewportHeight(): number {
    return Math.max(0, this.height - this.headerHeight);
  }

  private get contentWidth(): number {
    return this.colOffsets[this.colOffsets.length - 1] ?? 0;
  }

  private get contentHeight(): number {
    return this.pipeline.rowCount * this.rowHeight;
  }

  /** 滚动主循环：状态源广播 → 窗口重建 → band 失效登记（滚动窗口滑动的典型产物） */
  private onScroll(): void {
    this.rebuildScene();
    this.host.submitInvalidation('body', {
      type: 'band',
      region: { x: 0, y: 0, width: this.width, height: this.height },
    });
  }

  /** 重建可视窗口场景：数据格在前、行列头在后（同层后画覆盖边缘半格） */
  private rebuildScene(): void {
    const root = this.body.root;
    while (root.children.length > 0) {
      root.removeChild(root.children[0]!);
    }
    this.cellNodes.clear();
    const { left, top } = this.scroll.state;
    const rows = computeRowWindow(top, this.viewportHeight, this.pipeline.rowCount, this.rowHeight);
    const cols = computeColWindow(left, this.viewportWidth, this.colOffsets);
    this.rows = rows;
    this.cols = cols;
    for (let row = rows.start; row < rows.end; row++) {
      const y = this.headerHeight + row * this.rowHeight - top;
      for (let col = cols.start; col < cols.end; col++) {
        const node = new TextCellNode({
          col,
          row,
          x: this.rowHeaderWidth + (this.colOffsets[col] ?? 0) - left,
          y,
          width: this.colWidths[col] ?? 0,
          height: this.rowHeight,
          text: this.pipeline.resolveText(col, row),
          background: CELL_BACKGROUND,
        });
        root.appendChild(node);
        this.cellNodes.set(`${col}:${row}`, node);
      }
    }
    this.appendHeaders(left, top, rows, cols);
  }

  /** 列头（随横向滚动）+ 行号列（随纵向滚动）+ 左上角，同层压在数据格之上 */
  private appendHeaders(left: number, top: number, rows: WindowRange, cols: WindowRange): void {
    const root = this.body.root;
    for (let col = cols.start; col < cols.end; col++) {
      root.appendChild(
        new TextCellNode({
          col,
          row: HEADER_COORD,
          x: this.rowHeaderWidth + (this.colOffsets[col] ?? 0) - left,
          y: 0,
          width: this.colWidths[col] ?? 0,
          height: this.headerHeight,
          text: this.options.columns[col]?.title ?? '',
          background: HEADER_BACKGROUND,
        }),
      );
    }
    for (let row = rows.start; row < rows.end; row++) {
      root.appendChild(
        new TextCellNode({
          col: HEADER_COORD,
          row,
          x: 0,
          y: this.headerHeight + row * this.rowHeight - top,
          width: this.rowHeaderWidth,
          height: this.rowHeight,
          text: String(row + 1),
          background: HEADER_BACKGROUND,
        }),
      );
    }
    root.appendChild(
      new TextCellNode({
        col: HEADER_COORD,
        row: HEADER_COORD,
        x: 0,
        y: 0,
        width: this.rowHeaderWidth,
        height: this.headerHeight,
        background: HEADER_BACKGROUND,
      }),
    );
  }
}
