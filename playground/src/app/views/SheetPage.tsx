// sheet 电子表格：工具栏/公式栏/tabs/右键菜单/toast/观察区为 React + shadcn 组件
// （app/views/sheet/**）；调试句柄 window.__SHEET_DEMO__ 随挂载写入、卸载回收。

import { useCallback, useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'

import { createSheetHandle, type SheetDemo } from '../../sections/sheet'
import { SheetWorkspace } from './sheet/SheetWorkspace'

export function SheetPage() {
  const [demo, setDemo] = useState<SheetDemo | null>(null)
  const onDemo = useCallback((next: SheetDemo | null) => {
    setDemo(next)
  }, [])

  useEffect(() => {
    if (!demo) {
      return
    }
    window.__SHEET_DEMO__ = createSheetHandle(demo)
    return () => {
      delete window.__SHEET_DEMO__
    }
  }, [demo])

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-xl font-semibold tracking-tight">sheet 电子表格</h2>
          {[
            '对标 ultra-ui playground sheet',
            '图标工具栏',
            '公式栏/函数建议',
            '底部 tabs',
            '三套右键菜单',
            '查找替换',
            'CSV 导入导出',
            '插入浮动图片',
            '数据结构观察区',
          ].map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          对标 ultra-ui playground 的 u-sheet 组件形态：工具栏（图标分组）→
          公式栏（名称框/fx/建议）→ 网格（#F5F5F5 表头 / #E1E4E8 网格线 / #2170E7 选区）→ 底部 sheet
          tabs；右键菜单三套（行号/列头/正文，含插入数量与冻结）、查找替换弹层、CSV
          导入导出、插入浮动图片、数据结构观察区（快照 JSON + 复制/放大）；消息走顶部
          toast。数据面为 sheet 插件族（SheetStore
          单一事实源/填充生成/选区同步/公式显示/键位预设/实例池/撤销栈）。
        </p>
      </div>
      <SheetWorkspace onDemo={onDemo} />
    </div>
  )
}
