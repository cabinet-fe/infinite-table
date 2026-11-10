// 格样式工具条（ribbon）：按分组排布样式操作，最右固定「打印」主操作。
// 控件状态跟随当前选区（useSelectionStyle）：加粗按下态、字号、对齐、数字格式、边框预设。
import type { CellStylePatch } from '@infinitable/sheet'

import type { FormDoc } from '../domain/form-doc'
import {
  BORDER_OPTIONS,
  NUM_FMT_QUICK,
  borderPatch,
  detectBorderOption,
  detectNumFmtOption,
  numFmtPatch,
  type BorderOption,
} from './style-presets'
import { useSelectionStyle } from './use-selection-style'
import { DraftNumberInput } from '../ui/DraftNumberInput'
import {
  IconAlignBottom,
  IconAlignCenter,
  IconAlignLeft,
  IconAlignMiddle,
  IconAlignRight,
  IconAlignTop,
  IconBold,
  IconEraser,
  IconMerge,
  IconPrint,
  IconRedo,
  IconSplit,
  IconUndo,
} from '../ui/icons'

interface Props {
  doc: FormDoc
  canUndo: boolean
  canRedo: boolean
  onPrint: () => void
}

type Horizontal = 'left' | 'center' | 'right'
type Vertical = 'top' | 'middle' | 'bottom'

const H_ALIGNS: { value: Horizontal; label: string; Icon: typeof IconAlignLeft }[] = [
  { value: 'left', label: '左对齐', Icon: IconAlignLeft },
  { value: 'center', label: '居中', Icon: IconAlignCenter },
  { value: 'right', label: '右对齐', Icon: IconAlignRight },
]

const V_ALIGNS: { value: Vertical; label: string; Icon: typeof IconAlignTop }[] = [
  { value: 'top', label: '顶端对齐', Icon: IconAlignTop },
  { value: 'middle', label: '垂直居中', Icon: IconAlignMiddle },
  { value: 'bottom', label: '底端对齐', Icon: IconAlignBottom },
]

