import { useSyncExternalStore } from 'react'
import type { Track } from '../../../shared/types'
import { shuffled } from './format'
import { resolveStream } from './sources'
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
  buffering: boolean
  position: number
  duration: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: Repeat
  error: string | null
}

const STORAGE_KEY = 'projectm.player'
let keySeq = 1
const wrap = (tracks: Track[]): QueueItem[] => tracks.map((track) => ({ key: keySeq++, track }))

function restore(): PlayerState {
  const s: PlayerState = {
    queue: [],
    index: -1,
    playing: false,
    buffering: false,
    position: 0,
    duration: 0,
    volume: 0.8,
    muted: false,
    shuffle: false,
    repeat: 'off',
    error: null,
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (saved) {
      s.queue = wrap(saved.queue ?? [])
      s.index = Math.min(saved.index ?? -1, s.queue.length - 1)
      s.duration = s.queue[s.index]?.track.duration ?? 0
      s.volume = saved.volume ?? s.volume
      s.muted = !!saved.muted
      s.shuffle = !!saved.shuffle
      s.repeat = saved.repeat ?? 'off'
    }
  } catch {
    // ignore corrupt saved state
  }
  return s
}

// ---------- state ----------

let state = restore()
const listeners = new Set<() => void>()
let saveTimer = 0

function emit(patch: Partial<PlayerState>, persist = true) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
  if (persist) {
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(save, 400)
  }
}

function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        queue: state.queue.map((q) => q.track),
        index: state.index,
        volume: state.volume,
        muted: state.muted,
        shuffle: state.shuffle,
        repeat: state.repeat,
      }),
    )
  } catch {
    // storage full: not critical
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Selector must return a stable value (a field or primitive). */
export function usePlayer<T>(select: (s: PlayerState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state))
}

export const getPlayer = () => state

// ---------- audio engine ----------
// All sources end up as a URL for this one <audio> element. A Spotify backend will slot in beside it later.

const audio = new Audio()
audio.preload = 'auto'
/** queue item currently loaded into the audio element */
let loadedKey: number | null = null
/** bumps on every load, so stale async results are ignored */
let loadSeq = 0
/** pre-shuffle order, to restore when shuffle is turned off */
let original: QueueItem[] | null = null

const currentItem = () => state.queue[state.index]

function applyVolume() {
  audio.volume = state.muted ? 0 : state.volume ** 2 // squared feels linear to the ear
}
applyVolume()

async function load(autoplay: boolean) {
  const item = currentItem()
  const seq = ++loadSeq
  if (!item) {
    loadedKey = null
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    emit({ playing: false, buffering: false, position: 0, duration: 0 })
    return
  }
  loadedKey = item.key
  emit({ position: 0, duration: item.track.duration, error: null, buffering: autoplay })
  setMediaSession(item.track)

  let url: string
  try {
    url = await resolveStream(item.track)
  } catch (err) {
    if (seq === loadSeq) fail(item.track, err)
    return
  }
  if (seq !== loadSeq) return
  audio.src = url
  if (autoplay) audio.play().catch(() => {}) // real failures arrive via the 'error' event
}

function fail(track: Track, err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  emit({ error: message, playing: false, buffering: false }, false)
  toast(`Couldn't play "${track.title}": ${message}`)
  if (state.index < state.queue.length - 1) {
    const seq = loadSeq
    setTimeout(() => seq === loadSeq && next(), 1200)
  }
}

audio.addEventListener('play', () => emit({ playing: true }, false))
audio.addEventListener('pause', () => emit({ playing: false }, false))
audio.addEventListener('playing', () => emit({ buffering: false }, false))
audio.addEventListener('waiting', () => emit({ buffering: true }, false))
audio.addEventListener('timeupdate', () => emit({ position: audio.currentTime }, false))
audio.addEventListener('durationchange', () => {
  if (Number.isFinite(audio.duration)) emit({ duration: audio.duration }, false)
})
audio.addEventListener('error', () => {
  const item = currentItem()
  if (item && loadedKey === item.key && audio.getAttribute('src')) {
    fail(item.track, new Error(audio.error?.code === 4 ? 'file missing or format not supported' : 'playback error'))
  }
})
audio.addEventListener('ended', () => {
  if (state.repeat === 'one') {
    audio.currentTime = 0
    audio.play().catch(() => {})
  } else if (state.index < state.queue.length - 1) {
    emit({ index: state.index + 1 })
    load(true)
  } else if (state.repeat === 'all' && state.queue.length) {
    emit({ index: 0 })
    load(true)
  }
})

