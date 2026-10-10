// 打印预览与输出：headless 打印内核 + shadcn Dialog 预览（缩略页列表 + 当前页放大 + 打印按钮）。
// 参数面板改动即时合成 PrintConfig；预览/打印逐次传入插件方法，打印经缺省链路
// 调起浏览器打印对话框（隐藏 iframe 只装载报表内容）。

import { Printer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type {
  PrintConfig,
  PrintOrientation,
  PrintPaperPreset,
  PrintPagingMode,
  PrintPluginHandle,
  PrintScaleMode,
} from '@infinitable/plugins'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { mountPrint, PRINT_HEADER_ROWS, type PrintDemo } from '../../sections/print'

/** 打印参数（面板当前值；打开预览/打印时合成 PrintConfig） */
interface PrintSettings {
  paper: PrintPaperPreset
  orientation: PrintOrientation
  scale: PrintScaleMode
  paging: PrintPagingMode
  fixRows: number
}

const DEFAULT_SETTINGS: PrintSettings = {
  paper: 'A4',
  orientation: 'portrait',
  scale: 'origin',
  paging: 'fitpage',
  fixRows: 12,
}

/** fixrows 行数合法区间（总行数含重复表头；非法值在合成配置时夹取） */
const FIX_ROWS_MIN = PRINT_HEADER_ROWS + 1
const FIX_ROWS_MAX = 40

/** 纸张预设 mm 尺寸（portrait 口径，landscape 交换宽高；预览纸张容器的显示用换算） */
const PAPER_MM: Record<PrintPaperPreset, [number, number]> = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  Letter: [216, 279],
}

const MM_TO_PX = 96 / 25.4

/** 纸张标注（状态行显示用；预设代号或自定义 mm 尺寸） */
function paperLabel(paper: PrintConfig['paperSize']): string {
  if (paper === undefined) {
    return 'A4'
  }
  return typeof paper === 'object' ? `自定义 ${paper.widthMm}×${paper.heightMm}mm` : paper
}

/** 面板当前值 → 完整打印配置（每次打开预览/打印时合成，逐次传入插件方法） */
function buildPrintConfig(settings: PrintSettings): PrintConfig {
  return {
    paperSize: settings.paper,
    orientation: settings.orientation,
    scale: settings.scale,
    paging: settings.paging,
    fixRows:
      settings.paging === 'fixrows'
        ? Math.min(FIX_ROWS_MAX, Math.max(FIX_ROWS_MIN, Math.trunc(settings.fixRows)))
        : undefined,
    headerRepeatRows: PRINT_HEADER_ROWS,
    headerFooter: {
      header: { left: '{title}', right: '{date} {time}' },
      footer: { left: '本页小计 {pageSum:4}', center: '第 {page} 页 / 共 {pageCount} 页' },
    },
  }
}

/** 预览产物：分页信息（缩略列表标注）+ 逐页独立文档（当前页 iframe 装载） */
interface PrintPreview {
  pageCount: number
  /** 逐页行区间/补空行标注（源表数据行 1 起计） */
  rowLabels: string[]
  /** 逐页独立文档：文档级 CSS（与打印输出同源）+ 单页片段，所见即所得 */
  pageDocs: string[]
  /** 纸张显示尺寸（px，含边距整页口径） */
  paperWidth: number
  paperHeight: number
}

