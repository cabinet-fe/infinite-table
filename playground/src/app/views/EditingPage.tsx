// 单元格编辑：SheetModel 内存模型、双击/键盘编辑、滚动浮层跟随、滚出视口自动提交。

import { mountEditing } from '../../sections/editing'
import { SectionPage } from '../SectionPage'

export function EditingPage() {
  return (
    <SectionPage
      title="单元格编辑"
      tags={[
        'SheetModel 内存模型',
        '双击编辑',
        '键盘流（Enter/Tab/Esc）',
        '滚动浮层跟随',
        '格级禁编规则',
        '编程式 API',
      ]}
      desc="单元格编辑完整闭环：双击任意单元格呼出原生浮层编辑器；支持 Enter 提交并下移、Tab 提交并右移、Esc 取消；编辑过程中滚动表格，浮层动态精准跟随锚定单元格，滚出视口自动提交；对照展示：格 (0,2) 细粒度禁编，纯展示列不响应编辑。"
      mount={mountEditing}
    />
  )
}
