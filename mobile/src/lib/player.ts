import { AppState } from 'react-native'
import { useSyncExternalStore } from 'react'
import type { SourceId, Track } from '../../../src/shared/types'
import { shuffled } from '../../../src/renderer/src/lib/format'
import { NativeAudio, type NativeTrack } from '../../modules/projectm-audio'
import { atLeast, ensureOnPhone, lookup, setGain, touch, trimCache, fileUri } from './audioCache'
import { eqFilters } from './eq'
import { flushListening, trackListening } from './history'
import { localUri } from './library'
import { canStream, streamQuality } from './net'
import { getSettings, LOUDNESS_LUFS, settingsStore } from './settings'
import { cleanError, SOURCES, youtube } from './sources'
import { JsonFile } from './storage'
import { toast } from './ui'

export interface QueueItem {
  /** unique per queue entry, so the same song can be queued twice */
  key: number
  track: Track
}
export type Repeat = 'off' | 'all' | 'one'

export interface PlayerState {
  queue: QueueItem[]
  index: number
  playing: boolean
  /** getting the song ready (downloading / opening) */
  loading: boolean
  position: number
  duration: number
  shuffle: boolean
  repeat: Repeat
  error: string | null
  /** what's playing, e.g. "AAC · 128 kbps" (plus "saved" when it came from the phone) */
  quality: string | null
  /** set when a Spotify song plays from YouTube Music / SoundCloud */
  via: SourceId | null
  /** queue item whose audio is in the player (null while switching) */
  activeKey: number | null
}

const saved = new JsonFile<{ queue: Track[]; index: number; position: number; shuffle: boolean; repeat: Repeat }>('player.json', {
  queue: [],
  index: -1,
  position: 0,
  shuffle: false,
  repeat: 'off',
})

let keySeq = 1
const wrap = (tracks: Track[]): QueueItem[] => tracks.map((track) => ({ key: keySeq++, track }))

let state: PlayerState = {
  queue: [],
  index: -1,
  playing: false,
  loading: false,
  position: 0,
  duration: 0,
  shuffle: false,
  repeat: 'off',
  error: null,
  quality: null,
  via: null,
  activeKey: null,
}
const listeners = new Set<() => void>()

function emit(patch: Partial<PlayerState>, persist = false) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
  const cur = state.queue[state.index]
  trackListening({
    key: cur?.key ?? null,
    track: cur?.track ?? null,
    playing: state.playing,
    position: state.position,
    duration: state.duration,
    via: state.via,
    active: state.activeKey !== null && state.activeKey === cur?.key,
  })
  if (persist) save()
}

function save() {
  saved.set({
    queue: state.queue.map((q) => q.track),
    index: state.index,
    position: Math.round(state.position),
    shuffle: state.shuffle,
    repeat: state.repeat,
  })
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
export function usePlayer<T>(select: (s: PlayerState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state))
}
export const getPlayer = () => state
export const currentTrack = () => state.queue[state.index]?.track ?? null

// ---------- native engine ----------

/** Native calls run one at a time, in order. */
let chain: Promise<unknown> = Promise.resolve()
function nat<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => {})
  return run
}

/** What the native player is told each song is: queue key + a counter (repeat-one queues the same key again). */
let enqueueSeq = 0
const nativeId = (key: number) => `${key}:${++enqueueSeq}`
const keyOf = (id?: string) => (id ? Number(id.split(':')[0]) : NaN)

/** Song details for display, per native id. */
const prepared = new Map<string, { quality: string; via: SourceId | null }>()

/** measured loudness (gain to -14 LUFS) for songs that don't publish it */
const loudness = new JsonFile<Record<string, number>>('loudness.json', {})
const DEFAULT_GAIN = -3 // unknown songs start a little quieter until measured

async function measure(uid: string, uri: string) {
  const lufs = await NativeAudio.measureLoudness(uri).catch(() => null)
  if (lufs == null || !Number.isFinite(lufs)) return null
  const gain = Math.max(-15, Math.min(9, -14 - lufs))
  loudness.set({ ...loudness.get(), [uid]: Math.round(gain * 10) / 10 })
  setGain(uid, gain)
  return gain
}

class OfflineError extends Error {}

/** Can this song play right now without the network? */
export function availableNow(t: Track) {
  if (t.source === 'local') return !!localUri(t.id)
  return canStream() || !!lookup(t.uid)
}

