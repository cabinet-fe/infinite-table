// 配置面板：单张侧栏卡内的四 tab（单元格 / 数据块 / 聚合 / 绑定）。
//
// 为什么合并：点一个绑定/函数格自动落到「单元格」，点数据块（列表项或画布手柄）落到
// 「数据块」，聚合是模板级配置常驻第三 tab——默认视图跟着当前动作走。
// 「绑定」tab 是模板级的绑定总账（BoundList）：点条目跳格选区，回联动落到「单元格」。
import { AggregationPanel } from './AggregationPanel'
import { BindingEditor } from './BindingEditor'
import { BoundList } from './BoundList'
import type { ConfigTab, DesignerPanelState } from './panel-state'
import { RegionPanel } from './RegionPanel'

const TABS: { value: ConfigTab; label: string }[] = [
  { value: 'cell', label: '单元格' },
  { value: 'region', label: '数据块' },
  { value: 'agg', label: '聚合' },
  { value: 'bound', label: '绑定' },
]

/** 输入收拢为单个聚合状态（DesignerPanelState，见 panel-state.ts），解构后按原样下发子面板 */
export function ConfigPanel({ state }: { state: DesignerPanelState }) {
  const {
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
  } = state
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
