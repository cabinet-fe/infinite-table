// 区域面板（原「区域」面板）：区域列表（类型切换 / 行数调整 / 排序 / 删除）+ 添加区域。
// 点击行本身选中画布上该区域的整行区；行内控件不触发选中（避免误联动）。
// 每行两段：主行（色点 + 类型 + 行号范围 + 行数步进 + 图标按钮）+ 说明句（这张区域打印时怎么走）。
import { BAND_KIND_COLORS } from './canvas-overlay'
import type { FormDoc } from './form-doc'
import {
  BAND_KINDS,
  BAND_KIND_HINTS,
  BAND_KIND_LABELS,
  DEFAULT_BAND_ROWS,
  type BandKind,
  type FormBand,
} from './template'
import { IconChevronDown, IconChevronUp, IconMinus, IconPlus, IconTrash } from '../ui/icons'

interface Props {
  doc: FormDoc
  bands: FormBand[]
  activeStartRow: number | undefined
  addKind: BandKind
  onAddKindChange: (kind: BandKind) => void
}

export function RegionPanel({ doc, bands, activeStartRow, addKind, onAddKindChange }: Props) {
  /** 点行 → 选中该区域整行区（选区变化再回带高亮，形成侧栏/画布联动） */
  const selectRegion = (band: FormBand): void => {
    doc.sheet.selectRange({
      start: { row: band.startRow, col: 0 },
      end: { row: band.endRow, col: doc.cols - 1 },
    })
  }

  return (
    <div className="card-block">
      <ul className="region-list">
        {bands.map((band, index) => {
          const rows = band.endRow - band.startRow + 1
          return (
            <li
              key={index}
              className={band.startRow === activeStartRow ? 'region-item active' : 'region-item'}
              onClick={() => selectRegion(band)}
              title={`选中画布第 ${band.startRow + 1}-${band.endRow + 1} 行`}
            >
              <div className="region-line">
                <span
                  className="region-dot"
                  style={{ backgroundColor: BAND_KIND_COLORS[band.kind] }}
                  aria-hidden="true"
                />
                <select
                  className="region-kind"
                  value={band.kind}
                  aria-label="区域类型"
                  title="区域类型：决定这块内容在打印时出现几次"
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => doc.setBandKind(index, event.target.value as BandKind)}
                >
                  {BAND_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {BAND_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
                <span className="region-range meta">
                  第 {band.startRow + 1}-{band.endRow + 1} 行
                </span>
                <span className="region-stepper" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={rows <= 1}
                    title="减少一行（从区域底部删除，可撤销）"
                    onClick={() => doc.resizeBand(index, rows - 1)}
                  >
                    <IconMinus />
                  </button>
                  <span className="region-rows">{rows} 行</span>
                  <button
                    type="button"
                    className="icon-button"
                    title="增加一行（在区域底部插入空行，可撤销）"
                    onClick={() => doc.resizeBand(index, rows + 1)}
                  >
                    <IconPlus />
                  </button>
                </span>
                <span className="region-actions" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={index === 0}
                    title="上移一位"
                    onClick={() => doc.moveBand(index, -1)}
                  >
                    <IconChevronUp />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={index === bands.length - 1}
                    title="下移一位"
                    onClick={() => doc.moveBand(index, 1)}
                  >
                    <IconChevronDown />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={bands.length <= 1}
                    title="删除该区域（可撤销）"
                    onClick={() => doc.removeBand(index)}
                  >
                    <IconTrash />
                  </button>
                </span>
              </div>
              <p className="region-hint" title={BAND_KIND_HINTS[band.kind]}>
                {BAND_KIND_HINTS[band.kind]}
              </p>
            </li>
          )
        })}
      </ul>

      <div className="region-add">
        <select
          value={addKind}
          aria-label="新增区域类型"
          onChange={(event) => onAddKindChange(event.target.value as BandKind)}
        >
          {BAND_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {BAND_KIND_LABELS[kind]}（默认 {DEFAULT_BAND_ROWS[kind]} 行）
            </option>
          ))}
        </select>
        <button
          type="button"
          className="accent-outline"
          title="在末尾添加一个区域"
          onClick={() => doc.addBand(addKind)}
        >
          <IconPlus />
          添加区域
        </button>
      </div>

      <p className="hint">
        区域就是单子上从上到下的一块：明细区会按数据条数循环，页眉区每页重复一次。
        点某一行可在画布上选中它占的行；画布左侧的彩色竖条与这里的圆点同色。
      </p>
    </div>
  )
}
