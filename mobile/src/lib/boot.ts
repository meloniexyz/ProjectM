import { initAccounts } from './accounts'
import { initDownloads } from './downloads'
import { initHistory } from './history'
import { initLibrary } from './library'
import { startNetworkWatch } from './net'
import { startPlayer } from './player'
import { initSettings } from './settings'
import { youtube } from './sources'
import { ensureDirs } from './storage'

let booted = false

/** Loads saved data and starts the background parts, once, before the first screen renders. */
export function boot() {
  if (booted) return
  booted = true
  ensureDirs()
  initSettings()
  initHistory()
  startNetworkWatch()
  initLibrary()
  initAccounts()
  initDownloads()
  startPlayer()
  // get YouTube's playback token while the app is in front (it lasts hours)
  setTimeout(() => youtube.warmUp(), 1500)
}
