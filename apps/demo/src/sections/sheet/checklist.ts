// 功能对照表：对标 ultra-ui playground sheet 的功能面，逐项标注实现方式（随 demo 展示）。

export interface ChecklistItem {
  feature: string
  done: boolean
  how: string
}

export const SHEET_CHECKLIST: readonly ChecklistItem[] = [
  {
    feature: '公式栏（值显示/提交/编辑镜像）',
    done: true,
    how: 'Store 读写 + onEditStart/onEditEnd（S1 事件）镜像',
  },
  { feature: '公式显示（编辑见 = 原文）', done: true, how: 'createFormulaDisplay + mini 求值器' },
  { feature: '函数建议', done: true, how: '公式栏静态函数集合（SUM/AVERAGE/COUNT/MIN/MAX）' },
  {
    feature: 'sheet tabs（切换/新建/删除）',
    done: true,
    how: 'SheetBook 实例池 + 容器显隐（切换全量重挂）',
  },
  {
    feature: '右键菜单（插入/删除行列/清空/合并）',
    done: true,
    how: 'onContextMenu + Store 结构操作 + 运行时 setMergeCells',
  },
  {
    feature: '样式工具栏（字型/对齐/填充/边框/清除）',
    done: true,
    how: 'Store 格级样式 + resolveCellStyle hook + batchUpdate 刷新',
  },
  { feature: '查找替换', done: true, how: 'Store 扫描 + selectCell/scrollToCell + 批量替换' },
  {
    feature: '冻结/合并运行时面板',
    done: true,
    how: 'Store setFrozen/setMerges + setFrozenColCount/setMergeCells',
  },
  {
    feature: '填充柄真实生成',
    done: true,
    how: 'bindFillGeneration（generateFill）+ batchUpdate 收敛',
  },
  { feature: 'resize 持久化', done: true, how: 'onColResizeEnd/onRowResizeEnd → Store 尺寸覆盖' },
  { feature: 'CSV 导入导出', done: true, how: 'Store 值矩阵转换（引号转义/解析覆盖）' },
  {
    feature: '撤销/重做（值命令）',
    done: true,
    how: 'bindCellChangeUndo + UndoStack（结构命令未覆盖，宿主可扩展）',
  },
  { feature: '整行/整列表头高亮', done: true, how: '引擎 interaction.headerHighlight token（S1）' },
  {
    feature: '选区双向同步（外部模型）',
    done: false,
    how: 'bindSelectionSync 控制器（插件已提供，本 demo 未接线演示）',
  },
  { feature: '格内图片', done: true, how: 'resolveCellImage + media 层无闪协议（P7）' },
  { feature: 'editCellOnEnter（Enter 进编辑）', done: true, how: 'excelKeymapPreset 键位预设' },
]

/** 渲染对照表（插入 section 末尾） */
export function mountChecklist(section: HTMLElement): void {
  const details = document.createElement('details')
  details.className = 'sheet-checklist'
  const doneCount = SHEET_CHECKLIST.filter((item) => item.done).length
  const summary = document.createElement('summary')
  summary.textContent = `功能对照（对标 ultra-ui playground sheet，${doneCount}/${SHEET_CHECKLIST.length} 项已落地）`
  const table = document.createElement('table')
  const header = document.createElement('tr')
  for (const text of ['功能', '实现方式']) {
    const th = document.createElement('th')
    th.textContent = text
    header.appendChild(th)
  }
  table.appendChild(header)
  for (const item of SHEET_CHECKLIST) {
    const row = document.createElement('tr')
    const featureCell = document.createElement('td')
    featureCell.textContent = `${item.done ? '✅' : '⬜'} ${item.feature}`
    const howCell = document.createElement('td')
    howCell.textContent = item.how
    row.append(featureCell, howCell)
    table.appendChild(row)
  }
  details.append(summary, table)
  section.appendChild(details)
}
