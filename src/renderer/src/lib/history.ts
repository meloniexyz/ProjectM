import type { Track } from '../../../shared/types'
import { createStore } from './store'

/** What you've played in ProjectM, across every source. Powers "Jump back in" and "Most played". */
interface Entry {
  track: Track
  count: number
  last: number
}

const KEY = 'projectm.history'
const MAX = 500

function load(): Entry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

export const historyStore = createStore<{ entries: Entry[] }>({ entries: load() })

export function recordPlay(track: Track) {
  const entries = historyStore.get().entries.slice()
  const i = entries.findIndex((e) => e.track.uid === track.uid)
  const entry = i >= 0 ? entries.splice(i, 1)[0] : { track, count: 0, last: 0 }
  entries.unshift({ track, count: entry.count + 1, last: Date.now() })
  const trimmed = entries.slice(0, MAX)
  historyStore.set({ entries: trimmed })
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed))
  } catch {
    // not critical
  }
}

/** Most recently played first. */
export const recentTracks = (entries: Entry[], n: number) => entries.slice(0, n).map((e) => e.track)

/** Most played in the last 30 days first. */
export function mostPlayed(entries: Entry[], n: number) {
  const since = Date.now() - 30 * 24 * 3600_000
  return entries
    .filter((e) => e.last >= since && e.count > 1)
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, n)
}

export function clearHistory() {
  historyStore.set({ entries: [] })
  try {
    localStorage.removeItem(KEY)
  } catch {
    // not critical
  }
}