/** 构建预览：分页结果 + 从完整文档切出逐页文档（@page 规则随独立 iframe 隔离，不外溢宿主） */
function buildPrintPreview(plugin: PrintPluginHandle, config: PrintConfig): PrintPreview {
  const pages = plugin.paginate(config)
  const parsed = new DOMParser().parseFromString(plugin.buildDocumentHtml(config), 'text/html')
  const css = parsed.querySelector('style')?.textContent ?? ''
  const wrapPage = (html: string): string =>
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`
  const pageDocs =
    pages.length > 0
      ? Array.from(parsed.querySelectorAll('.print-page'), (el) => wrapPage(el.outerHTML))
      : [plugin.buildDocumentHtml(config)] // 空表兜底：整文档（自带空表页）
  const [widthMm, heightMm] =
    PAPER_MM[typeof config.paperSize === 'string' ? config.paperSize : 'A4']
  const [paperWidthMm, paperHeightMm] =
    config.orientation === 'landscape' ? [heightMm, widthMm] : [widthMm, heightMm]
  return {
    pageCount: pageDocs.length,
    rowLabels: pages.map(
      (page) =>
        `行 ${page.rowRange.start + 1}–${page.rowRange.end}` +
        (page.blankRows > 0 ? ` · 补空 ${page.blankRows} 行` : ''),
    ),
    pageDocs,
    paperWidth: Math.round(paperWidthMm * MM_TO_PX),
    paperHeight: Math.round(paperHeightMm * MM_TO_PX),
  }
}

export function PrintPage() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [demo, setDemo] = useState<PrintDemo | null>(null)
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_SETTINGS)
  const [preview, setPreview] = useState<PrintPreview | null>(null)
  const [current, setCurrent] = useState(0)
  const [printing, setPrinting] = useState(false)
  /** 调起计数镜像（demo.print 完成后回读刷新状态行） */
  const [printCount, setPrintCount] = useState(0)
  const [lastPrinted, setLastPrinted] = useState<PrintConfig | null>(null)

  useEffect(() => {
    const el = mountRef.current
    if (!el) return
    setDemo(mountPrint(el))
  }, [])

  /** 打开预览弹层：按面板当前值合成配置，分页结果与逐页文档一次构建 */
  const openPreview = (): void => {
    if (!demo) return
    setPreview(buildPrintPreview(demo.plugin, buildPrintConfig(settings)))
    setCurrent(0)
  }

  const handlePrint = (): void => {
    if (!demo || !preview || printing) return
    setPrinting(true)
    void demo
      .print(buildPrintConfig(settings))
      .catch((error: unknown) => {
        console.error('打印失败', error)
      })
      .finally(() => {
        setPrinting(false)
        setPrintCount(demo.getPrintCount())
        setLastPrinted(demo.getLastPrintConfig())
      })
  }

  const updateSetting = <K extends keyof PrintSettings>(key: K, value: PrintSettings[K]): void => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-xl font-semibold tracking-tight">打印预览与输出</h2>
          <Badge variant="secondary">fitpage/fixrows 分页</Badge>
          <Badge variant="secondary">每页重复表头</Badge>
          <Badge variant="secondary">页眉页脚占位符</Badge>
          <Badge variant="secondary">真实浏览器打印</Badge>
        </div>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          headless 打印内核 + 预览弹层：超过一页的示例表（两行表头带合并单元格）经 PrintSource
          供数，右侧配置纸张/方向/缩放/分页模式后打开预览（缩略列表 + 当前页放大 +
          打印按钮）；点打印经隐藏 iframe 装载全部页面后调 iframe.contentWindow.print()
          调起浏览器打印（只打印报表内容），状态行与 window.__DEMO__.print 可读调起计数。
        </p>
      </div>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div ref={mountRef} className="demo-mount-area" />

        <div className="w-full rounded-xl border bg-card px-5 py-4 shadow-sm xl:w-[300px] xl:shrink-0">
          <h3 className="text-sm font-semibold">打印参数</h3>

          <div className="mt-4 grid gap-4">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">纸张</Label>
              <Select
                value={settings.paper}
                onValueChange={(value) => updateSetting('paper', value as PrintPaperPreset)}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A4">A4</SelectItem>
                  <SelectItem value="A5">A5</SelectItem>
                  <SelectItem value="Letter">Letter</SelectItem>
                  <SelectItem value="A3">A3</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">方向</Label>
              <Select
                value={settings.orientation}
                onValueChange={(value) => updateSetting('orientation', value as PrintOrientation)}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="portrait">纵向</SelectItem>
                  <SelectItem value="landscape">横向</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">缩放</Label>
              <Select
                value={settings.scale}
                onValueChange={(value) => updateSetting('scale', value as PrintScaleMode)}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="origin">原始尺寸</SelectItem>
                  <SelectItem value="fit-width">适配页宽</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">分页模式</Label>
              <Select
                value={settings.paging}
                onValueChange={(value) => updateSetting('paging', value as PrintPagingMode)}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fitpage">fitpage 按页高</SelectItem>
                  <SelectItem value="fixrows">fixrows 固定行数</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="print-fixrows" className="text-xs text-muted-foreground">
                每页行数（fixrows，含重复表头）
              </Label>
              <Input
                id="print-fixrows"
                type="number"
                min={FIX_ROWS_MIN}
                max={FIX_ROWS_MAX}
                value={settings.fixRows}
                disabled={settings.paging !== 'fixrows'}
                onChange={(event) => {
                  const parsed = Number(event.target.value)
                  if (Number.isFinite(parsed)) {
                    updateSetting('fixRows', Math.trunc(parsed))
                  }
                }}
                className="h-8 text-[13px]"
              />
            </div>
          </div>

          <Separator className="my-4" />

          <Button size="sm" className="w-full" disabled={!demo} onClick={openPreview}>
            <Printer />
            打印预览
          </Button>

          <p className="mt-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 font-mono text-[11px] leading-relaxed text-primary">
            已调起浏览器打印 {printCount} 次
            {lastPrinted
              ? `；最近：${paperLabel(lastPrinted.paperSize)} ${lastPrinted.orientation ?? 'portrait'}` +
                ` ${lastPrinted.paging ?? 'fitpage'}` +
                `${lastPrinted.paging === 'fixrows' ? `（每页 ${lastPrinted.fixRows ?? '-'} 行）` : ''}` +
                ` ${lastPrinted.scale ?? 'origin'}`
              : '；尚未打印（打开预览后点打印按钮）'}
          </p>
        </div>
      </div>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        {preview && (
          <DialogContent className="flex h-[85vh] sm:max-w-[1100px] flex-col gap-0 p-0">
            <DialogHeader className="flex-none border-b px-5 py-3">
              <DialogTitle className="text-base">2026 Q3 销售明细（打印示例）</DialogTitle>
              <DialogDescription className="text-xs">
                第 {current + 1} 页 / 共 {preview.pageCount} 页 · 每页重复表头 {PRINT_HEADER_ROWS}{' '}
                行 · 页眉页脚占位符按当前配置求值
              </DialogDescription>
            </DialogHeader>

            <div className="flex min-h-0 flex-1">
              <div className="flex w-48 shrink-0 flex-col gap-2 overflow-y-auto border-r p-3">
                {preview.pageDocs.map((_, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    size="sm"
                    className={cn(
                      'h-auto flex-col items-start gap-0.5 py-2 text-left',
                      index === current && 'border-primary ring-2 ring-primary/25',
                    )}
                    onClick={() => setCurrent(index)}
                  >
                    <span className="text-xs font-semibold">第 {index + 1} 页</span>
                    <span className="font-mono text-[10px] font-normal text-muted-foreground">
                      {preview.rowLabels[index] ?? ''}
                    </span>
                  </Button>
                ))}
              </div>

              <div className="min-w-0 flex-1 overflow-auto bg-muted/50 p-6">
                <div
                  className="mx-auto bg-white shadow-lg"
                  style={{ width: preview.paperWidth, height: preview.paperHeight }}
                >
                  <iframe
                    key={current}
                    title={`打印页面预览 第 ${current + 1} 页`}
                    srcDoc={preview.pageDocs[current]}
                    className="block h-full w-full border-0"
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="flex-none border-t px-5 py-3 sm:justify-between">
              <span className="self-center text-xs text-muted-foreground sm:mr-auto">
                打印按钮经隐藏 iframe 装载全部页面后调起浏览器打印（只打印报表内容）
              </span>
              <Button onClick={handlePrint} disabled={printing}>
                <Printer />
                {printing ? '打印中…' : `打印全部 ${preview.pageCount} 页`}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