// ---------- actions ----------

/** Replace the queue with `tracks` and start at `start`. */
export function playTracks(tracks: Track[], start = 0, shuffle = state.shuffle) {
  if (!tracks.length) return
  let items = wrap(tracks)
  let index = Math.max(0, Math.min(start, items.length - 1))
  original = null
  if (shuffle) {
    original = items
    items = [items[index], ...shuffled(items.filter((_, i) => i !== index))]
    index = 0
  }
  emit({ queue: items, index, shuffle })
  load(true)
}

export function playNext(tracks: Track[]) {
  if (!state.queue.length) return playTracks(tracks)
  const items = wrap(tracks)
  const queue = state.queue.slice()
  queue.splice(state.index + 1, 0, ...items)
  if (original) {
    const at = original.findIndex((q) => q.key === currentItem()?.key)
    original.splice(at + 1, 0, ...items)
  }
  emit({ queue })
}

export function addToQueue(tracks: Track[]) {
  const items = wrap(tracks)
  original?.push(...items)
  if (!state.queue.length) emit({ queue: items, index: 0, duration: items[0]?.track.duration ?? 0 })
  else emit({ queue: [...state.queue, ...items] })
}

export function jump(index: number) {
  if (index < 0 || index >= state.queue.length) return
  emit({ index })
  load(true)
}

export function removeAt(index: number) {
  const queue = state.queue.slice()
  const [removed] = queue.splice(index, 1)
  if (!removed) return
  if (original) original = original.filter((q) => q.key !== removed.key)
  if (index < state.index) emit({ queue, index: state.index - 1 })
  else if (index > state.index) emit({ queue })
  else {
    const wasPlaying = state.playing
    emit({ queue, index: Math.min(index, queue.length - 1) })
    load(wasPlaying)
  }
}

/** Drop everything after the current song. */
export function clearUpcoming() {
  const cur = currentItem()
  original = null
  emit(cur ? { queue: [...state.queue.slice(0, state.index), cur] } : { queue: [], index: -1 })
}

export function toggle() {
  const item = currentItem()
  if (!item) return
  if (loadedKey !== item.key) return void load(true)
  if (audio.paused) {
    if (audio.ended) audio.currentTime = 0
    audio.play().catch(() => {})
  } else audio.pause()
}

export function next() {
  if (!state.queue.length) return
  if (state.index < state.queue.length - 1) emit({ index: state.index + 1 })
  else if (state.repeat === 'all') emit({ index: 0 })
  else return
  load(true)
}

export function prev() {
  if (!state.queue.length) return
  if (audio.currentTime > 3 || (state.index === 0 && state.repeat !== 'all')) return seek(0)
  emit({ index: state.index > 0 ? state.index - 1 : state.queue.length - 1 })
  load(true)
}

export function seek(seconds: number) {
  if (loadedKey !== currentItem()?.key) return
  audio.currentTime = seconds
  emit({ position: seconds }, false)
}

export function setVolume(v: number) {
  emit({ volume: Math.max(0, Math.min(1, v)), muted: false })
  applyVolume()
}

export function toggleMute() {
  emit({ muted: !state.muted })
  applyVolume()
}

export function toggleShuffle() {
  if (state.shuffle) {
    const cur = currentItem()
    if (original && cur) {
      emit({ queue: original, index: Math.max(0, original.findIndex((q) => q.key === cur.key)), shuffle: false })
    } else emit({ shuffle: false })
    original = null
  } else {
    // keep what already played in place, shuffle only what's coming up
    original = state.queue.slice()
    const upcoming = shuffled(state.queue.slice(state.index + 1))
    emit({ queue: [...state.queue.slice(0, state.index + 1), ...upcoming], shuffle: true })
  }
}

export function cycleRepeat() {
  const order: Repeat[] = ['off', 'all', 'one']
  emit({ repeat: order[(order.indexOf(state.repeat) + 1) % order.length] })
}

// ---------- OS integration (media keys, Windows media overlay) ----------

function setMediaSession(t: Track) {
  document.title = `${t.title} · ${t.artist}`
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: t.album,
    artwork: t.artwork ? [{ src: t.artwork }] : [],
  })
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession
  ms.setActionHandler('play', () => toggle())
  ms.setActionHandler('pause', () => audio.pause())
  ms.setActionHandler('nexttrack', () => next())
  ms.setActionHandler('previoustrack', () => prev())
  ms.setActionHandler('seekto', (d) => d.seekTime != null && seek(d.seekTime))
}
