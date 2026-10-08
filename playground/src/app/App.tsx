// 应用组合根：?smoke=1 走页内自检挂载（无壳），否则渲染侧栏 + 顶栏 + 路由内容区。

import { isSmokeMode } from '../mount'
import { AppShell } from './AppShell'
import { SmokeMode } from './SmokeMode'

export function App() {
  if (isSmokeMode()) {
    return <SmokeMode />
  }
  return <AppShell />
}
