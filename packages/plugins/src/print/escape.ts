// 打印 HTML 转义助手（P2 页面构建与页眉页脚共用）：纯函数零 DOM。

/** HTML 文本转义（内容嵌入位） */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** HTML 属性值转义（双引号属性位；先过文本转义再补引号） */
export function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;')
}
