// ListTable 主类：布局计算、虚拟滚动窗口、冻结区域划分、合并单元格、行列头渲染，
// 经 RenderHost 窄接口提交渲染。
// 场景内容只建在可视窗口内（窗口外行列不进入场景树，合并区主格按可见性补建）；
// 滚动由 ScrollManager 唯一状态源驱动，滚动 → 窗口重建 → 按滚动方向分层 band 失效
// （冻结区不随滚动重绘）。
// 交互（P5）：选区/hover/resize 指示线绘制在 sky 浮层（不触发 body 重绘），
// 键盘导航、触控惯性滚动、contextmenu 事件、onScrollFrame 帧级同步、批量更新合并失效。
// 图片（P7）：格内图片在 L2 media 层渲染（ImageService 窗口化加载 + cell 级位图 LRU +
// 无闪协议），浮动对象层挂 sky 层最顶、随滚动帧级跟随。

import {
  createRenderHost,
  type LayerHandle,
  type Region,
  type RenderHost,
  type SceneEvent,
} from '@infinite-table/render';

import { CellNode } from './cell-node';
import { MergeCellMap, rangeCrossesBoundary } from './cell-range';
import { projectCellStyle, type CellStyle } from './cell-style';
import { CellValuePipeline } from './cell-value';
import {
  clampFrozenCount,
  computeColOffsets,
  computeRowOffsets,
  computeScrollableColWindow,
  computeScrollableRowWindowFromOffsets,
  findColAt,
  findRowAt,
  resolveCellX,
  resolveCellYFromOffsets,
  unionRegions,
  type WindowRange,
} from './grid-layout';
import { HoverState } from './hover-state';
import { FloatObjectLayer } from './float/float-object-layer';
import { InteractionOverlay, type ResizeLine } from './interaction-overlay';
import { nextActiveCell, revealAxis } from './keyboard-navigation';
import { ImageCellNode } from './media/image-cell-node';
import { ImageService, type ImageLoadEvent, type LoadedImage } from './media/image-service';
import { MediaCache } from './media/media-cache';
import { ModelBinding } from './model-binding';
import type { TablePlugin } from './plugin';
import {
  hitResizeHandle,
  MIN_COL_WIDTH,
  MIN_ROW_HEIGHT,
  ResizeSession,
  type ResizeGeometry,
} from './resize';
import { ScrollManager, type ScrollDelta, type ScrollState } from './scroll-manager';
import { SelectionState, type SelectionListener, type SelectionSnapshot } from './selection';
import { extendsTheme, type TableTheme } from './theme';
import { InertiaScroller, TouchScrollTracker } from './touch-scroll';
import type {
  CellRef,
  ContextMenuListener,
  ListTableOptions,
  TableContextMenuEvent,
} from './types';

/** 行号列/表头节点用 -1 标记非数据格坐标 */
const HEADER_COORD = -1;

/** onScrollFrame 帧级同步回调：滚动帧上带最新滚动位置触发（同帧多次滚动只触发一次） */
export type ScrollFrameListener = (state: ScrollState) => void;

/** 图片加载窗口余量（px）：视口外扩，对齐 docs/perf-redesign 04 的 240 预挂值 */
const IMAGE_WINDOW_MARGIN = 240;

export class ListTable {
  private readonly host: RenderHost;
  private readonly ownHost: boolean;
  private readonly body: LayerHandle;
  private readonly sky: LayerHandle;
  private readonly pipeline: CellValuePipeline;
  private readonly scroll = new ScrollManager();
  private readonly binding: ModelBinding | null = null;
  private colOffsets: number[];
  private colWidths: number[];
  private readonly width: number;
  private readonly height: number;
  private readonly theme: TableTheme;
  private readonly rowHeight: number;
  private readonly headerHeight: number;
  private readonly rowHeaderWidth: number;
  private readonly frozenColCount: number;
  private readonly frozenRowCount: number;
  private frozenColsWidth: number;
  private frozenRowsHeight: number;
  private readonly mergeCells: MergeCellMap;
  /** 图片资源服务：窗口化加载 + 位图 LRU + 无闪协议状态源（public 供宿主配置/订阅事件） */
  readonly imageService: ImageService;
  /** cell 级位图 LRU：按格缓存已就绪位图引用，滚动重建时命中即首帧无闪 */
  private readonly mediaCache = new MediaCache<LoadedImage>();
  /** L2 media 层：首个图片格出现时惰性创建 */
  private media: LayerHandle | null = null;
  /** 当前窗口内的图片格节点，key 为 `col:row`（随窗口重建） */
  private readonly imageCellNodes = new Map<string, ImageCellNode>();
  /** 浮动对象层（首次访问 floatObjects 时惰性建承载容器，挂在已用的 sky 层最顶） */
  private floatLayer: FloatObjectLayer | null = null;
  /** 已注册插件（销毁时逆序卸载） */
  private readonly plugins: TablePlugin[] = [];
  /** 当前窗口内的数据格节点，key 为 `col:row`（合并区只登记主格，随窗口重建） */
  private readonly cellNodes = new Map<string, CellNode>();
  private rows: WindowRange = { start: 0, end: 0 };
  private cols: WindowRange = { start: 0, end: 0 };
  private destroyed = false;
  /** 逐行高度覆盖（行 resize 产物）；缺省用 rowHeight */
  private readonly rowHeights = new Map<number, number>();
  private rowOffsets: number[];
  private readonly selection = new SelectionState();
  private readonly hoverState = new HoverState();
  private readonly overlay: InteractionOverlay;
  private readonly touchTracker = new TouchScrollTracker();
  private readonly inertia: InertiaScroller;
  private resizeSession: ResizeSession | null = null;
  private resizeLine: ResizeLine | null = null;
  private selecting = false;
  private overlayHadContent = false;
  private batchDepth = 0;
  private readonly batchRegions: Region[] = [];
  private readonly contextMenuListeners = new Set<ContextMenuListener>();
  private readonly scrollFrameListeners = new Set<ScrollFrameListener>();
  /** 挂在场景根上的事件退订（注入 host 共享场景树时销毁必须解绑） */
  private readonly eventUnsubscribers: Array<() => void> = [];
  /** 稳定引用：同帧内多次滚动只收敛出一次 onScrollFrame 广播 */
  private readonly scrollFrameTask = () => {
    const state = this.scroll.state;
    for (const listener of this.scrollFrameListeners) {
      listener(state);
    }
  };

