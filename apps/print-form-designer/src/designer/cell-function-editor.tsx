// 单元格函数编辑器（Excel「插入函数」式向导）：第一控件是「选择函数」下拉，
// 选定聚合函数后**不再出现数据块/字段下拉**——直接进入「点选参数格」模式：到画布上
// 点一个字段绑定格（通常是明细区的数值格），数据块引用名与字段路径由被点格子自动
// 推导（deriveParamCell），点中即写入当前格。没有草稿、没有失焦提交，改参数 =
// 「重选参数格」再点一次；取消（Esc / 按钮）什么都不写，不产生半配置函数。
// 「自定义 JS」是唯一出现表达式编辑器的入口：显式「应用」按钮或 ⌘/Ctrl+Enter
// 提交，禁止 blur 提交（旧实现 blur 晚于选区更新，草稿会错绑到后点的格子上）；
// 编辑器旁显示目标格地址，未应用就切格 = 丢弃（宿主按目标格 key 重挂载本组件）。
// 帮助浮层（? 卡片）保留；数据块/聚合引用 chips 只在自定义编辑器内服务表达式。
import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { formatAddress, type CellAddress } from '@infinitable/sheet'

import { CELL_FUNCTION_CATALOG, cellFnLabel } from './cell-function'
import { InfoBubble, popoverStyleFor } from './InfoBubble'
import type { FormDoc } from '../domain/form-doc'
import type { FnPickState } from './panel-state'
import {
  cellFunctionExpression,
  regionRefOf,
  type CellFnName,
  type FormCellFunction,
  type RegionFnName,
} from '../shared/template-schema'
import { compileExpr } from '../transform/expr'
import { describeError } from '../errors'