export function StyleToolbar({ doc, canUndo, canRedo, onPrint }: Props) {
  const { range, style, rowHeight, colWidth } = useSelectionStyle(doc)
  const disabled = range === null

  const apply = (patch: CellStylePatch): void => {
    if (range) doc.sheet.setCellStyle(range, patch)
  }

  const bold = style?.font?.bold === true
  const fontSize = style?.font?.size
  const horizontal = style?.align?.horizontal
  const vertical = style?.align?.vertical
  const borderOption = detectBorderOption(style)
  const numFmtOption = detectNumFmtOption(style)

  return (
    <section className="toolbar ribbon" aria-label="格样式">
      <div className="ribbon-scroll">
        {/* 1. 撤销 / 重做 */}
        <div className="ribbon-group">
          <button
            type="button"
            className="text-button"
            onClick={() => doc.history.undo()}
            disabled={!canUndo}
            title="撤销上一步（⌘Z）"
          >
            <IconUndo className="button-icon" />
            撤销
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => doc.history.redo()}
            disabled={!canRedo}
            title="重做（⇧⌘Z）"
          >
            <IconRedo className="button-icon" />
            重做
          </button>
        </div>

        {/* 2. 边框 / 填充 / 字色 */}
        <div className="ribbon-group">
          <span className="ribbon-field w-border">
            <select
              value={borderOption === 'mixed' ? '' : borderOption}
              disabled={disabled}
              title="单元格边框：四边同一种线型"
              onChange={(event) => apply(borderPatch(event.target.value as BorderOption))}
            >
              {borderOption === 'mixed' ? <option value="">混合边框</option> : null}
              {BORDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </span>

          <span className="color-swatch" title="填充颜色（作用于选区）">
            <span
              className="swatch-preview"
              style={style?.fill?.color ? { backgroundColor: style.fill.color } : undefined}
            />
            <input
              type="color"
              aria-label="填充颜色"
              value={style?.fill?.color ?? '#ffffff'}
              disabled={disabled}
              onChange={(event) => apply({ fill: { color: event.target.value } })}
            />
          </span>

          <button
            type="button"
            className="icon-button"
            disabled={disabled}
            title="清除填充色（保留边框与字体）"
            onClick={() => apply({ fill: {} })}
          >
            <IconEraser />
          </button>

          <span className="color-swatch" title="字体颜色">
            <span className="swatch-label" style={{ color: style?.font?.color ?? '#101828' }}>
              A
            </span>
            <input
              type="color"
              aria-label="字体颜色"
              value={style?.font?.color ?? '#101828'}
              disabled={disabled}
              onChange={(event) => apply({ font: { color: event.target.value } })}
            />
          </span>
        </div>

        {/* 3. 加粗 / 字号 */}
        <div className="ribbon-group">
          <button
            type="button"
            className="icon-button"
            aria-pressed={bold}
            disabled={disabled}
            title={bold ? '取消加粗（当前已加粗）' : '加粗（⌘B）'}
            onClick={() => apply({ font: { bold: bold ? null : true } })}
          >
            <IconBold />
          </button>
          <span className="ribbon-field w-font-size" title="字号（单位 pt）">
            <DraftNumberInput
              value={fontSize}
              min={6}
              max={72}
              placeholder="默认"
              onCommit={(next) => apply({ font: { size: next } })}
            />
          </span>
        </div>

        {/* 4. 水平 / 垂直对齐 */}
        <div className="ribbon-group">
          {H_ALIGNS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              className="icon-button"
              aria-pressed={horizontal === value}
              disabled={disabled}
              title={`水平：${label}`}
              onClick={() => apply({ align: { horizontal: value } })}
            >
              <Icon />
            </button>
          ))}
          {V_ALIGNS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              className="icon-button"
              aria-pressed={vertical === value}
              disabled={disabled}
              title={`垂直：${label}`}
              onClick={() => apply({ align: { vertical: value } })}
            >
              <Icon />
            </button>
          ))}
        </div>

        {/* 5. 数字格式快捷组（金额大写是这里最常见的诉求，做成一键） */}
        <div className="ribbon-group numfmt-group">
          {NUM_FMT_QUICK.map((option) => {
            const active =
              option.value === 'none' ? numFmtOption === 'none' : numFmtOption === option.value
            return (
              <button
                key={option.value}
                type="button"
                className="numfmt-button"
                aria-pressed={active}
                disabled={disabled}
                title={option.title}
                onClick={() => apply(numFmtPatch(option.value))}
              >
                {option.label}
              </button>
            )
          })}
        </div>

        {/* 6. 合并 / 取消合并 */}
        <div className="ribbon-group">
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            title="合并选区（保留左上角值）"
            onClick={() => range && doc.sheet.mergeCells(range)}
          >
            <IconMerge className="button-icon" />
            合并
          </button>
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            title="取消选区内的合并"
            onClick={() => range && doc.sheet.unmergeCells(range)}
          >
            <IconSplit className="button-icon" />
            取消合并
          </button>
        </div>

        {/* 7. 行高 / 列宽（作用于活动格所在行/列） */}
        <div className="ribbon-group">
          <span className="ribbon-field w-row-height" title="当前活动格所在行的行高（px）">
            行高
            <DraftNumberInput
              value={rowHeight}
              min={0}
              max={400}
              placeholder="默认"
              onCommit={(next) => {
                const addr = doc.sheet.getSelection().activeCell
                if (addr) doc.setRowHeight(addr.row, next)
              }}
            />
          </span>
          <span className="ribbon-field w-col-width" title="当前活动格所在列的列宽（px）">
            列宽
            <DraftNumberInput
              value={colWidth}
              min={0}
              max={1200}
              placeholder="默认"
              onCommit={(next) => {
                const addr = doc.sheet.getSelection().activeCell
                if (addr) doc.setColWidth(addr.col, next)
              }}
            />
          </span>
        </div>
      </div>

      <div className="ribbon-actions">
        <button type="button" className="primary" onClick={onPrint} title="打开打印预览（⌘P）">
          <IconPrint />
          打印
        </button>
      </div>
    </section>
  )
}