  constructor(private readonly options: ListTableOptions) {
    this.width = options.width;
    this.height = options.height;
    // 主题接入样式管线：几何与格样式默认取自主题，显式 options 优先
    this.theme = extendsTheme(options.theme);
    this.rowHeight = options.rowHeight ?? this.theme.rowHeight;
    this.headerHeight = options.headerHeight ?? this.theme.headerHeight;
    this.rowHeaderWidth = options.rowHeaderWidth ?? this.theme.rowHeaderWidth;
    const defaultColWidth = options.defaultColWidth ?? this.theme.defaultColWidth;
    this.colWidths = options.columns.map((col) => col.width ?? defaultColWidth);
    this.colOffsets = computeColOffsets(this.colWidths);
    this.pipeline = new CellValuePipeline({
      columns: options.columns,
      records: options.records,
      model: options.model,
      resolveDisplayValue: options.resolveDisplayValue,
      rowCount: options.rowCount,
    });
    this.rowOffsets = computeRowOffsets(this.pipeline.rowCount, this.rowHeight, this.rowHeights);
    // 冻结区域划分：冻结列固定于行号列右侧，冻结行固定于列头下侧
    this.frozenColCount = clampFrozenCount(options.frozenColCount ?? 0, options.columns.length);
    this.frozenRowCount = clampFrozenCount(options.frozenRowCount ?? 0, this.pipeline.rowCount);
    this.frozenColsWidth = this.colOffsets[this.frozenColCount] ?? 0;
    this.frozenRowsHeight = this.rowOffsets[this.frozenRowCount] ?? 0;
    this.mergeCells = new MergeCellMap(options.mergeCells);
    for (const range of this.mergeCells.ranges) {
      if (rangeCrossesBoundary(range, this.frozenColCount, this.frozenRowCount)) {
        throw new Error(
          `merge range [${range.startCol},${range.startRow} ~ ${range.endCol},${range.endRow}] ` +
            'crosses the frozen boundary',
        );
      }
    }
    this.host =
      options.host ??
      createRenderHost({ width: this.width, height: this.height, ...options.hostOptions });
    this.ownHost = !options.host;
    this.body = this.host.createLayer({ kind: 'body' });
    this.sky = this.host.createLayer({ kind: 'sky' });
    this.imageService = new ImageService(options.imageServiceOptions);
    // 图片加载完成 → 引用它的可见格定向失效（替代整层重绘，同帧多图由失效队列收敛合并）
    this.imageService.onImageLoad((e) => this.onImageServiceLoad(e));
    this.inertia = new InertiaScroller(
      (dx, dy) => this.scroll.scrollBy(dx, dy),
      (task) => this.host.requestFrame(task),
    );
    this.overlay = new InteractionOverlay(this.sky.root, {
      cellRect: (col, row) => this.cellRectInViewport(col, row),
      bodyViewport: {
        x: this.rowHeaderWidth,
        y: this.headerHeight,
        width: this.viewportWidth,
        height: this.viewportHeight,
      },
    });
    // 滚动位置定义在可滚动内容（总内容扣除冻结区）上
    this.scroll.setViewportSize(
      this.viewportWidth - this.frozenColsWidth,
      this.viewportHeight - this.frozenRowsHeight,
    );
    this.scroll.setContentSize(
      this.contentWidth - this.frozenColsWidth,
      this.contentHeight - this.frozenRowsHeight,
    );
    this.scroll.onScroll((_state, delta) => this.onScroll(delta));
    // 图片加载窗口先就位：首帧窗口外请求不发起
    this.updateImageWindow();
    if (options.model) {
      this.binding = new ModelBinding(options.model, (change) =>
        this.refreshCell(change.col, change.row),
      );
      this.binding.attach();
    }
    this.bindInteractionEvents();
    this.rebuildScene();
    this.host.submitInvalidation('body', { type: 'full' });
    for (const plugin of options.plugins ?? []) {
      this.use(plugin);
    }
  }

  /** 当前生效主题（基于默认主题 extends 派生） */
  getTheme(): TableTheme {
    return this.theme;
  }

