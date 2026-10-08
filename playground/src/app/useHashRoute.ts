// hash 路由：监听 hashchange，非法 hash（含外链 key bench）回落 home；导航 = 写 #/<key> 后由事件回流驱动渲染。

import { useCallback, useEffect, useState } from 'react'

import { PAGE_KEYS, type PageKey } from './nav'

const HOME: PageKey = 'home'

/** 解析 location.hash 为合法页面 key，非法值回落 home */
export function parseHash(hash: string): PageKey {
  const key = hash.replace(/^#\/?/, '')
  return PAGE_KEYS.includes(key as PageKey) ? (key as PageKey) : HOME
}

/** 导航到指定路由 key（写 hash，hashchange 回流驱动渲染） */
export function navigateTo(key: PageKey): void {
  location.hash = `#/${key}`
}

export function useHashRoute(): readonly [PageKey, (key: PageKey) => void] {
  const [active, setActive] = useState<PageKey>(() => parseHash(location.hash))

  useEffect(() => {
    const onHashChange = (): void => setActive(parseHash(location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = useCallback(navigateTo, [])

  return [active, navigate] as const
}