/** Gets a song onto the phone (if needed) and describes it for the native player. */
async function prepare(item: QueueItem, purpose: 'play' | 'prefetch'): Promise<NativeTrack> {
  const t = item.track
  let uri: string
  let gain: number | undefined
  let quality: string
  let via: SourceId | null = null

  if (t.source === 'local') {
    const u = localUri(t.id)
    if (!u) throw new Error('This file is no longer on the phone')
    uri = u
    gain = t.gainDb ?? loudness.get()[t.uid]
    quality = (t.id && uri.split('.').pop()?.toUpperCase()) || 'Local file'
  } else {
    const want = streamQuality()
    let entry = lookup(t.uid)
    const usable = entry && (entry.pinned || atLeast(entry.quality, want) || !canStream())
    if (!usable) {
      if (!canStream()) throw new OfflineError(getSettings().offlineMode ? "Offline mode: this song isn't downloaded" : "You're offline and this song isn't saved on the phone")
      entry = await ensureOnPhone(t, want)
      trimCache(getSettings().cacheLimitMb * 1e6, protectedUids())
    }
    uri = fileUri(entry!)
    gain = entry!.gainDb ?? loudness.get()[t.uid]
    quality = `${entry!.label}${entry!.pinned ? ' · downloaded' : ''}`
    via = entry!.via ?? null
  }

  if (gain == null) {
    // prefetched songs have time to be measured before they play; others start a bit quieter
    if (purpose === 'prefetch') gain = (await measure(t.uid, uri)) ?? DEFAULT_GAIN
    else {
      gain = DEFAULT_GAIN
      void measure(t.uid, uri)
    }
  }
  const id = nativeId(item.key)
  prepared.set(id, { quality, via })
  return { id, uri, title: t.title, artist: t.artist, album: t.album, artwork: t.artwork, duration: t.duration, gainDb: gain }
}

/** Current and next songs: never cleared from the cache to make room. */
function protectedUids() {
  const s = new Set<string>()
  const cur = state.queue[state.index]
  if (cur) s.add(cur.track.uid)
  const ni = nextIndex()
  if (ni >= 0) s.add(state.queue[ni].track.uid)
  return s
}

/** Index of what plays after `from` (respecting repeat; offline: only songs on the phone). */
function nextIndex(from = state.index, includeSelfRepeat = true): number {
  const n = state.queue.length
  if (!n || from < 0) return -1
  if (state.repeat === 'one' && includeSelfRepeat) return from
  for (let step = 1; step <= n; step++) {
    let i = from + step
    if (i >= n) {
      if (state.repeat !== 'all') return -1
      i %= n
    }
    if (availableNow(state.queue[i].track)) return i
    if (i === from) return -1
  }
  return -1
}

let loadSeq = 0
let loadedKey: number | null = null
let resumeAt = 0
let resumeKey: number | null = null

async function load(autoplay: boolean) {
  const item = state.queue[state.index]
  const seq = ++loadSeq
  if (!item) {
    loadedKey = null
    await nat(() => NativeAudio.stop())
    emit({ playing: false, loading: false, position: 0, duration: 0, activeKey: null }, true)
    return
  }
  loadedKey = item.key
  const startAt = item.key === resumeKey ? resumeAt : 0
  resumeAt = 0
  resumeKey = null
  emit({ position: startAt, duration: item.track.duration, error: null, loading: true, via: null, quality: null, activeKey: null }, true)
  // switching songs from the lock screen: keep the app awake while the next one downloads
  if (AppState.currentState !== 'active') void nat(() => NativeAudio.holdSilence(true))

  let nt: NativeTrack
  try {
    nt = await prepare(item, 'play')
  } catch (err) {
    if (seq === loadSeq) fail(item, err)
    return
  }
  if (seq !== loadSeq) return
  try {
    await nat(() => NativeAudio.play(nt, startAt, autoplay))
  } catch (err) {
    if (seq === loadSeq) fail(item, err)
    return
  }
  if (seq !== loadSeq) return
  const meta = prepared.get(nt.id)
  emit({ activeKey: item.key, loading: false, playing: autoplay, quality: meta?.quality ?? null, via: meta?.via ?? null })
  if (item.track.source !== 'local') touch(item.track.uid)
  void prefetch()
}

function fail(item: QueueItem, err: unknown) {
  const e = cleanError(err)
  emit({ error: e.message, playing: false, loading: false })
  toast(`Couldn't play "${item.track.title}": ${e.message}`)
  const ni = nextIndex(state.index, false)
  if (ni >= 0 && ni !== state.index) {
    const seq = loadSeq
    setTimeout(() => {
      if (seq !== loadSeq) return
      emit({ index: ni }, true)
      load(true)
    }, err instanceof OfflineError ? 50 : 1200)
  }
}

