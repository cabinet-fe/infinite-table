// 打印页眉页脚（P2，ureport2 HeaderFooterDefinition 三段式移植）：left/center/right
// 三段文本渲染 + 占位符求值。占位符：{page}/{pageCount}/{date}/{time}/{title} 与页级聚合
// {pageSum:COL}/{pageAvg:COL}/{pageMax:COL}/{pageMin:COL}（COL 为 0 起列索引，对页内行
// 按列取数值求和/均值/最大/最小）；未识别占位符原样保留。纯函数零 DOM（分层见
// types.ts 文件头）。

import { escapeHtml } from './escape'
import type { PrintHeaderFooterSection } from './types'

/** 占位符求值上下文（页面构建按页组装，测试可注入固定值） */
export interface PlaceholderContext {
  /** 页码（1 起，{page}） */
  page: number
  /** 总页数（{pageCount}） */
  pageCount: number
  /** 标题（{title}；缺省取 PrintSource.name） */
  title: string
  /** 日期文本（{date}，yyyy-MM-dd） */
  date: string
  /** 时间文本（{time}，HH:mm） */
  time: string
  /**
   * 页级聚合取数：页内数据行在指定列（0 起索引）上的数值集合（构建方已滤除非数值）。
   * 空页/全非数值列返回空数组（sum 出 0，avg/max/min 出空串）。
   */
  columnNumbers: (col: number) => readonly number[]
}

/** 占位符语法：{name} 或 {name:arg}（arg 供页级聚合携带列索引） */
const PLACEHOLDER_RE = /\{([A-Za-z]+)(?::([^}]*))?\}/g

/** 聚合数值格式化：消除浮点累加尾差（0.1+0.2 → 0.3）后直出十进制串 */
function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return ''
  }
  return String(Math.round(value * 1e10) / 1e10)
}

/** 页级聚合求值：sum 空集为 0，avg/max/min 空集为空串 */
function aggregate(
  values: readonly number[],
  kind: 'pageSum' | 'pageAvg' | 'pageMax' | 'pageMin',
): string {
  if (kind === 'pageSum') {
    let sum = 0
    for (const value of values) {
      sum += value
    }
    return formatNumber(sum)
  }
  if (values.length === 0) {
    return ''
  }
  if (kind === 'pageAvg') {
    let sum = 0
    for (const value of values) {
      sum += value
    }
    return formatNumber(sum / values.length)
  }
  return formatNumber(kind === 'pageMax' ? Math.max(...values) : Math.min(...values))
}

/**
 * 占位符求值（headless 纯函数）：识别 page/pageCount/date/time/title 与页级聚合
 * pageSum/pageAvg/pageMax/pageMin（`:列索引` 参数，非法列索引按未识别处理原样保留）；
 * 其余 `{...}` 原样保留（宿主自定义文案不破坏）。
 */
export function evaluatePlaceholders(text: string, ctx: PlaceholderContext): string {
  return text.replace(PLACEHOLDER_RE, (raw, name: string, arg: string | undefined): string => {
    switch (name) {
      case 'page':
        return String(ctx.page)
      case 'pageCount':
        return String(ctx.pageCount)
      case 'date':
        return ctx.date
      case 'time':
        return ctx.time
      case 'title':
        return ctx.title
      case 'pageSum':
      case 'pageAvg':
      case 'pageMax':
      case 'pageMin': {
        const col = Number(arg)
        if (arg === undefined || !Number.isInteger(col) || col < 0) {
          return raw
        }
        return aggregate(ctx.columnNumbers(col), name)
      }
      default:
        return raw
    }
  })
}

/**
 * 三段式页眉/页脚渲染：left/center/right 三段各占 1/3 宽（对齐样式由文档级 CSS 的
 * .hf-left/.hf-center/.hf-right 类承担），占位符先求值再整体转义。section 为
 * null/undefined 返回空串（页面构建据此跳过该带）。
 */
export function renderHeaderFooter(
  section: PrintHeaderFooterSection | null | undefined,
  ctx: PlaceholderContext,
  kind: 'header' | 'footer',
): string {
  if (!section) {
    return ''
  }
  const part = (text: string | undefined, className: string): string =>
    `<td class="${className}">${escapeHtml(evaluatePlaceholders(text ?? '', ctx))}</td>`
  return (
    `<table class="print-${kind}"><tr>` +
    part(section.left, 'hf-left') +
    part(section.center, 'hf-center') +
    part(section.right, 'hf-right') +
    '</tr></table>'
  )
}
