import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import * as player from './lib/player'
import { loudnessDebug } from './lib/loudness'

// small hook for troubleshooting from DevTools (F12)
;(window as unknown as Record<string, unknown>).projectm = { player, loudnessDebug }

import { initSettings } from './lib/settings'

initSettings()
  .catch(() => {}) // defaults are fine if this fails
  .finally(() => createRoot(document.getElementById('root')!).render(<App />))
