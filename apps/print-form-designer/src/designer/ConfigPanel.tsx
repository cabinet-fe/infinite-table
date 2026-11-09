// 配置面板：单张侧栏卡内的四 tab（单元格 / 数据块 / 聚合 / 绑定）。
//
// 为什么合并：点一个绑定/函数格自动落到「单元格」，点数据块（列表项或画布手柄）落到
// 「数据块」，聚合是模板级配置常驻第三 tab——默认视图跟着当前动作走。
// 「绑定」tab 是模板级的绑定总账（BoundList）：点条目跳格选区，回联动落到「单元格」。
import type { CellAddress } from '@infinitable/sheet'

import { AggregationPanel } from './AggregationPanel'
import { BindingEditor } from './BindingEditor'
import type { FnPickState } from './cell-function-editor'
import { BoundList } from './BoundList'
import type { FormDoc } from './form-doc'
import { RegionPanel } from './RegionPanel'
import type { CellFnName, FormRegion } from './template'

export type ConfigTab = 'cell' | 'region' | 'agg' | 'bound'

interface ConfigPanelProps {
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

const TABS: { value: ConfigTab; label: string }[] = [
  { value: 'cell', label: '单元格' },
  { value: 'region', label: '数据块' },
  { value: 'agg', label: '聚合' },
  { value: 'bound', label: '绑定' },
]

export function ConfigPanel({
  doc,
  activeTab,
  onTabChange,
  regions,
  addr,
  onBindingEdited,
  fnPick,
  onFnPickStart,
  onFnPickCancel,
  activeRegionIndex,
  regionFocusIndex,
  openRegionIndex,
  onOpenRegionIndexChange,
  onSelectRegion,
  bindRevision,
}: ConfigPanelProps) {
  return (
    <div className="config-panel">
      <div className="config-tabs" role="tablist" aria-label="配置对象">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={tab.value === activeTab}
            aria-pressed={tab.value === activeTab}
            onClick={() => onTabChange(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 四个 tab 都常驻挂载（切换只显隐）：绑定面板的取数缓存与草稿不会因切 tab 丢失 */}
      <div className="config-body" role="tabpanel" hidden={activeTab !== 'cell'}>
        <BindingEditor
          doc={doc}
          addr={addr}
          onEdited={onBindingEdited}
          fnPick={fnPick}
          onFnPickStart={onFnPickStart}
          onFnPickCancel={onFnPickCancel}
        />
      </div>

      <div className="config-body" role="tabpanel" hidden={activeTab !== 'region'}>
        <RegionPanel
          doc={doc}
          regions={regions}
          activeIndex={activeRegionIndex}
          focusIndex={regionFocusIndex}
          openIndex={openRegionIndex}
          onOpenIndexChange={onOpenRegionIndexChange}
          onSelectRegion={onSelectRegion}
        />
      </div>

      <div className="config-body" role="tabpanel" hidden={activeTab !== 'agg'}>
        <AggregationPanel doc={doc} />
      </div>

      <div className="config-body" role="tabpanel" hidden={activeTab !== 'bound'}>
        <BoundList doc={doc} revision={bindRevision} />
      </div>
    </div>
  )
}
