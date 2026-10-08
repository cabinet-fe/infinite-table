// 数据供给三形态：records/columns 数组、按格 hook、模型事件订阅（含表格回驱防回环）。
// 模型区的改写按钮与取值状态行在本页驱动 mountDataForms 返回的句柄（shadcn 控件）。

import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { mountDataForms } from '../../sections/data-forms'
import { useDemoMount } from '../useDemoMount'

/** 模型取值状态行首帧占位：DemoModel 的 (1,1) 默认值与零变更快照，挂载后由模型校准 */
const MODEL_STATE_INITIAL = 'model(1,1) = M(1,1)；变更次数 0'

export function DataFormsPage() {
  const { containerRef, demo } = useDemoMount(mountDataForms)
  const [modelState, setModelState] = useState(MODEL_STATE_INITIAL)

  // 模型任何写入（外部改 / 表格回驱）都经 onCellChange，同步刷新状态行；挂载后先校准一次
  useEffect(() => {
    if (!demo) return
    const { model } = demo
    const showModelState = () => {
      setModelState(
        `model(1,1) = ${String(model.getCellValue(1, 1))}；变更次数 ${model.changeCount}`,
      )
    }
    showModelState()
    return model.onCellChange(showModelState)
  }, [demo])

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-xl font-semibold tracking-tight">数据供给三形态</h2>
          <Badge variant="secondary">Records 数组</Badge>
          <Badge variant="secondary">格级 Hook</Badge>
          <Badge variant="secondary">Model 事件驱动</Badge>
          <Badge variant="secondary">防回环机制</Badge>
        </div>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          演示三种核心数据供给方式：静态 records/columns 数组（5000 行）、按格 hook 纯函数同步 O(1)
          计算、以及响应式模型（TableModel）事件驱动局部刷新与回驱防回环机制。
        </p>
      </div>

      <div ref={containerRef} className="demo-mount-area" />

      <div className="rounded-xl border bg-card px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!demo}
              onClick={() => demo?.model.setCellValue(1, 1, `EXT-${demo.model.changeCount}`)}
            >
              模型外部改 (1,1)
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!demo}
              onClick={() =>
                demo?.modelMount.table.updateCell(1, 1, `WB-${demo.model.changeCount}`)
              }
            >
              表格回驱改 (1,1)
            </Button>
          </div>
          <span className="rounded-md border bg-muted/50 px-2.5 py-1 font-mono text-xs text-muted-foreground">
            {modelState}
          </span>
        </div>
      </div>
    </div>
  )
}
