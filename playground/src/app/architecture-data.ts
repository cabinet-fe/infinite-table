// 架构页数据：子包分层、职责、公共 API 边界与依赖边的单一事实源。
// API 面为人工策展的关键出口（非穷举），值导出由 architecture-data.test.ts 对照各包
// 模块命名空间守卫——页面上出现的名字必须真实存在，防止展示与代码漂移。

export type ArchPackageKey =
  | 'render'
  | 'grid'
  | 'table'
  | 'pivot'
  | 'sheet'
  | 'plugins'
  | 'formulas'
  | 'infinitable'

export interface ArchApi {
  name: string
  /** value：运行时导出（守卫测试验证存在）；type：纯类型面 */
  kind: 'value' | 'type'
  desc: string
}

export interface ArchPackage {
  key: ArchPackageKey
  name: string
  /** 仓库内路径 */
  dir: string
  /** 一句话定位 */
  tagline: string
  /** 具体功能清单 */
  responsibilities: string[]
  /** 依赖的包（key 引用 ARCH_PACKAGES；箭头方向 = 本包 → 依赖） */
  dependsOn: ArchPackageKey[]
  /** 边界规则：耦合方式与禁止事项 */
  boundaries: string[]
  apis: ArchApi[]
}

/** 分层带（自上而下 = 依赖方向自上向下；协议缝独立渲染） */
export interface ArchLayer {
  key: 'publish' | 'domain' | 'engine' | 'kernel' | 'render'
  title: string
  desc: string
}

export const ARCH_LAYERS: readonly ArchLayer[] = [
  { key: 'publish', title: '发布层', desc: 'npm 单包出口，产物自包含' },
  { key: 'domain', title: '领域与插件层', desc: '平级领域引擎经装配协议接入，插件只认协议面' },
  { key: 'engine', title: '引擎层', desc: 'ListTable 表格引擎与装配协议实现' },
  { key: 'kernel', title: '内核层', desc: '跨引擎共享的网格机器' },
  { key: 'render', title: '渲染层', desc: 'canvas 渲染工具包，不含表格语义' },
]

/** 引擎装配协议缝：横切领域层与引擎层的公共装配路径（packages/table/src/engine.ts） */
export const ARCH_PROTOCOLS: readonly { name: string; desc: string }[] = [
  {
    name: 'EngineAssembly',
    desc: '中立装配本体：渲染宿主 + 数据面 + 主题 + painter/插件槽位 + 生命周期',
  },
  {
    name: 'TableEngine',
    desc: '表格领域公共操作增量（视口/滚动/冻结合并/选区/编辑），适配层消费不触具体类',
  },
  {
    name: 'TableModel',
    desc: '数据面形态：rowCount / getCellValue / updateCell 回驱 / onCellChange',
  },
  {
    name: 'RenderHost',
    desc: '渲染窄接口：层创建 / 失效提交 / 帧调度 / 文本测量（render 与 grid/table 的唯一耦合面）',
  },
]

