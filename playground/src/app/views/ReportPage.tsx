// 报表式只读快照渲染（meta 迁移参考形态）：九字段快照灌入 SheetStore，readonly 渲染。

import { mountReport } from '../../sections/report'
import { SectionPage } from '../SectionPage'

export function ReportPage() {
  return (
    <SectionPage
      title="报表式只读快照渲染"
      tags={['九字段快照 restore', 'readonly 渲染', '行列头关闭', '浮动图随快照接线']}
      desc="报表快照（cells/styles/merges/frozen/rowHeights/colWidths/images/meta/selection）全量灌入 SheetStore，readonly 渲染：禁编辑、禁尺寸拖改、不接填充/撤销写路径；meta 迁移时照搬「快照 → restore → 只读渲染」三段。"
      mount={mountReport}
    />
  )
}
