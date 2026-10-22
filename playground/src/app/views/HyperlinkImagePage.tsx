// 超链接与图片能力：单元格超链接（悬停/单击）、图片嵌入单元格（缩放/随行列平移）、
// 浮动图片右键不穿透。演示控件（设置/清除链接、fit 切换、行列插删与状态行）为
// shadcn 组件，经 HyperlinkImageDemo 句柄驱动引擎并订阅事件实时刷新。

import {
  Columns3,
  Columns4,
  Image as ImageIcon,
  ImageMinus,
  ImagePlus,
  Link as LinkIcon,
  Link2Off,
  MousePointerClick,
  Rows3,
  Rows4,
  Scaling,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { ListTable } from '@infinitable/table'
import type { ImageFitMode } from '@infinitable/sheet'

import {
  LINK_TARGET,
  mountHyperlinkImage,
  type HyperlinkImageDemo,
} from '../../sections/hyperlink-image'
import { SectionPage } from '../SectionPage'

/** ① 超链接控制面：设置/清除目标格链接 + 悬停与单击（宿主接管）状态行 */
function LinkControls({ demo }: { demo: HyperlinkImageDemo }) {
  const { link } = demo
  const [hasLink, setHasLink] = useState(() => link.getState().hasLink)
  const [hover, setHover] = useState<{ col: number; row: number; url: string } | null>(null)
  const [lastOpen, setLastOpen] = useState<{ col: number; row: number; url: string } | null>(null)

  useEffect(() => {
    // SheetGrid 底层即 ListTable；超链接事件（onCellLinkHover/Leave/Click）是 ListTable
    // 领域事件面、不在 TableEngine 协议面上——此处窄化取领域引用
    const table = link.grid.getTable() as ListTable
    const unsubHover = table.onCellLinkHover((event) =>
      setHover({ col: event.col, row: event.row, url: event.url }),
    )
    const unsubLeave = table.onCellLinkLeave(() => setHover(null))
    // openCellLinkOnClick 已关闭：单击不真实打开，由宿主在此接管（状态行展示）
    const unsubClick = table.onCellLinkClick((event) =>
      setLastOpen({ col: event.col, row: event.row, url: event.url }),
    )
    return () => {
      unsubHover()
      unsubLeave()
      unsubClick()
    }
  }, [link])

  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            link.setLink()
            setHasLink(link.getState().hasLink)
          }}
        >
          <LinkIcon />
          设置链接格 ({LINK_TARGET.col},{LINK_TARGET.row})
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            link.clearLink()
            setHasLink(link.getState().hasLink)
          }}
        >
          <Link2Off />
          清除链接
        </Button>
        <Separator orientation="vertical" className="h-5" />
        {hover ? (
          <Badge variant="secondary">
            <MousePointerClick />
            悬停 ({hover.col},{hover.row}) → {hover.url}
          </Badge>
        ) : (
          <Badge variant="outline">未悬停链接格（移入链接列观察手型光标）</Badge>
        )}
        {hasLink ? (
          <Badge variant="secondary">目标格已有链接</Badge>
        ) : (
          <Badge variant="outline">目标格无链接</Badge>
        )}
        {lastOpen ? (
          <Badge variant="secondary">
            宿主接管单击 ({lastOpen.col},{lastOpen.row})：将打开 {lastOpen.url}
          </Badge>
        ) : (
          <Badge variant="outline">尚未单击链接格</Badge>
        )}
      </div>
    </div>
  )
}

