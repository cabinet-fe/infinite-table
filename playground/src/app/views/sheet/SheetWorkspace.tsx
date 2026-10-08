// sheet 演示面装配（u-sheet 组件形态）：工具栏 → 公式栏 → 网格 → 底部 tabs + 数据观察区。
// 引擎装配经 sections/sheet 的 mountSheet 落入网格视口；全局快捷键（撤销/重做/查找）与
// 顶部 toast 在此接线；`__SHEET_DEMO__` 句柄由宿主页面（SheetPage / SmokeMode）写入。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

import { mountSheet, type SheetDemo, type SheetNotify } from '../../../sections/sheet'
import { FormulaBar } from './FormulaBar'
import { SheetContextMenu } from './SheetContextMenu'
import { SheetInspector } from './SheetInspector'
import { SheetTabs } from './SheetTabs'
import { SheetToolbar } from './SheetToolbar'
import { createSheetUiBridge } from './ui-bridge'

export function SheetWorkspace({ onDemo }: { onDemo?: (demo: SheetDemo | null) => void }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const ui = useMemo(() => createSheetUiBridge(), [])
  const [demo, setDemo] = useState<SheetDemo | null>(null)
  const notifyRef = useRef<SheetNotify>(() => {})
  const onDemoRef = useRef(onDemo)

  const notify = useCallback<SheetNotify>((text, kind = 'info') => {
    if (kind === 'warn') {
      toast.warning(text)
    } else {
      toast(text)
    }
  }, [])

  useEffect(() => {
    notifyRef.current = notify
    onDemoRef.current = onDemo
  }, [notify, onDemo])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const sheetDemo = mountSheet(viewport, {
      notify: (text, kind) => notifyRef.current(text, kind),
      // xlsx 导入重建 book 后的 UI 联动：引擎侧全表刷新在 mountSheet 内，这里驱动 React 面刷新
      onBookRebuilt: () => {
        ui.refreshToolbar()
        ui.refreshFormula()
      },
    })
    setDemo(sheetDemo)
    onDemoRef.current?.(sheetDemo)

    // ---- 全局快捷键（Ctrl/Cmd+Z 撤销、Shift+Z/Y 重做、F 查找；输入控件内与编辑会话中不接管撤销/重做） ----
    /** 撤销/重做接管条件：网格聚焦（焦点不在输入控件，见下方 target 过滤）且活跃表不在编辑会话 */
    const canUndoRedo = (): boolean => {
      const active = sheetDemo.getBundle().activeTable()
      return active != null && !active.isEditing()
    }
    const onKeydown = (event: KeyboardEvent): void => {
      if (!viewport.isConnected || !(event.ctrlKey || event.metaKey)) {
        return
      }
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, select')) {
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'f') {
        event.preventDefault()
        ui.toggleFind()
      } else if (key === 'z' && !event.shiftKey && canUndoRedo()) {
        event.preventDefault()
        sheetDemo.getSheet().undo()
        sheetDemo.notify('已撤销')
        ui.refreshToolbar()
        ui.refreshInspector()
      } else if ((key === 'z' || key === 'y') && canUndoRedo()) {
        event.preventDefault()
        sheetDemo.getSheet().redo()
        sheetDemo.notify('已重做')
        ui.refreshToolbar()
        ui.refreshInspector()
      }
    }
    document.addEventListener('keydown', onKeydown)

    return () => {
      document.removeEventListener('keydown', onKeydown)
      onDemoRef.current?.(null)
      sheetDemo.destroy()
      setDemo(null)
    }
  }, [ui])

  return (
    <TooltipProvider>
      <div className="flex flex-col">
        <div
          className="sheet-app flex flex-col overflow-hidden rounded-xl border bg-background shadow-sm"
          style={{ height: 'clamp(480px, calc(100vh - 300px), 760px)' }}
        >
          {/* 网格视口先于面板定形（引擎在挂载效应里量的是未挤压的整卡高度，
              面板随后收窄 CSS 视口——与命令式版「先建区后挂 UI」的测量口径一致） */}
          {demo && <SheetToolbar demo={demo} ui={ui} />}
          {demo && <FormulaBar demo={demo} ui={ui} />}
          <div
            className="sheet-viewport relative min-h-0 flex-1 overflow-hidden"
            ref={viewportRef}
          />
          {demo && <SheetTabs demo={demo} ui={ui} />}
          {demo && <SheetContextMenu demo={demo} />}
        </div>
        {demo && <SheetInspector demo={demo} ui={ui} />}
      </div>
      <Toaster position="top-center" />
    </TooltipProvider>
  )
}
