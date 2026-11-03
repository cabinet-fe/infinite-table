// 模板面板：保存（已存在模板则更新、否则新建）/ 另存（强制新建）/ 模板列表打开。
// 序列化与还原共用 FormDoc.toTemplate / fromTemplate 入口，画布还原由 DesignerPage
// 替换 doc 驱动；round-trip 等价由 app 内测试守住。
import { useCallback, useEffect, useState } from 'react'

import { api, type TemplateSummary } from '../data/api'
import { FormDoc } from './form-doc'

interface Props {
  doc: FormDoc
  /** 模板名（受控；提升到设计页，打印弹框标题共用） */
  name: string
  onNameChange: (name: string) => void
  /** 模板加载完成：以还原出的新文档替换当前 doc（画布随之重建） */
  onLoaded: (doc: FormDoc) => void
}

export function TemplatePanel({ doc, name, onNameChange, onLoaded }: Props) {
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null)
  const [openId, setOpenId] = useState('')
  const [status, setStatus] = useState<{ text: string; error: boolean }>({ text: '', error: false })
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    api
      .listTemplates()
      .then(setTemplates)
      .catch((cause: unknown) =>
        setStatus({ text: cause instanceof Error ? cause.message : String(cause), error: true }),
      )
  }, [])

  useEffect(reload, [reload])

  async function run(action: () => Promise<void>, successText: string): Promise<void> {
    setBusy(true)
    try {
      await action()
      setStatus({ text: successText, error: false })
      reload()
    } catch (cause: unknown) {
      setStatus({ text: cause instanceof Error ? cause.message : String(cause), error: true })
    } finally {
      setBusy(false)
    }
  }

  /** 保存：当前打开的模板原地更新，未打开过则新建 */
  const save = () =>
    run(
      async () => {
        const template = doc.toTemplate(name)
        const record = currentId
          ? await api.updateTemplate(currentId, template)
          : await api.createTemplate(template)
        setCurrentId(record.id)
      },
      currentId ? '模板已保存' : '已保存为新模板',
    )

  /** 另存：无论当前状态一律新建 */
  const saveAs = () =>
    run(async () => {
      const record = await api.createTemplate(doc.toTemplate(name))
      setCurrentId(record.id)
    }, '已另存为新模板')

  /** 打开：拉取模板 JSON 还原为新文档（含区域/格样式/合并/行高列宽/绑定 sidecar） */
  const open = () =>
    run(async () => {
      const record = await api.getTemplate(openId)
      onLoaded(FormDoc.fromTemplate(record.template))
      setCurrentId(record.id)
      onNameChange(record.template.name)
    }, '模板已加载')

  return (
    <section className="card template-panel" aria-label="模板">
      <details open>
        <summary>
          模板
          <span className="chevron">›</span>
        </summary>
        <div className="card-body">
          <label className="field-col">
            <span className="field-label">模板名</span>
            <input
              type="text"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="如：销售出库单"
            />
          </label>

          <div className="button-row">
            <button
              type="button"
              className="primary"
              disabled={busy || name.trim() === ''}
              onClick={save}
              title={currentId ? '覆盖保存当前模板' : '以当前内容创建新模板'}
            >
              {currentId ? '保存' : '保存为新模板'}
            </button>
            <button
              type="button"
              disabled={busy || name.trim() === ''}
              onClick={saveAs}
              title="总是创建一份新模板"
            >
              另存
            </button>
          </div>

          <div className="button-row">
            <select
              className="grow"
              value={openId}
              aria-label="模板列表"
              onChange={(event) => setOpenId(event.target.value)}
            >
              <option value="">选择已有模板…</option>
              {templates?.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || openId === ''}
              onClick={open}
              title="加载所选模板"
            >
              打开
            </button>
          </div>

          <p className={status.error ? 'status error' : 'status'}>{status.text}</p>
        </div>
      </details>
    </section>
  )
}
