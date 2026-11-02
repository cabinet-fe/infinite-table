import { DataManager } from './data/DataManager'

// 应用壳：数据管理页（P2）已挂入；设计画布（P3）与打印弹框在后续阶段挂入。
export function App() {
  return (
    <main className="shell">
      <header className="app-header">
        <h1>打印单设计器</h1>
      </header>
      <DataManager />
    </main>
  )
}
