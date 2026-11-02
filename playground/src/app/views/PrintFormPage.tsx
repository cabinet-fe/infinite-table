// 打印单示例：配置驱动的「打印单配置 + 绑定数据集 → 按配置渲染 → 打印」完整接入形态。
// 左侧为当前配置的屏上只读渲染（demo 句柄挂载），右侧面板切换内置打印单配置（列表样 /
// 中国式表格单据）并经 demo.print → 插件 print 调起真实浏览器打印；下方打印产物预览经
// DOMParser 从 buildDocumentHtml 产物切出逐页文档，iframe 装载翻看（不弹系统对话框）。

import { Printer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { PrintConfig } from '@infinitable/plugins'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { buildPrintPreview, paperLabel, type PrintPreview } from '../print-preview'
import {
  mountPrintForm,
  PRINT_FORM_CONFIGS,
  PRINT_FORM_DATASET,
  type PrintFormConfig,
  type PrintFormDemo,
  type PrintFormKind,
} from '../../sections/print-form'

/** 配置选项文案：形态 · 配置标题（Select 与状态行共用） */
const KIND_LABEL: Record<PrintFormKind, string> = {
  list: '列表样',
  document: '中国式单据',
}

function configLabel(config: PrintFormConfig): string {
  return `${KIND_LABEL[config.kind]} · ${config.title}`
}

export function PrintFormPage() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [demo, setDemo] = useState<PrintFormDemo | null>(null)
  const [configId, setConfigId] = useState<string>(PRINT_FORM_CONFIGS[0]!.id)
  const [preview, setPreview] = useState<PrintPreview | null>(null)
  const [current, setCurrent] = useState(0)
  const [printing, setPrinting] = useState(false)
  /** 调起计数镜像（demo.print 完成后回读刷新状态行） */
  const [printCount, setPrintCount] = useState(0)
  const [lastPrinted, setLastPrinted] = useState<PrintConfig | null>(null)

  useEffect(() => {
    const el = mountRef.current
    if (!el) return
    const demo = mountPrintForm(el)
    // 页面文案承诺 window.__DEMO__.printForm 可读调起计数——单演示页只挂自己那一片
    window.__DEMO__ = { printForm: demo }
    setDemo(demo)
    setPreview(buildPrintPreview(demo.getPlugin()))
  }, [])

  /** 切换配置：屏上渲染与打印供数整体重建，预览随新配置重切 */
  const handleSwitchConfig = (id: string): void => {
    if (!demo || id === configId) return
    demo.switchConfig(id)
    setConfigId(id)
    setPreview(buildPrintPreview(demo.getPlugin()))
    setCurrent(0)
  }

  const handlePrint = (): void => {
    if (!demo || printing) return
    setPrinting(true)
    void demo
      .print()
      .catch((error: unknown) => {
        console.error('打印失败', error)
      })
      .finally(() => {
        setPrinting(false)
        setPrintCount(demo.getPrintCount())
        setLastPrinted(demo.getLastPrintConfig())
      })
  }

  const config = demo?.getConfig()

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-xl font-semibold tracking-tight">打印单示例</h2>
          <Badge variant="secondary">配置驱动</Badge>
          <Badge variant="secondary">列表样</Badge>
          <Badge variant="secondary">中国式单据</Badge>
          <Badge variant="secondary">真实浏览器打印</Badge>
        </div>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          内置两份代码内声明的打印单配置（形态/版面/明细列/头尾区），绑定扁平行记录数据集 （模拟 SQL
          查询返回）适配 PrintSource：屏上只读渲染与打印输出同源供数（签名图经 cellImage 通道进打印
          HTML）。切换配置对照列表样（每页重复表头 + 页脚页码/本页合计） 与中国式单据（标题跨全列 +
          完整边框 + 合并单元格 + 每单一页），点打印经插件 print 调起浏览器打印，状态行与
          window.__DEMO__.printForm 可读调起计数。
        </p>
      </div>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div ref={mountRef} className="demo-mount-area" />

        <div className="w-full rounded-xl border bg-card px-5 py-4 shadow-sm xl:w-[300px] xl:shrink-0">
          <h3 className="text-sm font-semibold">打印单配置</h3>

          <div className="mt-4 grid gap-4">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">配置</Label>
              <Select value={configId} onValueChange={handleSwitchConfig}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRINT_FORM_CONFIGS.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {configLabel(item)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {config
              ? `当前：${KIND_LABEL[config.kind]} · ${PRINT_FORM_DATASET.records.length} 行明细 · ` +
                `${paperLabel(config.layout.paperSize)} ${config.layout.orientation ?? 'portrait'}`
              : '配置装载中…'}
          </p>

          <Separator className="my-4" />

          <Button size="sm" className="w-full" disabled={!demo || printing} onClick={handlePrint}>
            <Printer />
            {printing ? '打印中…' : '打印当前配置'}
          </Button>

          <p className="mt-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 font-mono text-[11px] leading-relaxed text-primary">
            已调起浏览器打印 {printCount} 次
            {lastPrinted
              ? `；最近：${paperLabel(lastPrinted.paperSize)} ${lastPrinted.orientation ?? 'portrait'}`
              : '；尚未打印（点打印按钮调起浏览器打印）'}
          </p>
        </div>
      </div>

      {preview && (
        <div className="rounded-xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
            <h3 className="text-sm font-semibold">打印产物预览</h3>
            <span className="text-xs text-muted-foreground">
              第 {current + 1} 页 / 共 {preview.pageCount} 页 · {preview.rowLabels[current] ?? ''}
            </span>
          </div>
          <div className="flex gap-4 p-4">
            <div className="flex w-44 shrink-0 flex-col gap-2">
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
            <div className="min-w-0 flex-1 overflow-auto rounded-lg bg-muted/50 p-6">
              <div
                className="mx-auto bg-white shadow-lg"
                style={{ width: preview.paperWidth, height: preview.paperHeight }}
              >
                <iframe
                  key={current}
                  title={`打印产物预览 第 ${current + 1} 页`}
                  srcDoc={preview.pageDocs[current]}
                  className="block h-full w-full border-0"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