/** Downloads what comes next and hands it to the native player for a gapless start. */
let prefetchSeq = 0
async function prefetch() {
  const mine = ++prefetchSeq
  const ni = nextIndex()
  if (ni < 0) {
    await nat(() => NativeAudio.setNext(null))
    return
  }
  const item = state.queue[ni]
  try {
    const nt = await prepare(item, 'prefetch')
    if (mine !== prefetchSeq || state.queue[nextIndex()]?.key !== item.key || loadedKey !== state.queue[state.index]?.key) return
    await nat(() => NativeAudio.setNext(nt))
  } catch (err) {
    console.warn('[player] prefetch', item.track.title, cleanError(err).message)
    return
  }
  // on Wi-Fi, also get the one after (data is free there); on mobile data only the next song
  const after = nextIndex(ni, false)
  if (after >= 0 && after !== state.index && streamQuality() === getSettings().wifiQuality && canStream()) {
    const t = state.queue[after].track
    if (t.source !== 'local' && !lookup(t.uid)) ensureOnPhone(t, streamQuality()).catch(() => {})
  }
}

// ---------- native events ----------

let started = false
export function startPlayer() {
  if (started) return
  started = true
  const s = saved.get()
  const queue = wrap(s.queue ?? [])
  const index = Math.min(s.index ?? -1, queue.length - 1)
  state = { ...state, queue, index, shuffle: !!s.shuffle, repeat: s.repeat ?? 'off', position: s.position ?? 0, duration: queue[index]?.track.duration ?? 0 }
  resumeAt = (s.position ?? 0) > 2 ? s.position : 0
  resumeKey = queue[index]?.key ?? null

  NativeAudio.addListener('onState', (n) => {
    const key = keyOf(n.id)
    if (n.id && key === state.activeKey) emit({ position: n.position, duration: n.duration || state.duration, playing: n.playing })
    else if (!n.id && !state.loading) emit({ playing: n.playing && state.activeKey !== null })
  })
  NativeAudio.addListener('onTrackChange', ({ id }) => {
    const key = keyOf(id)
    const idx = state.queue.findIndex((q) => q.key === key)
    if (idx < 0) return
    loadedKey = key
    const meta = prepared.get(id)
    emit({ index: idx, activeKey: key, position: 0, duration: state.queue[idx].track.duration, loading: false, error: null, quality: meta?.quality ?? null, via: meta?.via ?? null }, true)
    const t = state.queue[idx].track
    if (t.source !== 'local') touch(t.uid)
    void prefetch()
  })
  NativeAudio.addListener('onEnded', ({ id }) => {
    if (keyOf(id) !== state.activeKey) return
    const ni = nextIndex()
    if (ni >= 0) {
      emit({ index: ni }, true)
      load(true)
    } else {
      loadedKey = null // play again restarts the song
      emit({ playing: false, position: 0, activeKey: null })
      void nat(() => NativeAudio.holdSilence(false))
    }
  })
  NativeAudio.addListener('onRemote', ({ command }) => {
    if (command === 'next') next()
    else if (command === 'previous') prev()
    else if (command === 'play') emit({ playing: true })
    else if (command === 'pause') emit({ playing: false })
  })
  NativeAudio.addListener('onError', ({ id, message }) => {
    const item = state.queue.find((q) => q.key === keyOf(id))
    if (item && item.key === state.activeKey) fail(item, new Error(message))
  })

  applyAudioSettings()
  let last = getSettings()
  settingsStore.subscribe(() => {
    const cur = getSettings()
    if (cur.eq !== last.eq || cur.normalize !== last.normalize || cur.loudnessLevel !== last.loudnessLevel) applyAudioSettings()
    if (cur.offlineMode !== last.offlineMode) void prefetch()
    last = cur
  })

  AppState.addEventListener('change', (s) => {
    if (s !== 'active') {
      flushListening()
      save()
    } else youtube.warmUp()
  })
  setInterval(() => {
    if (state.playing) {
      flushListening()
      save()
    }
  }, 10_000)
}

let audioTimer: ReturnType<typeof setTimeout> | null = null
/** EQ / leveling changes (batched: dragging an EQ band sends many). */
function applyAudioSettings() {
  if (audioTimer) clearTimeout(audioTimer)
  audioTimer = setTimeout(applyAudioNow, 90)
}

function applyAudioNow() {
  audioTimer = null
  const s = getSettings()
  const { filters, peakRiseDb } = eqFilters(s.eq)
  void nat(() => NativeAudio.setEq(filters, peakRiseDb))
  void nat(() => NativeAudio.setLevel(s.normalize, LOUDNESS_LUFS[s.loudnessLevel] + 14))
}

