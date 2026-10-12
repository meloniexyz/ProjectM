import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import './skin-feishin.css'
import * as player from './lib/player'
import { curveThrough, eqResponse, finalLevel, loudnessDebug, outputMeanSquare } from './lib/loudness'
import { getSettings, settingsStore, updateSettings } from './lib/settings'
import { applyTheme, themeById } from './lib/themes'
import { applyAppIcon } from './lib/logos'

// small hook for troubleshooting from DevTools (F12)
;(window as unknown as Record<string, unknown>).projectm = {
  player,
  loudnessDebug,
  outputMeanSquare,
  finalLevel,
  eqResponse,
  curveThrough,
  settings: { get: getSettings, update: updateSettings },
}

import { initSettings } from './lib/settings'

initSettings()
  .catch(() => {}) // defaults are fine if this fails
  .finally(() => {
    const apply = () => applyTheme(getSettings().theme, getSettings().accent)
    const applyIcon = () => {
      const s = getSettings()
      applyAppIcon(s.logo, s.accent ?? themeById(s.theme).accent, s.theme).catch(() => {})
    }
    apply()
    applyIcon()
    let last = `${getSettings().theme}|${getSettings().accent}`
    let lastIcon = `${getSettings().theme}|${getSettings().accent}|${getSettings().logo}`
    settingsStore.subscribe(() => {
      const key = `${getSettings().theme}|${getSettings().accent}`
      if (key !== last) {
        last = key
        apply()
      }
      const icon = `${getSettings().theme}|${getSettings().accent}|${getSettings().logo}`
      if (icon !== lastIcon) {
        lastIcon = icon
        applyIcon()
      }
    })
    createRoot(document.getElementById('root')!).render(<App />)
  })
