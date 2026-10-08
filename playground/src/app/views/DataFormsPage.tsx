// 数据供给三形态：records/columns 数组、按格 hook、模型事件订阅（含表格回驱防回环）。

import { mountDataForms } from '../../sections/data-forms'
import { SectionPage } from '../SectionPage'

export function DataFormsPage() {
  return (
    <SectionPage
      title="数据供给三形态"
      tags={['Records 数组', '格级 Hook', 'Model 事件驱动', '防回环机制']}
      desc="演示三种核心数据供给方式：静态 records/columns 数组（5000 行）、按格 hook 纯函数同步 O(1) 计算、以及响应式模型（TableModel）事件驱动局部刷新与回驱防回环机制。"
      mount={mountDataForms}
    />
  )
}
