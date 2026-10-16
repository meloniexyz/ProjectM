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

/** After history from other devices arrived: "Jump back in" and "Most played" include those plays. */
export async function rebuildFromLog() {
  const log = await window.api.history.all()
  const byUid = new Map<string, Entry>()
  for (const e of historyStore.get().entries) byUid.set(e.track.uid, { ...e })
  const counted = new Map<string, Entry>()
  for (const e of log) {
    const cur = counted.get(e.track.uid)
    counted.set(e.track.uid, { track: cur?.track ?? e.track, count: (cur?.count ?? 0) + 1, last: Math.max(cur?.last ?? 0, e.endedAt) })
  }
  for (const [uid, c] of counted) {
    const mine = byUid.get(uid)
    byUid.set(uid, mine ? { track: mine.track, count: Math.max(mine.count, c.count), last: Math.max(mine.last, c.last) } : c)
  }
  const entries = [...byUid.values()].sort((a, b) => b.last - a.last).slice(0, MAX)
  historyStore.set({ entries })
  try {
    localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    // not critical
  }
}

export function clearHistory() {
  historyStore.set({ entries: [] })
  try {
    localStorage.removeItem(KEY)
  } catch {
    // not critical
  }
}