/** ② 嵌入图控制面：插入/移除、contain/fill 切换、图上方插删行/图左侧插删列 + 图坐标状态行 */
function EmbedControls({ demo }: { demo: HyperlinkImageDemo }) {
  const { embed } = demo
  const [state, setState] = useState(() => embed.getState())

  const drive = (action: () => void): void => {
    action()
    setState(embed.getState())
  }

  const fitButton = (fit: ImageFitMode, label: string) => (
    <Button
      variant={state.fit === fit ? 'default' : 'outline'}
      size="sm"
      disabled={state.image == null}
      onClick={() => drive(() => embed.setFit(fit))}
    >
      <Scaling />
      {label}
    </Button>
  )

  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="outline" size="sm" onClick={() => drive(() => embed.toggleImage())}>
          {state.image ? <ImageMinus /> : <ImagePlus />}
          {state.image ? '移除嵌入图' : '插入格内图片'}
        </Button>
        {fitButton('contain', 'contain 保比例')}
        {fitButton('fill', 'fill 拉伸')}
        <Button
          variant="outline"
          size="sm"
          disabled={state.image == null}
          onClick={() => drive(() => embed.insertRowAboveImage())}
        >
          <Rows3 />
          图上方插入一行
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={state.image == null || state.image.row === 0}
          onClick={() => drive(() => embed.deleteRowAboveImage())}
        >
          <Rows4 />
          删除图上方一行
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={state.image == null}
          onClick={() => drive(() => embed.insertColLeftOfImage())}
        >
          <Columns3 />
          图左侧插入一列
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={state.image == null || state.image.col === 0}
          onClick={() => drive(() => embed.deleteColLeftOfImage())}
        >
          <Columns4 />
          删除图左侧一列
        </Button>
        <Separator orientation="vertical" className="h-5" />
        {state.image ? (
          <Badge variant="secondary">
            <ImageIcon />
            嵌入图在 ({state.image.col},{state.image.row}) · {state.fit}
          </Badge>
        ) : (
          <Badge variant="outline">无嵌入图</Badge>
        )}
      </div>
    </div>
  )
}

/** ③ 浮动图右键控制面：最近一次右键事件（浮动对象 vs 单元格）状态行 */
function FloatMenuControls({ demo }: { demo: HyperlinkImageDemo }) {
  const { floatMenu } = demo
  const imageId = floatMenu.getImageId()
  const [lastEvent, setLastEvent] = useState<{
    kind: 'float' | 'cell'
    detail: string
    id?: string
  } | null>(null)

  useEffect(() => {
    const table = floatMenu.grid.getTable()
    const unsubFloat = table.floatObjects.onContextMenu((event) =>
      setLastEvent({
        kind: 'float',
        id: event.id,
        detail: `落点 (${Math.round(event.x)},${Math.round(event.y)})`,
      }),
    )
    const unsubCell = table.onContextMenu((event) =>
      setLastEvent({
        kind: 'cell',
        detail: event.cell
          ? `格 (${event.cell.col},${event.cell.row}) · ${event.region}`
          : `${event.region} 空白处`,
      }),
    )
    return () => {
      unsubFloat()
      unsubCell()
    }
  }, [floatMenu])

  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {lastEvent ? (
          lastEvent.kind === 'float' ? (
            <Badge variant="secondary">
              <MousePointerClick />
              浮动对象右键：id={lastEvent.id}（
              {lastEvent.id === imageId ? '命中演示图' : '其它浮动对象'}）· {lastEvent.detail}
            </Badge>
          ) : (
            <Badge variant="outline">
              <MousePointerClick />
              单元格右键：{lastEvent.detail}（未穿透浮动层）
            </Badge>
          )
        ) : (
          <Badge variant="outline">右键浮动图或普通格观察事件路由</Badge>
        )}
      </div>
    </div>
  )
}

export function HyperlinkImagePage() {
  const [demo, setDemo] = useState<HyperlinkImageDemo | null>(null)
  // 包装为引用稳定回调：SectionPage 的挂载 effect 依赖 mount 引用，只跑一次
  const mount = useCallback((root: HTMLElement): HyperlinkImageDemo => {
    const mounted = mountHyperlinkImage(root)
    setDemo(mounted)
    return mounted
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <SectionPage
        title="超链接与图片能力"
        tags={[
          '模型链接自动接线',
          '宿主接管打开',
          '格内嵌入图 contain/fill',
          '随行列平移',
          '浮动图右键不穿透',
        ]}
        desc="单元格超链接：sheet 模型按格写链接后引擎自动接线（宿主不传 hook），命中格蓝字下划线 + 手型光标，悬停/单击事件由宿主订阅（默认打开已关闭，页面状态行接管展示）。图片嵌入单元格：sheet 模型按格存图后引擎自动渲染，contain/fill 缩放切换，插入/删除行列后图随格平移（按格查询 API 定位）。浮动图片右键：浮动层优先路由，右键图片派发携带 id 的浮动对象右键事件，普通格仍走单元格右键事件。"
        mount={mount}
      />
      {demo ? (
        <div className="flex flex-col gap-3">
          <LinkControls demo={demo} />
          <EmbedControls demo={demo} />
          <FloatMenuControls demo={demo} />
        </div>
      ) : null}
    </div>
  )
}
