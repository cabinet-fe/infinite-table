import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(
  defineConfig({
    lang: 'zh-CN',
    title: 'infinitable',
    description: '高性能 canvas 表格引擎 · 多层画布失效驱动渲染 + 全量虚拟滚动',
    cleanUrls: true,
    lastUpdated: true,
    head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }]],
    vite: {
      resolve: {
        // 文档站与 playground 一致：workspace 包经 dev 条件直接吃源码。
        // 必须保留 Vite 默认条件，否则依赖会退化为未经预构建的 CJS 入口。
        conditions: ['dev', 'module', 'browser', 'development|production'],
      },
      optimizeDeps: {
        // mermaid 的依赖链含 CJS 包（dayjs / sanitize-url 等），dev 下必须预构建成 ESM
        include: [
          'mermaid',
          'dayjs',
          '@braintree/sanitize-url',
          'debug',
          'cytoscape',
          'cytoscape-cose-bilkent',
        ],
      },
    },
    markdown: {
      lineNumbers: true,
    },
    themeConfig: {
      logo: '/logo.svg',
      siteTitle: 'infinitable',
      nav: [
        { text: '指南', link: '/guide/introduction', activeMatch: '/guide/' },
        { text: 'API', link: '/api/', activeMatch: '/api/' },
        { text: '示例', link: '/examples/', activeMatch: '/examples/' },
        {
          text: 'v0.3.4',
          items: [{ text: '更新日志', link: '/changelog' }],
        },
      ],
      sidebar: {
        '/guide/': [
          {
            text: '开始',
            items: [
              { text: '介绍', link: '/guide/introduction' },
              { text: '快速开始', link: '/guide/getting-started' },
              { text: '架构总览', link: '/guide/architecture' },
            ],
          },
          {
            text: '核心概念',
            items: [
              { text: '渲染管线与失效模型', link: '/guide/rendering-pipeline' },
              { text: '数据供给与模型', link: '/guide/data-models' },
              { text: '交互与编辑', link: '/guide/interaction-editing' },
              { text: '主题与样式', link: '/guide/theming' },
              { text: '性能与虚拟滚动', link: '/guide/performance' },
            ],
          },
          {
            text: '进阶',
            items: [
              { text: '插件开发', link: '/guide/plugin-development' },
              { text: '公式引擎', link: '/guide/formulas' },
              { text: '电子表格（sheet）', link: '/guide/sheet' },
              { text: '透视表（pivot）', link: '/guide/pivot' },
            ],
          },
          {
            text: '工程',
            items: [{ text: '参与开发', link: '/guide/contributing' }],
          },
        ],
        '/api/': [
          {
            text: 'API 参考',
            items: [
              { text: '导出总览', link: '/api/' },
              { text: 'ListTable', link: '/api/list-table' },
              { text: '渲染引擎（render）', link: '/api/render' },
              { text: '共享类型与模型（grid / table）', link: '/api/grid-table' },
              { text: '公式引擎（formulas）', link: '/api/formulas' },
              { text: '插件（plugins）', link: '/api/plugins' },
              { text: '电子表格（sheet）', link: '/api/sheet' },
            ],
          },
        ],
        '/examples/': [
          {
            text: '示例',
            items: [
              { text: '示例索引', link: '/examples/' },
              { text: '基础表格', link: '/examples/basic' },
              { text: '大数据量', link: '/examples/large-data' },
              { text: '可编辑表格', link: '/examples/editing' },
              { text: '图表与图片', link: '/examples/chart' },
              { text: '打印', link: '/examples/print' },
            ],
          },
        ],
      },
      socialLinks: [{ icon: 'github', link: 'https://github.com/cabinet-fe/infinite-table' }],
      search: {
        provider: 'local',
        options: {
          translations: {
            button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
            modal: {
              noResultsText: '没有找到结果',
              resetButtonTitle: '清除查询',
              footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
            },
          },
        },
      },
      outline: { level: [2, 3], label: '本页目录' },
      docFooter: { prev: '上一篇', next: '下一篇' },
      lastUpdated: { text: '最后更新于' },
      returnToTopLabel: '回到顶部',
      sidebarMenuLabel: '菜单',
      darkModeSwitchLabel: '主题',
      lightModeSwitchTitle: '切换到浅色模式',
      darkModeSwitchTitle: '切换到深色模式',
    },
  }),
)
