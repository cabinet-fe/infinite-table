// 架构页数据守卫：architecture-data.ts 里列出的值导出必须真实存在于对应包的模块
// 命名空间——页面展示与代码漂移时此处即红。类型导出无法运行时验证，靠 ts 类型检查
// （ArchitecturePage 引用处）兜底；infinitable 为纯转售层（re-export 各源包），其名册
// 正确性由 scripts/check-package-exports.mjs 与源包守卫间接覆盖，不在此重复。

import * as formulasPkg from '@infinitable/formulas'
import * as gridPkg from '@infinitable/grid'
import * as pivotPkg from '@infinitable/pivot'
import * as pluginsPkg from '@infinitable/plugins'
import * as renderPkg from '@infinitable/render'
import * as sheetPkg from '@infinitable/sheet'
import * as tablePkg from '@infinitable/table'
import { describe, expect, it } from 'vitest'

import { ARCH_PACKAGES, type ArchPackageKey } from './architecture-data'

const MODULES: Partial<Record<ArchPackageKey, Record<string, unknown>>> = {
  render: renderPkg,
  grid: gridPkg,
  table: tablePkg,
  pivot: pivotPkg,
  sheet: sheetPkg,
  formulas: formulasPkg,
  plugins: pluginsPkg,
}

describe('架构页 API 名册与真实导出一致', () => {
  it('每个包列出的 value 导出都在模块命名空间上', () => {
    for (const pkg of ARCH_PACKAGES) {
      const mod = MODULES[pkg.key]
      if (!mod) continue // infinitable：纯转售层，见文件头
      for (const api of pkg.apis) {
        if (api.kind !== 'value') continue
        expect(mod[api.name], `${pkg.name} 缺少列出的导出 ${api.name}`).toBeDefined()
      }
    }
  })

  it('依赖边引用的包 key 都存在（无悬空边）', () => {
    const keys = new Set(ARCH_PACKAGES.map((pkg) => pkg.key))
    for (const pkg of ARCH_PACKAGES) {
      for (const dep of pkg.dependsOn) {
        expect(keys.has(dep), `${pkg.name} 依赖了未登记的包 ${dep}`).toBe(true)
      }
    }
  })
})
