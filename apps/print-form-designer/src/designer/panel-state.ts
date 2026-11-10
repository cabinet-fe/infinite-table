// 配置面板的宿主侧状态契约：ConfigPanel 所需的全部输入（doc 与表现层状态/回调）
// 收拢成一个聚合类型——宿主 DesignerPage 组装一份传入，面板解构后按原样下发给
// RegionPanel/BindingEditor 等子面板。纯类型分组，不引入 context/状态库，
// 数据流与渲染时机和原先逐 prop 转发完全一致。
// 单元格函数点选状态 FnPickState 的所有权也在此（宿主持有，画布提示条与面板同源消费）。
import type { CellAddress } from '@infinitable/sheet'

import type { FormDoc } from '../domain/form-doc'
import type { CellFnName, FormRegion } from '../shared/template-schema'

/** 配置面板的四个 tab（单元格 / 数据块 / 聚合 / 绑定；受控，宿主按当前动作自动落地） */
export type ConfigTab = 'cell' | 'region' | 'agg' | 'bound'

/** 点选参数格状态（DesignerPage 持有并落写入；画布提示条与本面板同源展示） */
export interface FnPickState {
  /** 待写入的函数 */
  fn: CellFnName
  /** 函数格（写入落点；点选期间选区会临时移到参数格上） */
  targetAddr: CellAddress
  /** 最近一次点选失败的中文原因（空 = 还没点错） */
  error: string
}

/** ConfigPanel 的聚合输入：原 15 个 props 的纯类型分组（字段含义注释随字段走） */
export interface DesignerPanelState {
  doc: FormDoc
  /** 当前活动控件 tab（受控；宿主按选区/点击自动切换） */
  activeTab: ConfigTab
  onTabChange: (tab: ConfigTab) => void
  /** 数据块列表快照（doc.regions 的浅拷贝；region-change 后宿主刷新它触发重渲染） */
  regions: FormRegion[]
  /** 当前选区活动格（单元格 tab 的绑定目标） */
  addr: CellAddress | undefined
  /** 绑定写入/清除后回画布刷新占位符 */
  onBindingEdited: () => void
  /** 单元格函数点选状态（宿主 DesignerPage 持有；画布提示条同源） */
  fnPick: FnPickState | null
  /** 选定函数 → 进入画布点选参数格 */
  onFnPickStart: (fn: CellFnName, targetAddr: CellAddress) => void
  /** 取消点选（Esc 与面板取消按钮共用） */
  onFnPickCancel: () => void
  /** 当前选中数据块下标（数据块列表高亮） */
  activeRegionIndex: number | undefined
  /** 宿主要聚焦的数据块下标（画布手柄点击/右键创建联动） */
  regionFocusIndex: number | undefined
  /** 数据块设置弹框受控下标（null = 关闭；右键创建数据块后自动打开） */
  openRegionIndex: number | null
  onOpenRegionIndexChange: (index: number | null) => void
  /** 点数据块列表项时回调（宿主用它把 tab 钉在「数据块」） */
  onSelectRegion: (index: number) => void
  /** 绑定总账的重算信号（宿主 bindRevision；绑定写入、撤销、换模板都 +1） */
  bindRevision: number
}