  /** 插件统一注册路径：注册即挂载生效，销毁时逆序卸载 */
  use(plugin: TablePlugin): void {
    this.plugins.push(plugin);
    plugin.mount(this);
  }

  /**
   * 浮动对象层（格上图片/图表）：承载容器挂在 sky 层最顶（在选区/hover 浮层之上）。
   * 锚点经 resolveCellX/resolveCellYFromOffsets 换算层坐标（含冻结与滚动偏移），
   * 滚动时 syncPositions 帧级跟随。
   */
  get floatObjects(): FloatObjectLayer {
    if (!this.floatLayer) {
      this.floatLayer = new FloatObjectLayer({
        layer: this.sky,
        geometry: {
          cellOrigin: (col, row) => ({
            x: resolveCellX(
              col,
              this.scroll.state.left,
              this.colOffsets,
              this.frozenColCount,
              this.rowHeaderWidth,
            ),
            y: resolveCellYFromOffsets(
              row,
              this.scroll.state.top,
              this.rowOffsets,
              this.frozenRowCount,
              this.headerHeight,
            ),
          }),
          cellSize: (col, row) => ({ width: this.getColWidth(col), height: this.rowHeightAt(row) }),
        },
        imageService: this.imageService,
      });
    }
    return this.floatLayer;
  }

  getScrollState(): ScrollState {
    return this.scroll.state;
  }

  /** 当前可视窗口（[start, end) 行列区间，不含冻结区——冻结行列始终可见） */
  getVisibleRange(): { rows: WindowRange; cols: WindowRange } {
    return { rows: this.rows, cols: this.cols };
  }

  scrollTo(left: number, top: number): void {
    this.scroll.scrollTo(left, top);
  }

  scrollBy(dx: number, dy: number): void {
    this.scroll.scrollBy(dx, dy);
  }

  /** 单元格最终显示文本（经取值管线，同步 O(1)）；被合并覆盖的格取主格文本 */
  getCellText(col: number, row: number): string {
    const master = this.mergeCells.masterOf(col, row);
    return this.pipeline.resolveText(master?.col ?? col, master?.row ?? row);
  }

  /** 表格回驱模型：模型 echo 由 ModelBinding 吞掉防回环，随后本格局部刷新一次 */
  updateCell(col: number, row: number, value: unknown): void {
    if (!this.binding) {
      return;
    }
    this.binding.writeBack(col, row, value);
    this.refreshCell(col, row);
  }

  /**
   * 局部刷新单格：被合并覆盖的坐标路由到主格节点；窗口内则更新节点内容、
   * 重投影样式并登记 cell 失效（合并区失效为主格包围盒），窗口外忽略；
   * 批量更新（batchUpdate）期间失效区域改为收集，批末合并为一次 band 提交
   */
  refreshCell(col: number, row: number): void {
    const master = this.mergeCells.masterOf(col, row);
    const masterCol = master?.col ?? col;
    const masterRow = master?.row ?? row;
    this.refreshImageCell(masterCol, masterRow);
    const node = this.cellNodes.get(`${masterCol}:${masterRow}`);
    if (!node) {
      return;
    }
    node.setContent(
      this.pipeline.resolveText(masterCol, masterRow),
      this.pipeline.resolveValue(masterCol, masterRow),
    );
    node.style = this.resolveStyle(masterCol, masterRow);
    node.renderer = this.options.resolveCellRenderer?.(masterCol, masterRow) ?? null;
    const region = node.getGlobalBounds();
    if (this.batchDepth > 0) {
      this.batchRegions.push(region);
      return;
    }
    this.host.submitInvalidation('body', { type: 'cell', region });
  }

