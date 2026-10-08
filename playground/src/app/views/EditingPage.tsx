// 单元格编辑：SheetModel 内存模型、双击/键盘编辑、滚动浮层跟随、滚出视口自动提交。
// 编程式 API 按钮与提交状态行为 shadcn 组件，经 EditingDemo.api 共享实现驱动引擎。

import { useCallback, useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { formatCommitStatus, mountEditing, type EditingDemo } from '../../sections/editing'
import { SectionPage } from '../SectionPage'

/** 演示控制面板：编程式 API 三按钮 + 提交状态行（onCellChange 实时刷新） */
function EditingControls({ demo }: { demo: EditingDemo }) {
  const [status, setStatus] = useState('尚未提交')

  useEffect(
    () => demo.mount.table.onCellChange((change) => setStatus(formatCommitStatus(change))),
    [demo],
  )

  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          variant="outline"
          size="sm"
          className="font-mono"
          onClick={() => setStatus(demo.api.startEdit())}
        >
          startEdit(0, 3)
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="font-mono"
          onClick={() => {
            const text = demo.api.commitEdit()
            if (text !== null) {
              setStatus(text)
            }
          }}
        >
          commitEdit()
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="font-mono"
          onClick={() => setStatus(demo.api.cancelEdit())}
        >
          cancelEdit()
        </Button>
        <Separator orientation="vertical" className="h-5" />
        <Badge variant="secondary" className="max-w-full whitespace-normal font-normal">
          {status}
        </Badge>
      </div>
    </div>
  )
}

export function EditingPage() {
  const [demo, setDemo] = useState<EditingDemo | null>(null)
  // 包装为引用稳定回调：SectionPage 的挂载 effect 依赖 mount 引用，只跑一次
  const mount = useCallback((root: HTMLElement): EditingDemo => {
    const mounted = mountEditing(root)
    setDemo(mounted)
    return mounted
  }, [])

  return (
    <div className="flex flex-col gap-4">
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
        mount={mount}
      />
      {demo ? <EditingControls demo={demo} /> : null}
    </div>
  )
}
