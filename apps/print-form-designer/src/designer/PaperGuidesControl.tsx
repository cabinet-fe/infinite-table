// 纸张参考线控件：开关 + 纸张 + 方向（显示层配置，永不写入模板）。
// 从 DesignerPage 抽出——画布标题栏已有选区 chip 与提示文案，参考线三件套再内联会把页面撑长。
import type { PrintOrientation, PrintPaperPreset } from '@infinitable/plugins'

import { DEFAULT_PAPER_GUIDES, type PaperGuidesConfig } from './paper-guides'

/** 纸张预设（设计参考线用；真实分页以打印预览为准） */
const PAPER_PRESETS: { value: PrintPaperPreset; label: string }[] = [
  { value: 'A3', label: 'A3' },
  { value: 'A4', label: 'A4' },
  { value: 'A5', label: 'A5' },
  { value: 'Letter', label: 'Letter' },
]

interface Props {
  /** null = 关闭参考线 */
  guides: PaperGuidesConfig | null
  onChange: (next: PaperGuidesConfig | null) => void
}

export function PaperGuidesControl({ guides, onChange }: Props) {
  return (
    <div className="canvas-tools">
      <label className="switch" title="显示纸张边界与分页参考线（不写入模板）">
        <input
          type="checkbox"
          checked={guides !== null}
          onChange={() => onChange(guides ? null : DEFAULT_PAPER_GUIDES)}
        />
        <span className="switch-track" />
        参考线
      </label>
      {guides ? (
        <>
          <select
            className="w-paper"
            value={guides.paperSize}
            aria-label="纸张"
            title="纸张尺寸（仅影响参考线）"
            onChange={(event) =>
              onChange({ ...guides, paperSize: event.target.value as PrintPaperPreset })
            }
          >
            {PAPER_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
          <select
            className="w-orientation"
            value={guides.orientation}
            aria-label="方向"
            title="纸张方向（仅影响参考线）"
            onChange={(event) =>
              onChange({ ...guides, orientation: event.target.value as PrintOrientation })
            }
          >
            <option value="portrait">纵向</option>
            <option value="landscape">横向</option>
          </select>
        </>
      ) : null}
    </div>
  )
}
