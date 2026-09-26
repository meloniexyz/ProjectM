import type { ListenEntry } from '../../../shared/types'
import { getPlayer, subscribePlayer } from './player'
import { createStore } from './store'

/**
 * Listening log: records every play with the parts of the song actually heard.
 *
 * A play starts when a song really starts playing and ends when another song takes over.
 * Pausing keeps the same play; seeking closes the current part and starts a new one, so a play
 * reads like "0:00–1:10, 2:05–3:00".
 */

/** Bumped whenever the log changes, so open History/Stats pages can refresh. */
export const listenLogStore = createStore<{ version: number }>({ version: 0 })
const bump = () => listenLogStore.set((s) => ({ version: s.version + 1 }))

let entry: ListenEntry | null = null
let entryKey: number | null = null // queue item the entry belongs to
let lastPos = 0
let lastAt = 0 // performance.now() of lastPos
let dirty = false
let saveTimer = 0

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const round = (v: number) => Math.round(v * 10) / 10

function heard(segments: [number, number][]) {
  return segments.reduce((sum, [a, b]) => sum + Math.max(0, b - a), 0)
}

function save(force = false) {
  if (!entry || (!dirty && !force)) return
  dirty = false
  entry.listened = round(heard(entry.segments))
  entry.endedAt = Date.now()
  window.api.history.upsert({ ...entry, segments: entry.segments.map(([a, b]) => [round(a), round(b)]) }).catch(() => {})
  bump()
}

function finish() {
  if (entry) save(true)
  entry = null
  entryKey = null
}

function onPlayerChange() {
  const s = getPlayer()
  const item = s.queue[s.index]

  // a different song took over: close the previous play
  if (entryKey !== null && item?.key !== entryKey) finish()
  if (!item || !s.playing) {
    lastAt = performance.now()
    return
  }

  const pos = s.position
  const now = performance.now()

  if (!entry) {
    // start once this song's audio is really attached (ignores the previous song's last updates)
    if (s.activeKey !== item.key) return
    entry = {
      id: newId(),
      track: item.track,
      via: s.via,
      startedAt: Date.now(),
      endedAt: Date.now(),
      segments: [[pos, pos]],
      listened: 0,
      duration: s.duration || item.track.duration,
    }
    entryKey = item.key
    lastPos = pos
    lastAt = now
    dirty = true
    save()
    return
  }

  if (s.activeKey !== item.key) return
  entry.via = s.via
  if (s.duration) entry.duration = s.duration
  const seg = entry.segments[entry.segments.length - 1]
  const expected = lastPos + (now - lastAt) / 1000
  // a jump the clock can't explain = a seek (or repeat): start a new part
  if (Math.abs(pos - expected) > 2.5) entry.segments.push([pos, pos])
  else if (pos > seg[1]) seg[1] = pos
  lastPos = pos
  lastAt = now
  dirty = true
}

let started = false
export function startListenLog() {
  if (started) return
  started = true
  subscribePlayer(onPlayerChange)
  // write progress every few seconds, and when the window closes
  saveTimer = window.setInterval(() => save(), 5000)
  window.addEventListener('beforeunload', () => save(true))
}

export function stopListenLog() {
  clearInterval(saveTimer)
}

export const formatRanges = (segments: [number, number][], fmt: (s: number) => string) =>
  segments
    .filter(([a, b]) => b - a >= 1)
    .map(([a, b]) => `${fmt(a)}–${fmt(b)}`)
    .join(', ')
