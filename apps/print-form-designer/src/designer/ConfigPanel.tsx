// 配置面板：单张侧栏卡内的双 tab（单元格 / 区域）。
//
// 为什么合并：「区域」和「字段绑定」原来是两张卡，用户点一个绑定格时视线要往下滚过
// 一整片区域表单才看到绑定信息。现在点有绑定的格自动落到「单元格」tab，点区域列表项
// 自动落到「区域」tab——默认视图跟着当前动作走。
import { BindingEditor } from './BindingEditor'
import { BoundList } from './BoundList'
import type { FormDoc } from './form-doc'
import { RegionPanel } from './RegionPanel'
import type { FormRegion } from './template'
import type { CellAddress } from '@infinitable/sheet'

export type ConfigTab = 'cell' | 'region'

interface ConfigPanelProps {
  doc: FormDoc
  /** 当前活动控件 tab（受控；宿主按选区/点击自动切换） */
  activeTab: ConfigTab
  onTabChange: (tab: ConfigTab) => void
  /** 区域列表快照（doc.regions 的浅拷贝；region-change 后宿主刷新它触发重渲染） */
  regions: FormRegion[]
  /** 当前选区活动格（单元格 tab 的绑定目标） */
  addr: CellAddress | undefined
  /** 绑定写入/清除后回画布刷新占位符 */
  onBindingEdited: () => void
  /** 绑定 sidecar 重算信号（撤销、换模板都 +1） */
  bindRevision: number
  /** 当前选中区域下标（区域列表高亮） */
  activeRegionIndex: number | undefined
  /** 点区域列表项时回调（宿主用它把 tab 钉在「区域」） */
  onSelectRegion: (index: number) => void
}

const TABS: { value: ConfigTab; label: string }[] = [
  { value: 'cell', label: '单元格' },
  { value: 'region', label: '区域' },
]

export function ConfigPanel({
  doc,
  activeTab,
  onTabChange,
  regions,
  addr,
  onBindingEdited,
  bindRevision,
  activeRegionIndex,
  onSelectRegion,
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

      {/* 两个 tab 都常驻挂载（切换只显隐）：绑定面板的字段缓存与草稿不会因切 tab 丢失 */}
      <div className="config-body" role="tabpanel" hidden={activeTab !== 'cell'}>
        <BindingEditor doc={doc} addr={addr} onEdited={onBindingEdited} />
        <BoundList doc={doc} revision={bindRevision} />
      </div>

      <div className="config-body" role="tabpanel" hidden={activeTab !== 'region'}>
        <RegionPanel
          doc={doc}
          regions={regions}
          activeIndex={activeRegionIndex}
          onSelectRegion={onSelectRegion}
        />
      </div>
    </div>
  )
}
