// sheet 电子表格：插件之上的完整 sheet 面；调试句柄 window.__SHEET_DEMO__ 随挂载写入、卸载回收。

import { createSheetHandle, mountSheet, type SheetDemo } from '../../sections/sheet'
import { SectionPage } from '../SectionPage'

/** 挂载并写调试句柄（控制台 / 自动化读取断言：活跃实例 + Store + UI 驱动面） */
function mountWithHandle(el: HTMLElement): SheetDemo {
  const demo = mountSheet(el)
  window.__SHEET_DEMO__ = createSheetHandle(demo)
  return demo
}

function unmountSheet(demo: SheetDemo): void {
  demo.destroy()
  delete window.__SHEET_DEMO__
}

export function SheetPage() {
  return (
    <SectionPage
      title="sheet 电子表格"
      tags={[
        '对标 ultra-ui playground sheet',
        '图标工具栏',
        '公式栏/函数建议',
        '底部 tabs',
        '三套右键菜单',
        '查找替换',
        'CSV 导入导出',
        '插入浮动图片',
        '数据结构观察区',
      ]}
      desc="对标 ultra-ui playground 的 u-sheet 组件形态：工具栏（图标分组）→ 公式栏（名称框/fx/建议）→ 网格（#F5F5F5 表头 / #E1E4E8 网格线 / #2170E7 选区）→ 底部 sheet tabs；右键菜单三套（行号/列头/正文，含插入数量与冻结）、查找替换弹层、CSV 导入导出、插入浮动图片、数据结构观察区（快照 JSON + 复制/放大）；消息走顶部 toast。数据面为 sheet 插件族（SheetStore 单一事实源/填充生成/选区同步/公式显示/键位预设/实例池/撤销栈）。"
      mount={mountWithHandle}
      unmount={unmountSheet}
      mountClassName="sheet-mount-area"
    />
  )
}
