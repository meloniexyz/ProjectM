import type { ListenEntry, SourceId, Track } from '../../../src/shared/types'
import { createStore } from '../../../src/renderer/src/lib/store'
import { JsonFile } from './storage'

/**
 * Listening history: every play with the parts of the song you heard ("0:00–1:10, 2:05–3:00"),
 * same as the desktop app's History tab.
 */

const MAX = 5_000 // about a year of daily listening; keeps the file small enough to save often
const file = new JsonFile<ListenEntry[]>('history.json', [])
export const historyStore = createStore<{ entries: ListenEntry[] }>({ entries: [] })

export function initHistory() {
  historyStore.set({ entries: file.get() })
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const round = (v: number) => Math.round(v * 10) / 10
const heard = (segments: [number, number][]) => segments.reduce((sum, [a, b]) => sum + Math.max(0, b - a), 0)

let entry: ListenEntry | null = null
let entryKey: number | null = null
let lastPos = 0
let lastAt = 0
let dirty = false

function store() {
  if (!entry) return
  const e: ListenEntry = { ...entry, listened: round(heard(entry.segments)), endedAt: Date.now(), segments: entry.segments.map(([a, b]) => [round(a), round(b)]) }
  const list = historyStore.get().entries
  const i = list.findIndex((x) => x.id === e.id)
  const next = i >= 0 ? [...list.slice(0, i), e, ...list.slice(i + 1)] : [e, ...list].slice(0, MAX)
  historyStore.set({ entries: next })
  file.set(next)
}

/** Called by the player on every state update. */
export function trackListening(s: { key: number | null; track: Track | null; playing: boolean; position: number; duration: number; via: SourceId | null; active: boolean }) {
  if (entryKey !== null && s.key !== entryKey) {
    if (entry && dirty) store()
    entry = null
    entryKey = null
  }
  const now = Date.now()
  if (!s.track || s.key === null || !s.playing || !s.active) {
    lastAt = now
    return
  }
  if (!entry) {
    entry = {
      id: newId(),
      track: s.track,
      via: s.via,
      startedAt: now,
      endedAt: now,
      segments: [[s.position, s.position]],
      listened: 0,
      duration: s.duration || s.track.duration,
    }
    entryKey = s.key
    lastPos = s.position
    lastAt = now
    dirty = true
    store()
    return
  }
  entry.via = s.via
  if (s.duration) entry.duration = s.duration
  const seg = entry.segments[entry.segments.length - 1]
  const expected = lastPos + (now - lastAt) / 1000
  if (Math.abs(s.position - expected) > 2.5) entry.segments.push([s.position, s.position])
  else if (s.position > seg[1]) seg[1] = s.position
  lastPos = s.position
  lastAt = now
  dirty = true
}

/** Saves the current play's progress (every few seconds, and when the app goes to the background). */
export function flushListening() {
  if (entry && dirty) {
    dirty = false
    store()
  }
}

export function removeHistoryEntry(id: string) {
  const next = historyStore.get().entries.filter((e) => e.id !== id)
  historyStore.set({ entries: next })
  file.set(next)
}

export function clearHistory() {
  entry = null
  entryKey = null
  historyStore.set({ entries: [] })
  file.set([], true)
}

export const formatRanges = (segments: [number, number][], fmt: (s: number) => string) =>
  segments
    .filter(([a, b]) => b - a >= 1)
    .map(([a, b]) => `${fmt(a)}–${fmt(b)}`)
    .join(', ')

/** Recently played songs, newest first, each once. */
export function recentTracks(entries: ListenEntry[], n: number) {
  const seen = new Set<string>()
  const out: Track[] = []
  for (const e of entries) {
    if (seen.has(e.track.uid) || e.listened < 5) continue
    seen.add(e.track.uid)
    out.push(e.track)
    if (out.length >= n) break
  }
  return out
}

export interface Tally {
  key: string
  label: string
  sub?: string
  track?: Track
  artwork?: string
  plays: number
  seconds: number
}

/** Top songs / artists / albums since a time (a play counts once you've heard 30 s or half the song). */
export function stats(entries: ListenEntry[], since: number) {
  const tracks = new Map<string, Tally>()
  const artists = new Map<string, Tally>()
  const albums = new Map<string, Tally>()
  let seconds = 0
  let plays = 0
  const add = (map: Map<string, Tally>, key: string, init: Omit<Tally, 'plays' | 'seconds'>, counted: boolean, secs: number) => {
    const t = map.get(key) ?? { ...init, plays: 0, seconds: 0 }
    if (counted) t.plays++
    t.seconds += secs
    map.set(key, t)
  }
  for (const e of entries) {
    if (e.startedAt < since) break // newest first
    const counted = e.listened >= Math.min(30, (e.duration || e.track.duration || 60) / 2)
    seconds += e.listened
    if (counted) plays++
    const t = e.track
    add(tracks, t.uid, { key: t.uid, label: t.title, sub: t.artist, track: t, artwork: t.artwork }, counted, e.listened)
    const artist = t.artist.split(',')[0].trim()
    add(artists, artist.toLowerCase(), { key: artist.toLowerCase(), label: artist, artwork: t.artwork }, counted, e.listened)
    if (t.album && !/^(unknown album|youtube music|soundcloud|spotify)$/i.test(t.album)) {
      const k = `${t.album}|${t.albumArtist ?? artist}`.toLowerCase()
      add(albums, k, { key: k, label: t.album, sub: t.albumArtist ?? artist, artwork: t.artwork }, counted, e.listened)
    }
  }
  const top = (m: Map<string, Tally>) => [...m.values()].sort((a, b) => b.plays - a.plays || b.seconds - a.seconds).slice(0, 10)
  return { tracks: top(tracks), artists: top(artists), albums: top(albums), seconds, plays }
}

/** Your most played songs over the last 30 days. */
export function mostPlayed(entries: ListenEntry[], n: number) {
  return stats(entries, Date.now() - 30 * 24 * 3600_000)
    .tracks.filter((t) => t.plays > 1)
    .slice(0, n)
}