  /** 批量更新：fn 内的多次变更合并，结束时只提交一次 band 失效（一帧收敛一次渲染提交） */
  batchUpdate(fn: () => void): void {
    this.batchDepth++;
    try {
      fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0) {
        const region = unionRegions(this.batchRegions);
        this.batchRegions.length = 0;
        if (region) {
          this.host.submitInvalidation('body', { type: 'band', region });
        }
      }
    }
  }

  // ---- 选区（P5） ----

  getSelection(): SelectionSnapshot {
    return this.selection.snapshot;
  }

  /** 订阅选区变更；返回退订函数 */
  onSelectionChange(listener: SelectionListener): () => void {
    return this.selection.onChange(listener);
  }

  selectCell(col: number, row: number): void {
    this.selection.selectCell(col, row);
    this.ensureCellVisible(col, row);
  }

  selectRow(row: number): void {
    this.selection.selectRow(row, this.options.columns.length);
  }

  selectCol(col: number): void {
    this.selection.selectCol(col, this.pipeline.rowCount);
  }

  selectAll(): void {
    this.selection.selectAll(this.options.columns.length, this.pipeline.rowCount);
  }

  clearSelection(): void {
    this.selection.clear();
  }

  /** 外部模型回写选区：应用并刷新浮层但不广播，防回环 */
  applyExternalSelection(snapshot: SelectionSnapshot): void {
    this.selection.applyExternal(snapshot);
    this.refreshOverlay();
  }

  // ---- 行列 resize（P5，canResizeRow 能力见 ListTableOptions） ----

  getColWidth(col: number): number {
    return this.colWidths[col] ?? 0;
  }

  getRowHeight(row: number): number {
    return this.rowHeightAt(row);
  }

  setColWidth(col: number, width: number): void {
    if (col < 0 || col >= this.colWidths.length) {
      return;
    }
    this.colWidths[col] = Math.max(MIN_COL_WIDTH, width);
    this.colOffsets = computeColOffsets(this.colWidths);
    this.applyGeometryChange();
  }

  setRowHeight(row: number, height: number): void {
    if (row < 0 || row >= this.pipeline.rowCount) {
      return;
    }
    this.rowHeights.set(row, Math.max(MIN_ROW_HEIGHT, height));
    this.rowOffsets = computeRowOffsets(this.pipeline.rowCount, this.rowHeight, this.rowHeights);
    this.applyGeometryChange();
  }

  // ---- 事件（P5） ----

  /** 订阅 contextmenu 事件（右键菜单 UI 为非目标，仅保留事件）；返回退订函数 */
  onContextMenu(listener: ContextMenuListener): () => void {
    this.contextMenuListeners.add(listener);
    return () => this.contextMenuListeners.delete(listener);
  }

  /** 订阅 onScrollFrame 帧级同步：滚动发生的帧上带最新位置触发一次；返回退订函数 */
  onScrollFrame(listener: ScrollFrameListener): () => void {
    this.scrollFrameListeners.add(listener);
    return () => this.scrollFrameListeners.delete(listener);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.inertia.stop();
    for (const unsubscribe of this.eventUnsubscribers) {
      unsubscribe();
    }
    this.eventUnsubscribers.length = 0;
    for (let i = this.plugins.length - 1; i >= 0; i--) {
      this.plugins[i]?.unmount?.(this);
    }
    this.plugins.length = 0;
    this.binding?.dispose();
    this.floatLayer?.dispose();
    this.imageService.dispose();
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
    return this.rowOffsets[this.pipeline.rowCount] ?? 0;
  }

  private rowHeightAt(row: number): number {
    return (this.rowOffsets[row + 1] ?? 0) - (this.rowOffsets[row] ?? 0);
  }

  /** 数据格样式投影：主题 body token 为基础样式，resolveCellStyle hook 逐字段/逐边覆盖 */
  private resolveStyle(col: number, row: number): CellStyle {
    return projectCellStyle(this.theme.body, this.options.resolveCellStyle?.(col, row));
  }

  /**
   * 滚动主循环：状态源广播 → 窗口重建 → 按滚动方向分层 band 失效。
   * 纵向滚动只重绘冻结行以下的横带（含行号列/冻结列/滚动区），
   * 横向滚动只重绘冻结列以右的纵带（含列头/冻结行/滚动区），冻结角与对侧冻结区不重绘。
   */
  private onScroll(delta: ScrollDelta): void {
    this.rebuildScene();
    if (delta.dy !== 0) {
      const y = this.headerHeight + this.frozenRowsHeight;
      const band = { x: 0, y, width: this.width, height: Math.max(0, this.height - y) };
      this.host.submitInvalidation('body', { type: 'band', region: band });
      if (this.media) {
        this.host.submitInvalidation('media', { type: 'band', region: band });
      }
    }
    if (delta.dx !== 0) {
      const x = this.rowHeaderWidth + this.frozenColsWidth;
      const band = { x, y: 0, width: Math.max(0, this.width - x), height: this.height };
      this.host.submitInvalidation('body', { type: 'band', region: band });
      if (this.media) {
        this.host.submitInvalidation('media', { type: 'band', region: band });
      }
    }
    // 窗口化加载调度：划入窗口的请求提权、滚出的取消；浮动对象帧级跟随
    this.updateImageWindow();
    if (this.floatLayer && this.floatLayer.size > 0) {
      this.floatLayer.syncPositions();
    }
    this.refreshOverlay();
    if (this.scrollFrameListeners.size > 0) {
      this.host.requestFrame(this.scrollFrameTask);
    }
  }

  /** 重建可视窗口场景：数据格在前、行列头在后（同层后画覆盖边缘半格） */
  private rebuildScene(): void {
    const root = this.body.root;
    while (root.children.length > 0) {
      root.removeChild(root.children[0]!);
    }
    this.cellNodes.clear();
    if (this.media) {
      const mediaRoot = this.media.root;
      while (mediaRoot.children.length > 0) {
        mediaRoot.removeChild(mediaRoot.children[0]!);
      }
    }
    this.imageCellNodes.clear();
    const { left, top } = this.scroll.state;
    const scrollableRows = computeScrollableRowWindowFromOffsets(
      top,
      this.viewportHeight - this.frozenRowsHeight,
      this.rowOffsets,
      this.frozenRowCount,
    );
    const scrollableCols = computeScrollableColWindow(
      left,
      this.viewportWidth - this.frozenColsWidth,
      this.colOffsets,
      this.frozenColCount,
    );
    this.rows = scrollableRows;
    this.cols = scrollableCols;
    // 分层顺序：滚动区在最下，部分可见合并区同属滚动层，冻结条带居中，冻结角最上
    // （滚动内容滑到冻结区下方，由后画的冻结区覆盖）
    const frozenRows: WindowRange = { start: 0, end: this.frozenRowCount };
    const frozenCols: WindowRange = { start: 0, end: this.frozenColCount };
    this.appendCellBand(scrollableRows, scrollableCols, left, top);
    this.appendPartiallyVisibleMerges(
      left,
      top,
      [frozenRows, scrollableRows],
      [frozenCols, scrollableCols],
    );
    this.appendCellBand(scrollableRows, frozenCols, left, top);
    this.appendCellBand(frozenRows, scrollableCols, left, top);
    this.appendCellBand(frozenRows, frozenCols, left, top);
    this.appendHeaders(left, top, frozenRows, scrollableRows, frozenCols, scrollableCols);
  }

  /** 建一个行列带内的数据格节点 */
  private appendCellBand(rows: WindowRange, cols: WindowRange, left: number, top: number): void {
    for (let row = rows.start; row < rows.end; row++) {
      for (let col = cols.start; col < cols.end; col++) {
        this.appendCell(col, row, left, top);
      }
    }
  }

  /** 建单格节点：被合并覆盖的格不建节点（由主格统一取值/绘制/命中），主格跨域取完整尺寸 */
  private appendCell(col: number, row: number, left: number, top: number): void {
    const range = this.mergeCells.rangeAt(col, row);
    if (range && (range.startCol !== col || range.startRow !== row)) {
      return;
    }
    const endCol = range?.endCol ?? col;
    const endRow = range?.endRow ?? row;
    // 图片格：body 节点只画背景/边框（文本留空），图片内容在 L2 media 层渲染
    const imageUrl = this.options.resolveCellImage?.(col, row);
    const node = new CellNode({
      col,
      row,
      x: resolveCellX(col, left, this.colOffsets, this.frozenColCount, this.rowHeaderWidth),
      y: resolveCellYFromOffsets(row, top, this.rowOffsets, this.frozenRowCount, this.headerHeight),
      width: (this.colOffsets[endCol + 1] ?? 0) - (this.colOffsets[col] ?? 0),
      height: (this.rowOffsets[endRow + 1] ?? 0) - (this.rowOffsets[row] ?? 0),
      text: imageUrl ? '' : this.pipeline.resolveText(col, row),
      value: this.pipeline.resolveValue(col, row),
      cellType: this.options.columns[col]?.cellType,
      style: this.resolveStyle(col, row),
      renderer: this.options.resolveCellRenderer?.(col, row) ?? null,
    });
    this.body.root.appendChild(node);
    this.cellNodes.set(`${col}:${row}`, node);
    if (imageUrl) {
      this.appendImageCell(col, row, imageUrl, node.x, node.y, node.width, node.height);
    }
  }

  /** L2 media 层惰性创建（无图片格不建层） */
  private mediaLayer(): LayerHandle {
    if (!this.media) {
      this.media = this.host.createLayer({ kind: 'media' });
    }
    return this.media;
  }

  /**
   * 建图片格节点（media 层）。无闪协议：
   * cell 级 LRU 或 ImageService 已就绪 → 首帧直接画真实位图（无"先占位一帧再调整"）；
   * 未就绪 → 登记窗口化请求，placeholderDelay 内连占位都不画（防快速滚动占位闪烁），
   * 加载完成经 onImageServiceLoad 定向失效本格、单帧切换。
   */
  private appendImageCell(
    col: number,
    row: number,
    url: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const node = new ImageCellNode({
      col,
      row,
      x,
      y,
      width,
      height,
      url,
      placeholderAfter: Date.now() + this.imageService.placeholderDelay,
    });
    const cacheKey = this.imageCacheKey(col, row, width, height);
    const cached = this.mediaCache.get(cacheKey);
    const image = cached ?? this.imageService.getBitmap(url);
    if (image) {
      node.setBitmap(image);
      if (!cached) {
        this.mediaCache.put(cacheKey, image, Math.round(width * height * 4));
      }
    } else {
      this.imageService.request(url, { col, row });
    }
    this.mediaLayer().root.appendChild(node);
    this.imageCellNodes.set(`${col}:${row}`, node);
  }

  /** 图片格局部刷新：URL 变化则原位重建节点；URL 消失则摘除 media 节点 */
  private refreshImageCell(col: number, row: number): void {
    const node = this.imageCellNodes.get(`${col}:${row}`);
    if (!node || !this.media) {
      return;
    }
    const region = node.getGlobalBounds();
    const url = this.options.resolveCellImage?.(col, row);
    if (!url) {
      this.media.root.removeChild(node);
      this.imageCellNodes.delete(`${col}:${row}`);
    } else if (url !== node.url) {
      this.media.root.removeChild(node);
      this.imageCellNodes.delete(`${col}:${row}`);
      this.appendImageCell(col, row, url, node.x, node.y, node.width, node.height);
    }
    this.host.submitInvalidation('media', { type: 'cell', region });
  }

  /** 图片加载完成：位图写回引用它的可见格节点 + cell 级 LRU，并逐格定向失效 */
  private onImageServiceLoad(e: ImageLoadEvent): void {
    if (!this.media) {
      return;
    }
    const image = this.imageService.getBitmap(e.url);
    if (!image) {
      return;
    }
    for (const cell of e.cells) {
      const node = this.imageCellNodes.get(`${cell.col}:${cell.row}`);
      if (!node || node.url !== e.url) {
        continue;
      }
      node.setBitmap(image);
      this.mediaCache.put(
        this.imageCacheKey(cell.col, cell.row, node.width, node.height),
        image,
        Math.round(node.width * node.height * 4),
      );
      this.host.submitInvalidation('media', { type: 'cell', region: node.getGlobalBounds() });
    }
  }

  /**
   * 图片加载窗口 = 可视区域（冻结带 + 滚动窗口）外扩 240px 余量；
   * 随滚动调度：窗口内 idle 提权加载，滚出窗口的 loading 取消降级。
   */
  private updateImageWindow(): void {
    const { left, top } = this.scroll.state;
    const rows = computeScrollableRowWindowFromOffsets(
      Math.max(0, top - IMAGE_WINDOW_MARGIN),
      this.viewportHeight - this.frozenRowsHeight + IMAGE_WINDOW_MARGIN * 2,
      this.rowOffsets,
      this.frozenRowCount,
    );
    const cols = computeScrollableColWindow(
      Math.max(0, left - IMAGE_WINDOW_MARGIN),
      this.viewportWidth - this.frozenColsWidth + IMAGE_WINDOW_MARGIN * 2,
      this.colOffsets,
      this.frozenColCount,
    );
    this.imageService.updateWindow(
      (cell) =>
        (cell.row < this.frozenRowCount || (cell.row >= rows.start && cell.row < rows.end)) &&
        (cell.col < this.frozenColCount || (cell.col >= cols.start && cell.col < cols.end)),
    );
  }

  private imageCacheKey(col: number, row: number, width: number, height: number): string {
    return `image:${col}:${row}:${Math.round(width)}x${Math.round(height)}`;
  }

  /** 合并区主格落在窗口外但区间部分可见时补建主格节点（位置可越出视口，绘制由 cull 裁剪） */
  private appendPartiallyVisibleMerges(
    left: number,
    top: number,
    rowBands: readonly WindowRange[],
    colBands: readonly WindowRange[],
  ): void {
    const visible = (start: number, end: number, bands: readonly WindowRange[]): boolean =>
      bands.some((band) => start < band.end && end >= band.start);
    for (const range of this.mergeCells.ranges) {
      if (this.cellNodes.has(`${range.startCol}:${range.startRow}`)) {
        continue;
      }
      if (
        visible(range.startRow, range.endRow, rowBands) &&
        visible(range.startCol, range.endCol, colBands)
      ) {
        this.appendCell(range.startCol, range.startRow, left, top);
      }
    }
  }

  /** 列头（冻结列固定、其余随横向滚动）+ 行号列（冻结行固定、其余随纵向滚动）+ 左上角 */
  private appendHeaders(
    left: number,
    top: number,
    frozenRows: WindowRange,
    scrollableRows: WindowRange,
    frozenCols: WindowRange,
    scrollableCols: WindowRange,
  ): void {
    const root = this.body.root;
    const headerStyle: CellStyle = this.theme.header;
    // 滚动条带先画、冻结条带后画：滑动的行/列头被冻结头覆盖
    for (const cols of [scrollableCols, frozenCols]) {
      for (let col = cols.start; col < cols.end; col++) {
        root.appendChild(
          new CellNode({
            col,
            row: HEADER_COORD,
            x: resolveCellX(col, left, this.colOffsets, this.frozenColCount, this.rowHeaderWidth),
            y: 0,
            width: this.colWidths[col] ?? 0,
            height: this.headerHeight,
            text: this.options.columns[col]?.title ?? '',
            style: headerStyle,
          }),
        );
      }
    }
    for (const rows of [scrollableRows, frozenRows]) {
      for (let row = rows.start; row < rows.end; row++) {
        root.appendChild(
          new CellNode({
            col: HEADER_COORD,
            row,
            x: 0,
            y: resolveCellYFromOffsets(
              row,
              top,
              this.rowOffsets,
              this.frozenRowCount,
              this.headerHeight,
            ),
            width: this.rowHeaderWidth,
            height: this.rowHeightAt(row),
            text: String(row + 1),
            style: headerStyle,
          }),
        );
      }
    }
    root.appendChild(
      new CellNode({
        col: HEADER_COORD,
        row: HEADER_COORD,
        x: 0,
        y: 0,
        width: this.rowHeaderWidth,
        height: this.headerHeight,
        style: headerStyle,
      }),
    );
  }

  // ---- 交互接线（P5） ----

  /** 场景事件统一接线：指针/触摸在 body 根（sky 浮层不可拾取，事件穿透），键盘在最顶层根 */
  private bindInteractionEvents(): void {
    const bodyRoot = this.body.root;
    this.eventUnsubscribers.push(
      bodyRoot.on('pointerdown', (event) => this.onPointerDown(event)),
      bodyRoot.on('pointermove', (event) => this.onPointerMove(event)),
      bodyRoot.on('pointerup', (event) => this.onPointerUp(event)),
      bodyRoot.on('contextmenu', (event) => this.onContextMenuEvent(event)),
      bodyRoot.on('touchstart', (event) => this.onTouchStart(event)),
      bodyRoot.on('touchmove', (event) => this.onTouchMove(event)),
      bodyRoot.on('touchend', (event) => this.onTouchEnd(event)),
      bodyRoot.on('touchcancel', () => this.onTouchCancel()),
      this.sky.root.on('keydown', (event) => this.onKeyDown(event)),
      this.selection.onChange(() => this.refreshOverlay()),
      this.hoverState.onChange(() => this.refreshOverlay()),
    );
  }

  private onPointerDown(event: SceneEvent): void {
    const handle = hitResizeHandle(event.x, event.y, this.resizeGeometry(), {
      canResizeCol: this.options.canResizeCol,
      canResizeRow: this.options.canResizeRow,
    });
    if (handle) {
      const startSize =
        handle.kind === 'col' ? this.getColWidth(handle.index) : this.rowHeightAt(handle.index);
      this.resizeSession = new ResizeSession(
        handle,
        startSize,
        handle.kind === 'col' ? event.x : event.y,
      );
      return;
    }
    if (event.x < this.rowHeaderWidth && event.y < this.headerHeight) {
      // 左上角：全选
      this.selection.selectAll(this.options.columns.length, this.pipeline.rowCount);
      return;
    }
    if (event.y < this.headerHeight) {
      const col = findColAt(this.colOffsets, this.toContentX(event.x));
      if (col >= 0) {
        this.selection.selectCol(col, this.pipeline.rowCount);
      }
      return;
    }
    if (event.x < this.rowHeaderWidth) {
      const row = findRowAt(this.rowOffsets, this.toContentY(event.y));
      if (row >= 0) {
        this.selection.selectRow(row, this.options.columns.length);
      }
      return;
    }
    const cell = this.cellAt(event.x, event.y);
    if (cell) {
      this.selecting = true;
      this.selection.beginDrag(cell.col, cell.row);
    }
  }

  private onPointerMove(event: SceneEvent): void {
    if (this.resizeSession) {
      this.updateResizeLine(event);
      return;
    }
    const cell = this.cellAt(event.x, event.y);
    if (this.selecting) {
      if (cell) {
        this.selection.updateDrag(cell.col, cell.row);
        this.ensureCellVisible(cell.col, cell.row);
      }
      return;
    }
    if (cell) {
      this.hoverState.set(cell.col, cell.row);
    } else {
      this.hoverState.clear();
    }
  }

  private onPointerUp(event: SceneEvent): void {
    if (this.resizeSession) {
      const session = this.resizeSession;
      this.resizeSession = null;
      this.resizeLine = null;
      const pointer = session.target.kind === 'col' ? event.x : event.y;
      if (session.target.kind === 'col') {
        this.setColWidth(session.target.index, session.sizeAt(pointer));
      } else {
        this.setRowHeight(session.target.index, session.sizeAt(pointer));
      }
      return;
    }
    this.selecting = false;
    this.selection.endDrag();
  }

  /** resize 拖拽指示线跟手：目标边线随夹取后的尺寸位移，提交在 pointerup 一次生效 */
  private updateResizeLine(event: SceneEvent): void {
    const session = this.resizeSession;
    if (!session) {
      return;
    }
    const { left, top } = this.scroll.state;
    if (session.target.kind === 'col') {
      const index = session.target.index;
      const edge = resolveCellX(
        index + 1,
        left,
        this.colOffsets,
        this.frozenColCount,
        this.rowHeaderWidth,
      );
      const size = session.sizeAt(event.x);
      this.resizeLine = {
        orientation: 'vertical',
        position: edge + (size - this.getColWidth(index)),
      };
    } else {
      const index = session.target.index;
      const edge = resolveCellYFromOffsets(
        index + 1,
        top,
        this.rowOffsets,
        this.frozenRowCount,
        this.headerHeight,
      );
      const size = session.sizeAt(event.y);
      this.resizeLine = {
        orientation: 'horizontal',
        position: edge + (size - this.rowHeightAt(index)),
      };
    }
    this.refreshOverlay();
  }

  private onKeyDown(event: SceneEvent): void {
    const focus = this.selection.snapshot.focus;
    if (!focus || !event.key) {
      return;
    }
    const next = nextActiveCell(
      event.key,
      focus,
      this.options.columns.length,
      this.pipeline.rowCount,
      event.shiftKey,
    );
    if (!next) {
      return;
    }
    // shift+方向键扩展选区（焦点同步到扩展目标，sheet-core 选区修正补丁行为）；Tab 恒为单格移动
    const extend = event.shiftKey && event.key.startsWith('Arrow');
    this.selection.selectCell(next.col, next.row, extend);
    this.ensureCellVisible(next.col, next.row);
  }

  private onTouchStart(event: SceneEvent): void {
    this.inertia.stop();
    this.touchTracker.start(event.x, event.y, Date.now());
  }

  private onTouchMove(event: SceneEvent): void {
    const delta = this.touchTracker.move(event.x, event.y, Date.now());
    if (delta) {
      this.scroll.scrollBy(delta.dx, delta.dy);
    }
  }

  private onTouchEnd(event: SceneEvent): void {
    const velocity = this.touchTracker.end(event.x, event.y, Date.now());
    if (velocity) {
      this.inertia.start(velocity);
    }
  }

  private onTouchCancel(): void {
    this.touchTracker.cancel();
    this.inertia.stop();
  }

  private onContextMenuEvent(event: SceneEvent): void {
    if (this.contextMenuListeners.size === 0) {
      return;
    }
    const emitted: TableContextMenuEvent = {
      cell: this.cellAt(event.x, event.y),
      x: event.x,
      y: event.y,
      originalEvent: event.originalEvent,
    };
    for (const listener of this.contextMenuListeners) {
      listener(emitted);
    }
  }

  /** 视口坐标 → 内容坐标：冻结区内不滚动，冻结区外叠加滚动位置 */
  private toContentX(x: number): number {
    const rel = x - this.rowHeaderWidth;
    return rel < this.frozenColsWidth ? rel : rel + this.scroll.state.left;
  }

  private toContentY(y: number): number {
    const rel = y - this.headerHeight;
    return rel < this.frozenRowsHeight ? rel : rel + this.scroll.state.top;
  }

  /** 视口坐标命中的数据格；行列头/空白处返回 null */
  private cellAt(x: number, y: number): CellRef | null {
    if (x < this.rowHeaderWidth || y < this.headerHeight) {
      return null;
    }
    const col = findColAt(this.colOffsets, this.toContentX(x));
    const row = findRowAt(this.rowOffsets, this.toContentY(y));
    if (col < 0 || row < 0) {
      return null;
    }
    return { col, row };
  }

  /** 数据格在视口中的矩形；冻结行列恒可见，其余须在可视窗口内，否则返回 null */
  private cellRectInViewport(col: number, row: number): Region | null {
    const rowVisible = row < this.frozenRowCount || (row >= this.rows.start && row < this.rows.end);
    const colVisible = col < this.frozenColCount || (col >= this.cols.start && col < this.cols.end);
    if (!rowVisible || !colVisible) {
      return null;
    }
    const { left, top } = this.scroll.state;
    return {
      x: resolveCellX(col, left, this.colOffsets, this.frozenColCount, this.rowHeaderWidth),
      y: resolveCellYFromOffsets(row, top, this.rowOffsets, this.frozenRowCount, this.headerHeight),
      width: this.getColWidth(col),
      height: this.rowHeightAt(row),
    };
  }

  /** 滚动跟随：非冻结轴上让目标格完整进入视口（冻结轴恒可见，跳过） */
  private ensureCellVisible(col: number, row: number): void {
    const { left, top } = this.scroll.state;
    let nextLeft = left;
    let nextTop = top;
    if (col >= this.frozenColCount) {
      nextLeft = revealAxis(
        left,
        this.viewportWidth - this.frozenColsWidth,
        (this.colOffsets[col] ?? 0) - this.frozenColsWidth,
        this.getColWidth(col),
      );
    }
    if (row >= this.frozenRowCount) {
      nextTop = revealAxis(
        top,
        this.viewportHeight - this.frozenRowsHeight,
        (this.rowOffsets[row] ?? 0) - this.frozenRowsHeight,
        this.rowHeightAt(row),
      );
    }
    this.scroll.scrollTo(nextLeft, nextTop);
  }

  private resizeGeometry(): ResizeGeometry {
    return {
      colOffsets: this.colOffsets,
      rowOffsets: this.rowOffsets,
      rowHeaderWidth: this.rowHeaderWidth,
      headerHeight: this.headerHeight,
      toContentX: (x) => this.toContentX(x),
      toContentY: (y) => this.toContentY(y),
    };
  }

  /** 刷新 sky 浮层；仅在（或曾在）有内容时提交 sky 失效，避免空浮层空转整层重绘 */
  private refreshOverlay(): void {
    const has = this.overlay.update({
      selection: this.selection.snapshot,
      hover: this.hoverState.cell,
      resizeLine: this.resizeLine,
      // 冻结行列恒可见，裁剪窗口从 0 起并到滚动窗口末
      window: {
        rows: { start: 0, end: Math.max(this.rows.end, this.frozenRowCount) },
        cols: { start: 0, end: Math.max(this.cols.end, this.frozenColCount) },
      },
    });
    if (has || this.overlayHadContent) {
      this.host.submitInvalidation('sky', { type: 'full' });
    }
    this.overlayHadContent = has;
  }

  /** resize 提交后的几何变更：冻结区尺寸/滚动边界重算，全量重建一次 */
  private applyGeometryChange(): void {
    this.frozenColsWidth = this.colOffsets[this.frozenColCount] ?? 0;
    this.frozenRowsHeight = this.rowOffsets[this.frozenRowCount] ?? 0;
    this.scroll.setViewportSize(
      this.viewportWidth - this.frozenColsWidth,
      this.viewportHeight - this.frozenRowsHeight,
    );
    this.scroll.setContentSize(
      this.contentWidth - this.frozenColsWidth,
      this.contentHeight - this.frozenRowsHeight,
    );
    this.rebuildScene();
    this.host.submitInvalidation('body', { type: 'full' });
    if (this.media) {
      this.host.submitInvalidation('media', { type: 'full' });
    }
    this.updateImageWindow();
    if (this.floatLayer && this.floatLayer.size > 0) {
      this.floatLayer.syncPositions();
    }
    this.refreshOverlay();
  }
}