// ---------- actions ----------

export function playTracks(tracks: Track[], start = 0, shuffle = state.shuffle) {
  if (!tracks.length) return
  let items = wrap(tracks)
  const ordered = items
  let index = Math.max(0, Math.min(start, items.length - 1))
  if (shuffle) {
    items = [items[index], ...shuffled(items.filter((_, i) => i !== index))]
    index = 0
  }
  originalOrder = shuffle ? ordered : null
  emit({ queue: items, index, shuffle }, true)
  load(true)
}

let originalOrder: QueueItem[] | null = null

export function playNext(tracks: Track[]) {
  if (!state.queue.length) return playTracks(tracks)
  const items = wrap(tracks)
  const queue = state.queue.slice()
  queue.splice(state.index + 1, 0, ...items)
  emit({ queue }, true)
  void prefetch()
  toast(tracks.length === 1 ? `"${tracks[0].title}" plays next` : `${tracks.length} songs play next`)
}

export function addToQueue(tracks: Track[]) {
  const items = wrap(tracks)
  if (!state.queue.length) emit({ queue: items, index: 0, duration: items[0]?.track.duration ?? 0 }, true)
  else emit({ queue: [...state.queue, ...items] }, true)
  void prefetch()
  toast(tracks.length === 1 ? 'Added to queue' : `${tracks.length} songs added to queue`)
}

export function jump(index: number) {
  if (index < 0 || index >= state.queue.length) return
  emit({ index }, true)
  load(true)
}

export function removeAt(index: number) {
  const queue = state.queue.slice()
  const [removed] = queue.splice(index, 1)
  if (!removed) return
  if (index < state.index) emit({ queue, index: state.index - 1 }, true)
  else if (index > state.index) emit({ queue }, true)
  else {
    emit({ queue, index: Math.min(index, queue.length - 1) }, true)
    load(state.playing)
    return
  }
  void prefetch()
}

export function clearUpcoming() {
  const cur = state.queue[state.index]
  emit(cur ? { queue: [...state.queue.slice(0, state.index), cur] } : { queue: [], index: -1 }, true)
  void prefetch()
}

export function toggle() {
  const item = state.queue[state.index]
  if (!item) return
  if (loadedKey !== item.key || state.activeKey !== item.key) {
    if (!state.loading) load(true)
    return
  }
  if (state.playing) {
    emit({ playing: false })
    void nat(() => NativeAudio.pause())
  } else {
    emit({ playing: true })
    void nat(() => NativeAudio.resume())
  }
}

export function next() {
  if (!state.queue.length) return
  const ni = nextIndex(state.index, false)
  if (ni < 0) return
  emit({ index: ni }, true)
  load(true)
}

export function prev() {
  if (!state.queue.length) return
  if (state.position > 3 || (state.index === 0 && state.repeat !== 'all')) return seek(0)
  emit({ index: state.index > 0 ? state.index - 1 : state.queue.length - 1 }, true)
  load(true)
}

export function seek(seconds: number) {
  if (state.activeKey === null) return
  emit({ position: seconds })
  void nat(() => NativeAudio.seek(seconds))
}

export function toggleShuffle() {
  if (state.shuffle) {
    const cur = state.queue[state.index]
    if (originalOrder && cur) {
      // put the original order back, keeping songs added since
      const known = new Set(originalOrder.map((q) => q.key))
      const restored = [...originalOrder.filter((q) => state.queue.some((s) => s.key === q.key)), ...state.queue.filter((q) => !known.has(q.key))]
      emit({ queue: restored, index: Math.max(0, restored.findIndex((q) => q.key === cur.key)), shuffle: false }, true)
    } else emit({ shuffle: false }, true)
    originalOrder = null
  } else {
    originalOrder = state.queue.slice()
    const upcoming = shuffled(state.queue.slice(state.index + 1))
    emit({ queue: [...state.queue.slice(0, state.index + 1), ...upcoming], shuffle: true }, true)
  }
  void prefetch()
}

export function cycleRepeat() {
  const order: Repeat[] = ['off', 'all', 'one']
  emit({ repeat: order[(order.indexOf(state.repeat) + 1) % order.length] }, true)
  void prefetch()
}

/** Sources shown next to the song, e.g. "Spotify → YouTube Music". */
export const sourceLabel = (t: Track, via: SourceId | null) => (via ? `${SOURCES[t.source].name} · from ${SOURCES[via].name}` : SOURCES[t.source].name)
