/**
 * workspace: / catalog: 协议残留校验。
 *
 * bun 仓库的 `changeset publish` 底层是 `npm publish <包目录>`，不会展开这两种协议，
 * 原样发布就是坏元数据。CI 改写 manifest 后（normalize-manifest.ts）与本地发版的
 * 构建测试阶段（release.ts）共用本模块的判定。
 */

/** package.json 中可以声明依赖的四个字段 */
const DEPENDENCY_FIELDS = [
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
  'devDependencies',
] as const

type DependencyField = (typeof DEPENDENCY_FIELDS)[number]

export interface Manifest {
  name?: string
  [field: string]: unknown
}

/** 依赖范围是否仍写着 workspace: / catalog: 协议 */
function isWorkspaceProtocol(range: unknown): boolean {
  return typeof range === 'string' && /^(workspace|catalog)(:|$)/.test(range)
}

/**
 * 列出仍使用 workspace: / catalog: 协议的依赖，形如 `dependencies.foo`。
 * `skipFields` 排除发布前会被整体剥离的字段（如 devDependencies）。
 */
export function findWorkspaceProtocolDeps(
  manifest: Manifest,
  skipFields: readonly DependencyField[] = [],
): string[] {
  const leftovers: string[] = []
  for (const field of DEPENDENCY_FIELDS) {
    if (skipFields.includes(field)) continue
    const deps = manifest[field]
    if (deps === undefined || deps === null) continue
    for (const [dep, range] of Object.entries(deps as Record<string, unknown>)) {
      if (isWorkspaceProtocol(range)) leftovers.push(`${field}.${dep}`)
    }
  }
  return leftovers
}
