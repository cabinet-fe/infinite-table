// 数值草稿输入：受控草稿 + 失焦/回车提交，避免每键入一次就往模型写一次（写入会进撤销链）。
import { useEffect, useState } from 'react'

interface Props {
  /** 外部当前值（模型值变化时回填草稿；undefined = 无自定义值） */
  value: number | undefined
  placeholder?: string
  min?: number
  max?: number
  className?: string
  title?: string
  onCommit: (value: number) => void
}

export function DraftNumberInput({
  value,
  placeholder,
  min,
  max,
  className,
  title,
  onCommit,
}: Props) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))

  // 模型值变化（切换选区、撤销）时同步草稿；草稿自身编辑期间不被覆盖
  useEffect(() => {
    setDraft(value === undefined ? '' : String(value))
  }, [value])

  const commit = (): void => {
    const next = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(next)) {
      setDraft(value === undefined ? '' : String(value))
      return
    }
    const clamped = Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min ?? 0, next))
    setDraft(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }

  return (
    <input
      type="number"
      className={className}
      title={title}
      min={min}
      max={max}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }
        if (event.key === 'Escape') {
          setDraft(value === undefined ? '' : String(value))
          event.currentTarget.blur()
        }
      }}
    />
  )
}
