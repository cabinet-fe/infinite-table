import { useState } from 'react'

import { DataManager } from './data/DataManager'
import { DesignerPage } from './designer/DesignerPage'
import { IconBrand } from './ui/icons'

/**
 * 应用壳：全屏三段式（顶栏 + 设计页自带工具条 + 主体）。
 * 两个视图都常驻挂载、用 hidden 切换——切到数据视图再切回来，画布内容与表单状态都不丢
 * （画布在重新可见时经引擎自身 ResizeObserver 按容器尺寸重排）。
 */
export function App() {
  const [view, setView] = useState<'design' | 'data'>('design')
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <IconBrand size={17} />
          </span>
          <span className="brand-title">打印单设计器</span>
          <span className="badge">示例</span>
        </div>
        <div className="segmented" role="group" aria-label="视图切换">
          <button type="button" aria-pressed={view === 'design'} onClick={() => setView('design')}>
            设计
          </button>
          <button type="button" aria-pressed={view === 'data'} onClick={() => setView('data')}>
            数据
          </button>
        </div>
      </header>

      <div className="view-panel" hidden={view !== 'design'}>
        <DesignerPage />
      </div>
      <div className="view-panel" hidden={view !== 'data'}>
        <DataManager />
      </div>
    </div>
  )
}
