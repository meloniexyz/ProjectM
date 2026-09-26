import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import * as player from './lib/player'
import { curveThrough, eqResponse, loudnessDebug, outputMeanSquare } from './lib/loudness'
import { getSettings, updateSettings } from './lib/settings'

// small hook for troubleshooting from DevTools (F12)
;(window as unknown as Record<string, unknown>).projectm = {
  player,
  loudnessDebug,
  outputMeanSquare,
  eqResponse,
  curveThrough,
  settings: { get: getSettings, update: updateSettings },
}

import { initSettings } from './lib/settings'

initSettings()
  .catch(() => {}) // defaults are fine if this fails
  .finally(() => createRoot(document.getElementById('root')!).render(<App />))