export const ARCH_PACKAGES: readonly ArchPackage[] = [
  {
    key: 'render',
    name: '@infinitable/render',
    dir: 'packages/render',
    tagline: '通用 canvas 渲染工具包：场景树 / 分层 canvas / 失效登记 / 事件 / 池化',
    responsibilities: [
      '场景树（SceneNode）与内建图元节点：矩形 / 文本 / 路径 / 图片',
      '分层 canvas：多 region 失效（region / band / full 三档），各层消费策略建层参数化',
      'FrameScheduler 单帧收敛 + federated 事件系统（hitTest / SceneEvent）',
      'canvas 池化与路径原语；paintTree 支持宿主快照离屏重放',
    ],
    dependsOn: [],
    boundaries: [
      '不含任何表格语义（档名已去表格化）；表格概念全部在 grid 之上',
      '对上只经 RenderHost 窄接口被消费，不感知引擎与领域',
    ],
    apis: [
      {
        name: 'createRenderHost',
        kind: 'value',
        desc: '渲染宿主构造：分层画布 + 帧调度 + 失效提交 + 文本测量',
      },
      { name: 'SceneNode', kind: 'value', desc: '场景树节点基类（树组合 / 失效登记 / 事件冒泡）' },
      { name: 'paintTree', kind: 'value', desc: '场景树绘制（上屏与离屏快照共用）' },
      { name: 'hitTest', kind: 'value', desc: '场景树命中测试' },
      { name: 'RectNode', kind: 'value', desc: '矩形图元节点' },
      { name: 'TextNode', kind: 'value', desc: '文本图元节点' },
      { name: 'PathNode', kind: 'value', desc: '路径图元节点' },
      { name: 'ImageNode', kind: 'value', desc: '图片图元节点' },
      {
        name: 'union',
        kind: 'value',
        desc: 'Region 工具（与 ceil/clip/contains/equals/intersects/spread 同族）',
      },
      { name: 'RenderHost', kind: 'type', desc: '渲染宿主窄接口（引擎装配协议的渲染侧）' },
      { name: 'RenderContext', kind: 'type', desc: '渲染上下文（宿主画布 ctx 封装）' },
      { name: 'SceneEvent', kind: 'type', desc: 'federated 事件载荷' },
    ],
  },
  {
    key: 'grid',
    name: '@infinitable/grid',
    dir: 'packages/grid',
    tagline: '共享网格内核：滚动 / 虚拟窗口 / 几何命中 / 选区 / 主题投影',
    responsibilities: [
      'ScrollManager 唯一滚动源 + 触控惯性 + 画布内建滚动条（canvas 档 / native 原生档）',
      '行列前缀和 / 虚拟窗口 / 二分命中（grid-layout）',
      '共享边、cell-range 与合并区规范化（sanitizeMerges）',
      '选区状态机、float-object-layer 浮动对象层、主题投影（TableTheme token）',
    ],
    dependsOn: ['render'],
    boundaries: [
      '仅依赖 render 与 @cat-kit/core；被 table / sheet 复用，不感知 ListTable 领域',
      '与 render 只经 RenderHost 窄接口耦合；禁止具体渲染实现依赖（check-core-deps 守卫）',
    ],
    apis: [
      {
        name: 'normalizeCellRange',
        kind: 'value',
        desc: 'CellRange 规范化（负向跨度 / 越界钳制）',
      },
      {
        name: 'sanitizeMerges',
        kind: 'value',
        desc: '合并区重叠规范化（含 MergeCellMap / warnMergeConflicts）',
      },
      { name: 'normalizeRange', kind: 'value', desc: '选区 anchor/focus 规范化' },
      { name: 'extendsTheme', kind: 'value', desc: '主题深覆盖合并' },
      { name: 'CellRange', kind: 'type', desc: '合并区 / 命中的几何区间语言' },
      { name: 'CellRef', kind: 'type', desc: '格坐标' },
      { name: 'SelectionSnapshot', kind: 'type', desc: '选区快照（anchor + focus + ranges）' },
      { name: 'TableTheme', kind: 'type', desc: '主题分区 token（header / body / 交叉带…）' },
    ],
  },
  {
    key: 'table',
    name: '@infinitable/table',
    dir: 'packages/table',
    tagline: 'ListTable 表格引擎 + 引擎装配协议（EngineAssembly / TableEngine）',
    responsibilities: [
      'ListTable 主体与装配：可视窗口场景增量维护、溢出走廊、填充柄、表头装配',
      '取值三形态（records / 模型直挂 / rowCount+钩子）与按格 hook 链（显示值 / 样式 / 渲染器 / 图片 / 链接）',
      '编辑链路（EditorRegistry / SheetModel）、交互、图片与格内图表媒体',
      '引擎装配协议：中立 EngineAssembly + 表格领域面 TableEngine + 导出读取面 EngineReadView',
    ],
    dependsOn: ['grid', 'render'],
    boundaries: [
      '实现装配协议但不绑定宿主；协议本体不烧行号列 / 表头 / 合并等表格领域概念（G17 中立性）',
      '领域需求由 TableEngine 公共面增量承载，pivot / sheet 等适配层经协议面消费不触具体类',
      '禁止 @visactor/* 等具体渲染依赖（check-core-deps 守卫）',
    ],
    apis: [
      {
        name: 'ListTable',
        kind: 'value',
        desc: '表格引擎主体（EngineAssembly / TableEngine 的 table 实现）',
      },
      { name: 'SheetModel', kind: 'value', desc: '可回写数据模型（模型直挂供数形态）' },
      { name: 'EditorRegistry', kind: 'value', desc: '编辑器注册表（格级路由）' },
      {
        name: 'projectCellStyle',
        kind: 'value',
        desc: '主题分区 token → 列级 → 按格 hook 的样式投影链',
      },
      {
        name: 'EngineAssembly',
        kind: 'type',
        desc: '中立装配协议本体（四类平级引擎的公共装配路径）',
      },
      { name: 'TableEngine', kind: 'type', desc: '表格领域公共操作面（适配层消费窄接口）' },
      { name: 'EngineReadView', kind: 'type', desc: '导出读取面：有效数据 / 样式 / 几何 / 合并区' },
      { name: 'TableModel', kind: 'type', desc: '数据面形态（模型直挂 / 异步窗口取数兼容）' },
      {
        name: 'TablePlugin',
        kind: 'type',
        desc: '插件契约：mount 只收 EngineAssembly（G2/G21 不绑事件类型）',
      },
      {
        name: 'ListTableOptions',
        kind: 'type',
        desc: '构造装配面（含 resolveCellRenderer 等按格 hook 缝）',
      },
      {
        name: 'ColumnDefine',
        kind: 'type',
        desc: '列定义（field / title / width / cellType / editor / style）',
      },
      { name: 'CellStyle', kind: 'type', desc: '格样式（边框逐边独立 / 文本对齐溢出 / 字体）' },
      {
        name: 'CellRenderer',
        kind: 'type',
        desc: '自定义格渲染器（resolveCellRenderer 返回即接管内容绘制）',
      },
    ],
  },
  {
    key: 'pivot',
    name: '@infinitable/pivot',
    dir: 'packages/pivot',
    tagline: '透视表领域引擎：行维度树 × 列维度树 × 度量交叉聚合（装配协议参考实现）',
    responsibilities: [
      'PivotGrid：内部 new ListTable 以 TableEngine 持有，对外转发 EngineAssembly——协议插件跨引擎挂载',
      '多列树形行头：每行维度一列，同组跨行合并（setMergeCells），点击组格左缘展开图标折叠（collapsible 可配置为始终平铺），点击组格其余区域选区覆盖该组全部维度数据，双击数值格下钻明细',
      '多级表头：列维度逐层 + 度量行，以引擎冻结行 + 横向合并落地（引擎自带列头关闭，表头区行维度列按维度分列）',
      'PivotModel：维度树展开 × 列维度树 × 度量聚合矩阵（TableModel 数据面展平，引擎坐标含表头行偏移；组可见行块 groupRange 供选区几何）',
      '行/列维度与度量运行时勾选、排序、聚合方式切换；结构 setColCount/setFrozenRowCount/setMergeCells 原地落地不重建实例',
    ],
    dependsOn: ['table'],
    boundaries: [
      '平级领域引擎经装配协议接入 table 引擎——多引擎架构的公共装配路径证明（P7）',
      '只读引擎：交叉格为聚合值，编辑面整体关闭；渲染/滚动/选区全走 table 引擎原语',
    ],
    apis: [
      {
        name: 'PivotGrid',
        kind: 'value',
        desc: '透视表领域引擎（EngineAssembly 转发面 + 树交互 / 明细下钻 API）',
      },
      {
        name: 'PivotModel',
        kind: 'value',
        desc: '聚合模型：行维度树 × 列维度树 × 度量 → 展平行序列与聚合矩阵',
      },
      { name: 'PIVOT_ROW_HEIGHT', kind: 'value', desc: '数据行高（引擎构造缺省；表头冻结行同高）' },
      { name: 'PIVOT_HEADER_BACKGROUND', kind: 'value', desc: '多级表头行底色（像素断言锚点）' },
      { name: 'PIVOT_SUBTOTAL_BACKGROUND', kind: 'value', desc: '折叠载体行底色（像素断言锚点）' },
      { name: 'PIVOT_GRAND_BACKGROUND', kind: 'value', desc: '总计行底色（像素断言锚点）' },
      {
        name: 'PivotDimension',
        kind: 'type',
        desc: '维度（行/列挂载的分组字段；序列顺序即树层级/表头层级序）',
      },
      { name: 'PivotMeasure', kind: 'type', desc: '度量（五类聚合器；同字段可挂多个度量）' },
      {
        name: 'PivotRow',
        kind: 'type',
        desc: '展平行：leaf / branch（折叠载体）/ grand + 树深度与展开态',
      },
      {
        name: 'PivotCellDrillEvent',
        kind: 'type',
        desc: '双击下钻事件（携带该格聚合覆盖的原始记录）',
      },
    ],
  },
  {
    key: 'sheet',
    name: '@infinitable/sheet',
    dir: 'packages/sheet',
    tagline: '电子表格核心：sheet 模型 / 命令 / 公式接线 / IO / SheetGrid 适配',
    responsibilities: [
      'Sheet 模型与命令层：格存 / 样式池 / 合并 / 选区 / 填充 / 查找',
      'FormulaEngine 适配层：依赖图标脏 + formulas 逐格求值（图簿联动 / 改名别名 / 易失编排）',
      'IO：xlsx / csv 导出（hucre）',
      'SheetGrid：经引擎装配协议消费 table 引擎的电子表格适配',
    ],
    dependsOn: ['table', 'grid', 'formulas'],
    boundaries: [
      'formulas 与 grid/table 互不依赖——求值接线在宿主侧（本包 FormulaEngine 适配层）',
      '循环护栏在适配层：#CYCLE! 由 FormulaEngine 递归护栏产出，formulas 内无第二套图 / 求值',
    ],
    apis: [
      { name: 'Sheet', kind: 'value', desc: 'sheet 模型主体（快照 / 冻结 / 事件）' },
      {
        name: 'FormulaEngine',
        kind: 'value',
        desc: '公式接线适配层（依赖图 / 求值编排 / 循环护栏）',
      },
      { name: 'SheetGrid', kind: 'value', desc: '电子表格网格（经装配协议消费 table 引擎）' },
      { name: 'SelectionModel', kind: 'value', desc: '选区模型' },
      { name: 'StylePool', kind: 'value', desc: '样式池（style 引用去重）' },
      { name: 'CellMetaStore', kind: 'value', desc: '格元数据存储' },
      { name: 'composeCellStyles', kind: 'value', desc: '样式合成' },
      { name: 'exportSheetXlsx', kind: 'value', desc: '单表 xlsx 导出' },
      { name: 'exportWorkbookXlsx', kind: 'value', desc: '工作簿 xlsx 导出' },
      { name: 'TypedEventEmitter', kind: 'value', desc: '类型化事件发射器' },
    ],
  },
  {
    key: 'formulas',
    name: '@infinitable/formulas',
    dir: 'packages/formulas',
    tagline: '公式引擎：tokenizer / Pratt parser / 求值 / 依赖图（独立侧包）',
    responsibilities: [
      '地址与错误码、tokenizer、Pratt parser、AST',
      'evaluate 求值器 + 49 内置函数注册表',
      '依赖图（DependencyGraph）与静态引用扫描（ast-refs / scan-refs）',
      '公式平移（shift / 引用重写）',
    ],
    dependsOn: [],
    boundaries: [
      '与 grid / table 互不依赖（@cat-kit/core 除外）；求值接线由宿主（sheet FormulaEngine）驱动',
      '边界：无数组公式；循环检测由宿主护栏承担',
    ],
    apis: [
      { name: 'parseFormula', kind: 'value', desc: '公式解析（Pratt parser → AST）' },
      { name: 'evaluate', kind: 'value', desc: 'AST 求值（经 FormulaResolver 取格值）' },
      { name: 'DependencyGraph', kind: 'value', desc: '依赖图（引用边 / 标脏）' },
      { name: 'scanFormulaReferences', kind: 'value', desc: '编辑中容错引用扫描' },
      { name: 'shiftFormulaText', kind: 'value', desc: '公式文本平移（插入删除行列的引用重写）' },
      { name: 'isFormulaError', kind: 'value', desc: '错误值判定（#REF! 等）' },
      { name: 'AstNode', kind: 'type', desc: 'AST 节点' },
      { name: 'FormulaResolver', kind: 'type', desc: '宿主取格值接口（求值接线缝）' },
    ],
  },
  {
    key: 'plugins',
    name: '@infinitable/plugins',
    dir: 'packages/plugins',
    tagline: '官方插件：chart / print / watermark（TablePlugin 契约）',
    responsibilities: [
      'chart：声明解析 + Chart.js 按需加载 + 离屏出图（构建断言守 chart.js 不进主产物）',
      'print：headless 分页引擎（fitpage / fixrows）+ 页面 HTML 构建 + iframe 打印与 DOM 预览',
      'watermark：文字平铺水印，经引擎装配协议 overlay 绘制槽位挂载（锚定视口）',
    ],
    dependsOn: ['table', 'grid'],
    boundaries: [
      'print / watermark 面向引擎装配协议槽位挂载，不再以 ListTable 具体类型为挂载参数',
      '接口面红线见 docs/plugin-interface-map.md',
    ],
    apis: [
      {
        name: 'createChartPlugin',
        kind: 'value',
        desc: '格内图表插件工厂（离屏出图 → chartMediaResolver 注入）',
      },
      { name: 'createPrintPlugin', kind: 'value', desc: '打印插件工厂（分页 + 输出 + 预览）' },
      {
        name: 'createWatermarkPlugin',
        kind: 'value',
        desc: '水印插件工厂（overlay 槽位，锚定视口）',
      },
      {
        name: 'createEnginePrintSource',
        kind: 'value',
        desc: 'PrintSource 抽象的引擎供数实现（读 EngineReadView）',
      },
      { name: 'WatermarkHandle', kind: 'type', desc: '水印句柄（updateConfig 即时生效）' },
      { name: 'PrintPluginHandle', kind: 'type', desc: '打印句柄' },
    ],
  },
  {
    key: 'infinitable',
    name: 'infinitable',
    dir: 'packages/infinitable',
    tagline: '统一 npm 发布包：主入口转售五层公共 API + ./sheet 子路径',
    responsibilities: [
      '主入口显式 re-export render / grid / table / formulas / plugins 公共面（禁止 export *）',
      './sheet 子路径转售 sheet 完整面',
      'vp build 整体自包含 dist（chart 动态分包、@cat-kit/core 外部化）；build-types 装配类型树',
    ],
    dependsOn: ['render', 'grid', 'table', 'formulas', 'plugins', 'sheet'],
    boundaries: [
      '依赖只出现在 devDependencies（workspace:*，仅构建期），产物自包含不再依赖 @infinitable/*',
      '发版统一走 .agents/skills/release（changesets + CI）',
    ],
    apis: [
      { name: 'ListTable', kind: 'value', desc: '表格引擎（转售 @infinitable/table）' },
      { name: 'createRenderHost', kind: 'value', desc: '渲染宿主构造（转售 @infinitable/render）' },
      { name: 'SheetModel', kind: 'value', desc: '可回写数据模型' },
      { name: 'EditorRegistry', kind: 'value', desc: '编辑器注册表' },
      { name: 'projectCellStyle', kind: 'value', desc: '样式投影链' },
      { name: 'SceneNode', kind: 'value', desc: '场景树节点（转售）' },
    ],
  },
]

export function findArchPackage(key: ArchPackageKey): ArchPackage {
  const found = ARCH_PACKAGES.find((pkg) => pkg.key === key)
  if (!found) {
    throw new Error(`未知架构包 key：${key}`)
  }
  return found
}
