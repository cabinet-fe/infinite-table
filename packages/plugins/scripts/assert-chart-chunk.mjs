// 构建产物断言（build 链最后一步）：未启用图表插件时，plugins 主产物不含 chart.js 代码。
// chart.js 只经 src/chart/chart-loader.ts 的动态 import 引入 → rollup 独立分包，主 chunk
// 仅以 import("./chart-<hash>.js") 引用该分包。以 chart.js 运行时生命周期钩子名
// 'beforeInit'（压缩后仍保留的字符串字面量）为特征串：主产物出现即判定被静态混入。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const MAIN = join(DIST, 'plugins.js')
/** chart.js 运行时特征串（生命周期钩子名字面量，主产物不允许出现） */
const MARKER = 'beforeInit'

const main = readFileSync(MAIN, 'utf8')
if (main.includes(MARKER)) {
  console.error(
    '构建产物断言失败：dist/plugins.js 含 chart.js 代码（chart.js 被静态引入，未走动态 import 分包）',
  )
  process.exit(1)
}

const chunks = [...main.matchAll(/import\(["'](\.\/[^"']+)["']\)/g)].map((match) => match[1])
const chartChunk = chunks.find((name) => readFileSync(join(DIST, name), 'utf8').includes(MARKER))
if (!chartChunk) {
  console.error(
    `构建产物断言失败：主产物动态分包中未找到 chart.js 代码（动态引用：${chunks.join(', ') || '无'}）`,
  )
  process.exit(1)
}

console.log(
  `assert-chart-chunk 通过：chart.js 独立分包于 dist/${chartChunk.replace(/^\.\//, '')}，主产物不含 chart.js 代码`,
)
