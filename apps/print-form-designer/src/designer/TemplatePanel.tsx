// 模板面板：保存（有当前模板则更新、否则新建）/ 另存（强制新建）/ 模板列表打开。
// 序列化与还原共用 FormDoc.toTemplate / fromTemplate 入口，画布还原由 DesignerPage
// 替换 doc 驱动；round-trip 等价由 app 内测试守住。
import { useCallback, useEffect, useState } from 'react'

import { api, type TemplateSummary } from '../data/api'
import { FormDoc } from './form-doc'

interface Props {
  doc: FormDoc
  /** 模板加载完成：以还原出的新文档替换当前 doc（画布随之重建） */
  onLoaded: (doc: FormDoc) => void
}

export function TemplatePanel({ doc, onLoaded }: Props) {
  const [name, setName] = useState('')
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
      currentId ? '模板已保存' : '模板已保存（新建）',
    )

  /** 另存：无论当前状态一律新建 */
  const saveAs = () =>
    run(async () => {
      const record = await api.createTemplate(doc.toTemplate(name))
      setCurrentId(record.id)
    }, '已另存为新模板')

  /** 打开：拉取模板 JSON 还原为新文档（含波段/格样式/合并/行高列宽/绑定 sidecar） */
  const open = () =>
    run(async () => {
      const record = await api.getTemplate(openId)
      onLoaded(FormDoc.fromTemplate(record.template))
      setCurrentId(record.id)
      setName(record.template.name)
    }, '模板已加载')

  return (
    <section className="panel toolbar template-panel">
      <h2>模板</h2>
      <div className="toolbar-row">
        <label>
          模板名{' '}
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="如：出库单"
          />
        </label>
        <button className="primary" disabled={busy || name.trim() === ''} onClick={save}>
          {currentId ? '保存' : '保存（新建）'}
        </button>
        <button disabled={busy || name.trim() === ''} onClick={saveAs}>
          另存
        </button>
        <span className="toolbar-sep" />
        <label>
          模板列表{' '}
          <select value={openId} onChange={(event) => setOpenId(event.target.value)}>
            <option value="">选择模板…</option>
            {templates?.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy || openId === ''} onClick={open}>
          打开
        </button>
      </div>
      <p className={status.error ? 'status error' : 'status'}>{status.text}</p>
    </section>
  )
}
