// 一键启动：并行拉起 Bun 后端与 vite 前端；任一子进程退出（或 Ctrl-C）时终止另一个，不留半边服务。
const children = [
  Bun.spawn([process.execPath, 'run', 'dev:server'], {
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  }),
  Bun.spawn([process.execPath, 'run', 'dev:web'], {
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  }),
]

function shutdown(): void {
  for (const child of children) {
    child.kill()
  }
}

process.on('SIGINT', () => {
  shutdown()
  process.exit(0)
})
process.on('SIGTERM', () => {
  shutdown()
  process.exit(0)
})

const exitCode = await Promise.race(children.map((child) => child.exited))
shutdown()
process.exit(exitCode === 0 ? 0 : 1)

export {}
