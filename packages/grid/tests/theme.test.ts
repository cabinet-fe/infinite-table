import type { EngineTheme, EngineThemeOverride } from '@infinitable/protocol'
import { describe, expect, it } from 'vitest'

import { defaultTheme, extendsTheme, type TableTheme, type ThemeOverride } from '../src/theme'

describe('theme 与 protocol 契约对齐', () => {
  it('TableTheme 与 ThemeOverride 分别兼容 EngineTheme 与 EngineThemeOverride', () => {
    const engineTheme: EngineTheme = defaultTheme
    const override: ThemeOverride = {
      underlayBackgroundColor: '#fafafa',
      frameStyle: { lineWidth: 1, shadow: true },
      interaction: { scrollbarSize: 12 },
    }
    const engineOverride: EngineThemeOverride = override
    const derived: TableTheme = extendsTheme(override)

    expect(engineTheme.underlayBackgroundColor).toBe('#ffffff')
    expect(engineOverride.underlayBackgroundColor).toBe('#fafafa')
    expect(derived.interaction.scrollbarSize).toBe(12)
  })
})
