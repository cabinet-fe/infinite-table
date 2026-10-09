// 底部 sheet tabs（对标 ultra-ui sheet-tabs，shadcn Tabs 承载）：激活白底蓝字、+ 新建、
// 右键菜单重命名/删除（删除走危险确认 Dialog）、溢出滚轮横滚、激活 tab 自动滚入视野。
// 表名由 Workbook 管理（重命名即模型改名，跨表引用随改名保持有效）；
// 切换/新建/删除后的联动刷新（公式栏重挂等）经 ui 桥回调。

import { Plus } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useReducer, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

import type { SheetDemo } from '../../../sections/sheet'
import type { SheetUiBridge } from './ui-bridge'

export function SheetTabs({ demo, ui }: { demo: SheetDemo; ui: SheetUiBridge }) {
  const [, bump] = useReducer((count: number) => count + 1, 0)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const bundle = demo.getBundle()
  const activeId = bundle.activeName()
  const ids = bundle.ids()

  const labelOf = useCallback((id: string): string => bundle.nameOf(id), [bundle])

  useEffect(() => {
    ui.labelOf = labelOf
    return () => {
      ui.labelOf = undefined
    }
  }, [labelOf, ui])

  // 外部切换（冒烟句柄 / xlsx 重建 / 删除联动）同样反映到 tabs
  useEffect(() => {
    const off = bundle.onBookChange(bump)
    return () => {
      off()
    }
  }, [bundle, bump])

  // 激活 tab 滚入视野（切换后居中）
  const idsKey = ids.join(',')
  useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('.sheet-tab[data-state="active"]')
    if (list && active) {
      const left = active.offsetLeft
      const right = left + active.offsetWidth
      if (left < list.scrollLeft || right > list.scrollLeft + list.clientWidth) {
        list.scrollTo({
          left: Math.max(0, left - (list.clientWidth - active.offsetWidth) / 2),
          behavior: 'smooth',
        })
      }
    }
  }, [activeId, idsKey, bump])

  // 溢出时滚轮转横滚
  useEffect(() => {
    const list = listRef.current
    if (!list) {
      return
    }
    const onWheel = (event: WheelEvent): void => {
      if (event.deltaY !== 0 && list.scrollWidth > list.clientWidth) {
        event.preventDefault()
        list.scrollLeft += event.deltaY
      }
    }
    list.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      list.removeEventListener('wheel', onWheel)
    }
  }, [])

  const afterSwitched = (): void => {
    ui.refreshFormula()
    ui.refreshToolbar()
  }

  const addSheet = (): void => {
    const id = bundle.createSheet()
    bundle.switchTo(id)
    bump()
    afterSwitched()
    demo.notify(`已新建 ${labelOf(id)}`)
  }

  const removeSheet = (id: string): void => {
    const name = labelOf(id)
    const current = bundle.ids()
    if (current.length <= 1) {
      demo.notify('至少保留一个工作表', 'warn')
      return
    }
    // 活跃表不可直接删：先切到相邻表
    if (id === bundle.activeName()) {
      const neighbor = current.find((other) => other !== id)!
      bundle.switchTo(neighbor)
    }
    if (bundle.removeSheet(id)) {
      bump()
      afterSwitched()
      demo.notify(`已删除 ${name}`)
    }
  }

  return (
    <div className="flex items-center gap-0.5 border-t border-border/70 bg-muted/40 px-1.5 py-1">
      <Tabs
        onValueChange={(id) => {
          if (id === bundle.activeName()) {
            return
          }
          bundle.switchTo(id)
          bump()
          afterSwitched()
        }}
        value={activeId ?? ''}
      >
        <TabsList
          className="h-7 max-w-full gap-0.5 overflow-x-auto rounded-none bg-transparent p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          ref={listRef}
          variant="line"
        >
          {ids.map((id) => (
            <TabsTrigger
              className={cn(
                'sheet-tab h-6 shrink-0 rounded-t-sm px-2.5 text-xs after:hidden',
                'data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm',
              )}
              key={id}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setTabMenu({ x: event.clientX, y: event.clientY, id })
              }}
              title="右键重命名 / 删除"
              value={id}
            >
              {renaming === id ? (
                <RenameInput
                  defaultValue={labelOf(id)}
                  onCancel={() => setRenaming(null)}
                  onCommit={(name) => {
                    setRenaming(null)
                    if (!name || name === labelOf(id)) {
                      return
                    }
                    // Workbook.renameSheet 校验空名/重名（跨表引用随改名保持有效）
                    if (!bundle.renameSheet(id, name)) {
                      demo.notify(`无法重命名：名称“${name}”无效或已被占用`, 'warn')
                      return
                    }
                    bump()
                    demo.notify(`已重命名为 ${name}`)
                  }}
                />
              ) : (
                labelOf(id)
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Button
        aria-label="添加工作表"
        className="size-6 shrink-0"
        onClick={addSheet}
        size="icon-xs"
        title="添加工作表"
        variant="ghost"
      >
        <Plus />
      </Button>

      {/* tab 右键菜单：重命名 / 删除 */}
      {tabMenu && (
        <Popover onOpenChange={(open) => !open && setTabMenu(null)} open>
          <PopoverAnchor asChild>
            <span
              aria-hidden="true"
              className="fixed size-0"
              style={{ left: tabMenu.x, top: tabMenu.y }}
            />
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-32 p-1"
            onOpenAutoFocus={(event) => event.preventDefault()}
            side="top"
            sideOffset={0}
          >
            <button
              className="sheet-menu__item block w-full cursor-pointer rounded-sm px-2.5 py-1 text-left text-xs hover:bg-accent"
              onClick={() => {
                setRenaming(tabMenu.id)
                setTabMenu(null)
              }}
              type="button"
            >
              重命名
            </button>
            <button
              className={cn(
                'sheet-menu__item block w-full rounded-sm px-2.5 py-1 text-left text-xs',
                ids.length <= 1
                  ? 'pointer-events-none text-muted-foreground/60'
                  : 'hover:bg-accent',
              )}
              disabled={ids.length <= 1}
              onClick={() => {
                setConfirmRemove(tabMenu.id)
                setTabMenu(null)
              }}
              type="button"
            >
              删除
            </button>
          </PopoverContent>
        </Popover>
      )}

      {/* 删除确认（危险操作不可恢复） */}
      <Dialog
        onOpenChange={(open) => !open && setConfirmRemove(null)}
        open={confirmRemove !== null}
      >
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>删除工作表</DialogTitle>
            <DialogDescription>
              确定删除工作表“{confirmRemove !== null ? labelOf(confirmRemove) : ''}
              ”吗？删除后不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmRemove(null)} size="sm" variant="outline">
              取消
            </Button>
            <Button
              onClick={() => {
                if (confirmRemove !== null) {
                  removeSheet(confirmRemove)
                }
                setConfirmRemove(null)
              }}
              size="sm"
              variant="destructive"
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** 行内重命名输入：Enter 提交、Esc 还原、失焦提交 */
function RenameInput({
  defaultValue,
  onCommit,
  onCancel,
}: {
  defaultValue: string
  onCommit: (name: string) => void
  onCancel: () => void
}): ReactNode {
  return (
    <input
      className="h-5 w-20 rounded-sm border border-primary bg-background px-1 text-xs outline-none"
      defaultValue={defaultValue}
      maxLength={31}
      onBlur={(event) => onCommit(event.target.value.trim())}
      onFocus={(event) => event.target.select()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          // 与命令式版一致：blur 前先还原输入值，失焦派发的 onCommit 因同名短路，防提交脏值
          event.currentTarget.value = defaultValue
          onCancel()
          event.currentTarget.blur()
        }
      }}
      onMouseDown={(event) => event.stopPropagation()}
      type="text"
    />
  )
}
