// 架构页数据守卫：依赖边无悬空引用、每包叙事字段完整（这层是什么 / 详细作用 /
// 典型场景 / 扩展举例 / 不做什么）——页面展示与代码漂移时此处即红。架构页不列
// API 名册，导出正确性由各包自身测试与 check-package-exports 覆盖，不在此重复。

import { describe, expect, it } from 'vitest'

import { ARCH_PACKAGES, ARCH_WALKTHROUGHS } from './architecture-data'

describe('架构页数据完整性', () => {
  it('依赖边引用的包 key 都存在（无悬空边）', () => {
    const keys = new Set(ARCH_PACKAGES.map((pkg) => pkg.key))
    for (const pkg of ARCH_PACKAGES) {
      for (const dep of pkg.dependsOn) {
        expect(keys.has(dep), `${pkg.name} 依赖了未登记的包 ${dep}`).toBe(true)
      }
    }
  })

  it('每个包的叙事字段完整（角色 / 作用 / 场景 / 扩展 / 边界）', () => {
    for (const pkg of ARCH_PACKAGES) {
      expect(pkg.role.trim().length, `${pkg.name} 缺少角色叙事`).toBeGreaterThan(0)
      expect(pkg.responsibilities.length, `${pkg.name} 详细作用为空`).toBeGreaterThan(0)
      expect(pkg.scenarios.length, `${pkg.name} 典型场景为空`).toBeGreaterThan(0)
      expect(pkg.extensions.length, `${pkg.name} 扩展举例为空`).toBeGreaterThan(0)
      expect(pkg.boundaries.length, `${pkg.name} 边界为空`).toBeGreaterThan(0)
    }
  })

  it('每个场景走读都有问题、步骤与锚点', () => {
    for (const walkthrough of ARCH_WALKTHROUGHS) {
      expect(walkthrough.question.trim().length, `${walkthrough.title} 缺少问题`).toBeGreaterThan(0)
      expect(walkthrough.steps.length, `${walkthrough.title} 步骤为空`).toBeGreaterThan(0)
      expect(walkthrough.takeaway.trim().length, `${walkthrough.title} 缺少锚点`).toBeGreaterThan(0)
    }
  })
})