/** 求值上下文的形参白名单（与 evaluateCellFunction 的注入一致） */
const FN_ARG_NAMES = ['agg', 'item', 'SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'SUBTOTAL', 'GROUP']

/** 「选择函数」下拉的函数选项（顺序即下拉顺序；item/agg 引用只进帮助浮层） */
const FN_OPTIONS = CELL_FUNCTION_CATALOG.filter((item) => item.kind !== 'ref')

/** 下拉取值：七个内置函数 / 自定义 JS / 空（未设置或清除） */
type Selection = CellFnName | 'expr' | ''

/** 各数据块函数在「参数格语义」摘要里的一句取数口径 */
const FN_PARAM_TAILS: Record<RegionFnName, string> = {
  SUM: '列表有几条就累加几个值',
  AVG: '列表有几条就一起取平均',
  COUNT: '带字段时统计该字段有值的条数',
  MIN: '列表取全部值的最小值',
  MAX: '列表取全部值的最大值',
  SUBTOTAL: '小计行按当前组、合计行取全体',
}

/** 已配置结构化函数的「参数格语义」摘要（数据块函数与 GROUP 两种口径） */
function paramCellSummary(fn: Extract<FormCellFunction, { kind: 'fn' }>): string {
  if (fn.fn === 'GROUP') {
    return fn.field
      ? `分组值 · 按 ${fn.field} 字段分组时显示组名`
      : '分组值 · 按所在数据块的首个分组字段显示组名'
  }
  const tail = FN_PARAM_TAILS[fn.fn]
  return fn.field
    ? `${cellFnLabel(fn.fn)} · ${fn.region}区的 ${fn.field} 字段（${tail}）`
    : `${cellFnLabel(fn.fn)} · ${fn.region}区（字段跟随本列绑定，${tail}）`
}

interface Props {
  doc: FormDoc
  /** 目标格（提交落点；宿主按它 key 重挂载——切格即丢弃未应用的编辑） */
  addr: CellAddress
  /** 当前格函数（undefined = 未设置） */
  fn: FormCellFunction | undefined
  /** 本格的点选状态（DesignerPage 的 fnPick 与本格地址一致才有值，否则 null） */
  pick: FnPickState | null
  /** 选定函数 → 进入画布点选参数格（状态由宿主 DesignerPage 持有） */
  onPickStart: (fn: CellFnName, targetAddr: CellAddress) => void
  /** 取消点选（面板取消按钮；Esc 走宿主全局监听，最终都清同一份状态） */
  onPickCancel: () => void
  /** 提交（null = 清除函数）；写入即生效（与字段绑定互斥在 FormDoc.setCellFunction 处理） */
  onCommit: (fn: FormCellFunction | null) => void
}

export function CellFunctionEditor({
  doc,
  addr,
  fn,
  pick,
  onPickStart,
  onPickCancel,
  onCommit,
}: Props) {
  const [selected, setSelected] = useState<Selection>(() =>
    fn ? (fn.kind === 'fn' ? fn.fn : 'expr') : '',
  )
  // 自定义 JS 草稿：只在显式「应用」时进模型，切格随组件重挂载丢弃
  const [draft, setDraft] = useState(() => (fn?.kind === 'expr' ? fn.expression : ''))
  const [error, setError] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  /** 浮层 fixed 定位（按 ? 钮矩形钳在视口内），避免被滚动面板裁切 */
  const [helpStyle, setHelpStyle] = useState<CSSProperties | undefined>()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /** ? 按钮与浮层的公共容器：点它不算「点外」，避免开了立刻被关掉 */
  const helpRef = useRef<HTMLSpanElement>(null)
  /** 本组件自己动了下拉：随之而来的点选结束（onPickCancel）不算外部变化，别回填覆盖 */
  const selfSelectRef = useRef(false)

  // 模型被外部改写（撤销/重做/点选写入）或点选被外部结束（Esc/画布取消/点中写入）
  // 时下拉回填模型值；点选进行中不打扰（下拉停在刚选的函数上）
  useEffect(() => {
    if (pick) {
      selfSelectRef.current = false
      return
    }
    if (selfSelectRef.current) {
      selfSelectRef.current = false
      return
    }
    setSelected(fn ? (fn.kind === 'fn' ? fn.fn : 'expr') : '')
    setError('')
  }, [fn, pick])

  // 帮助浮层：Esc 或点外关闭
  useEffect(() => {
    if (!helpOpen) return
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setHelpOpen(false)
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (helpRef.current && !helpRef.current.contains(event.target as Node)) {
        setHelpOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [helpOpen])

  /** 有带源的数据块才能点选参数格（推导需要数据块 + 字段绑定） */
  const hasSourcedRegion = doc.regions.some((region) => region.source)

  /** 选函数：聚合函数进入画布点选（没有带源的数据块时先给指引）；自定义 JS 只开编辑器等显式应用 */
  const onSelectFunction = (value: Selection): void => {
    setSelected(value)
    setError('')
    if (pick) {
      // 换选择 = 放弃进行中的点选；这是自己发起的结束，同步 effect 别把下拉回填覆盖掉
      selfSelectRef.current = true
      onPickCancel()
    }
    if (value === '') {
      onCommit(null)
      return
    }
    if (value === 'expr') {
      // 从当前配置合成起始表达式（结构化 → 等价表达式），在此基础上继续手改
      setDraft(fn ? cellFunctionExpression(fn) : '')
      return
    }
    if (!hasSourcedRegion) return // 下方 hint 指引先建带源的数据块
    onPickStart(value, addr)
  }

  /** 显式提交草稿（空 = 清除函数）；编译失败只报错误槽，草稿原样保留等改完再应用 */
  const applyDraft = (): void => {
    const next = draft.trim()
    if (!next) {
      onCommit(null)
      setSelected('')
      setError('')
      return
    }
    try {
      compileExpr(FN_ARG_NAMES, next)
      onCommit({ kind: 'expr', expression: next })
      setError('')
    } catch (cause) {
      setError(`函数有语法错误：${describeError(cause)}`)
    }
  }

  /** 在光标处插入片段（自定义编辑器的引用 chips 用）；无光标信息时追加到末尾 */
  const insertAtCursor = (snippet: string): void => {
    const el = textareaRef.current
    if (!el) {
      setDraft((prev) => prev + snippet)
      return
    }
    const start = el.selectionStart ?? draft.length
    const end = el.selectionEnd ?? draft.length
    const next = draft.slice(0, start) + snippet + draft.slice(end)
    setDraft(next)
    requestAnimationFrame(() => {
      el.focus()
      const caret = start + snippet.length
      el.setSelectionRange(caret, caret)
    })
  }

  const structuredFn = fn?.kind === 'fn' ? fn : undefined

  return (
    <div className="cell-function-editor">
      <div className="field-col">
        <div className="cell-function-head">
          <span className="field-label">函数（与字段绑定互斥）</span>
          <span className="fn-help" ref={helpRef}>
            <button
              type="button"
              className="fn-help-toggle"
              aria-expanded={helpOpen}
              title="全部函数与引用的说明"
              onClick={() => {
                const rect = helpRef.current?.getBoundingClientRect()
                // 视口钳制定位与 InfoBubble 共用同一份实现（下方不够向上翻、左右不出界）
                if (rect) setHelpStyle(popoverStyleFor(rect, 260, 300))
                setHelpOpen((prev) => !prev)
              }}
            >
              ?
            </button>
            {helpOpen ? (
              <div
                className="fn-help-popover"
                style={helpStyle}
                role="dialog"
                aria-label="函数说明"
              >
                {CELL_FUNCTION_CATALOG.map((item) => (
                  <div className="fn-help-item" key={item.name}>
                    <p className="fn-help-head">
                      <span className="mono">{item.name}</span>
                      <span className="fn-help-item-label">{item.label}</span>
                    </p>
                    <p className="fn-help-desc">{item.title}</p>
                    <p className="fn-help-example mono">
                      {item.signature} · 例 {item.example}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </span>
        </div>
        <select
          value={selected}
          title="选函数后到画布上点一个字段格当参数，数据块与字段自动带出"
          onChange={(event) => onSelectFunction(event.target.value as Selection)}
        >
          <option value="">{fn ? '无（清除函数）' : '选择函数…'}</option>
          {FN_OPTIONS.map((item) => (
            <option key={item.name} value={item.name} title={item.title}>
              {item.label}（{item.name}）
            </option>
          ))}
          <option
            value="expr"
            title="自己写受限 JS 表达式（item / agg / 六函数可用），显式应用提交"
          >
            自定义 JS
          </option>
        </select>
      </div>

      {/* 没有带源的数据块：点选无从推导，先指引建数据块（选了的函数名停在下游等数据块就绪） */}
      {selected !== '' && selected !== 'expr' && !pick && !hasSourcedRegion ? (
        <p className="hint">
          还没有绑数据源的数据块：先在「数据块」tab 框选创建并配置数据源，再回来点选参数格。
        </p>
      ) : null}

      {/* 点选进行中：面板与画布提示条同一份状态（提示文案与失败原因同源） */}
      {pick ? (
        <div className="cell-function-pick">
          <p className="hint">
            正在为 <span className="addr-badge">{formatAddress(pick.targetAddr)}</span>
            {` 配置「${cellFnLabel(pick.fn)}」：到画布上点一个字段格当参数（通常是明细区的数值格）。`}
          </p>
          <p className="cell-function-error" role="alert">
            {pick.error}
          </p>
          <button type="button" className="cell-function-pick-cancel" onClick={onPickCancel}>
            取消点选
          </button>
        </div>
      ) : structuredFn ? (
        /* 已配置函数：参数格语义摘要 + 重选 / 清除 */
        <div className="cell-function-summary">
          <p className="cell-function-summary-text">{paramCellSummary(structuredFn)}</p>
          <p className="cell-function-summary-expr mono">{cellFunctionExpression(structuredFn)}</p>
          <div className="cell-function-tools">
            <button
              type="button"
              className="cell-function-repick"
              onClick={() => onPickStart(structuredFn.fn, addr)}
            >
              重选参数格
            </button>
            <button type="button" className="cell-function-clear" onClick={() => onCommit(null)}>
              清除函数
            </button>
          </div>
        </div>
      ) : null}

      {selected === 'expr' ? (
        <div className="cell-function-custom">
          <p className="hint cell-function-target">
            应用到 <span className="addr-badge">{formatAddress(addr)}</span>
            <InfoBubble label="提交规则">
              点「应用」或按 ⌘/Ctrl+Enter 提交；内容清空再应用 = 清除函数；未应用就切格 = 丢弃草稿。
            </InfoBubble>
          </p>
          <textarea
            ref={textareaRef}
            className="mono"
            rows={3}
            value={draft}
            spellCheck={false}
            placeholder={"如 SUM('明细', 'amount')、item.qty * item.price、agg.summary['总计']"}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                applyDraft()
              }
            }}
          />
          <div className="cell-function-tools">
            {doc.regions.length > 0 || doc.aggregations.length > 0 ? (
              <div className="field-chips">
                {doc.regions.map((region, index) => {
                  const ref = regionRefOf(region, index)
                  return (
                    <button
                      key={ref}
                      type="button"
                      className="field-chip mono-chip"
                      title={`插入数据块引用 '${ref}'`}
                      onClick={() => insertAtCursor(`'${ref}'`)}
                    >
                      {ref}
                    </button>
                  )
                })}
                {doc.aggregations.map((agg) => (
                  <button
                    key={agg.name}
                    type="button"
                    className="field-chip mono-chip"
                    title={`插入聚合引用 agg.${agg.name}`}
                    onClick={() => insertAtCursor(`agg.${agg.name}`)}
                  >
                    agg.{agg.name}
                  </button>
                ))}
              </div>
            ) : null}
            <button type="button" className="cell-function-apply" onClick={applyDraft}>
              应用
            </button>
          </div>
          {/* 固定高度错误槽：常驻不挤压布局，报错填红字、成功清空 */}
          <p className="cell-function-error" role="alert">
            {error}
          </p>
        </div>
      ) : null}
    </div>
  )
}
