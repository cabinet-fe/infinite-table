// playground 主入口：React 19 驱动的示例应用（深色侧栏分组导航 + hash 路由示例视图 + vs VTable 对比页）。
// 样式单一入口 styles/global.css：Tailwind v4 + shadcn tokens + sections 演示区容器组件类。
// ?smoke=1 时 App 切换到页内自检挂载并运行冒烟（写 window.__SMOKE__ 供 scripts/smoke.mjs 轮询）。

import { createRoot } from 'react-dom/client'

import { App } from './app/App'
import './styles/global.css'

const container = document.getElementById('app')
if (container) {
  createRoot(container).render(<App />)
}
