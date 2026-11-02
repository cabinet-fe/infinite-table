import { useState } from 'react'

import { DataManager } from './data/DataManager'
import { DesignerPage } from './designer/DesignerPage'

// 应用壳：设计画布（P3）与数据管理（P2）两个视图；打印弹框在后续阶段挂入。
export function App() {
  const [view, setView] = useState<'design' | 'data'>('design')
  return (
    <main className="shell shell-wide">
      <header className="app-header">
        <h1>打印单设计器</h1>
        <nav className="view-switch">
          <button className={view === 'design' ? 'primary' : ''} onClick={() => setView('design')}>
            设计
          </button>
          <button className={view === 'data' ? 'primary' : ''} onClick={() => setView('data')}>
            数据
          </button>
        </nav>
      </header>
      {view === 'design' ? <DesignerPage /> : <DataManager />}
    </main>
  )
}
