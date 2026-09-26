import { useSyncExternalStore } from 'react'
import type Hls from 'hls.js'
import type { SourceId, StreamInfo, Track } from '../../../shared/types'
import { recordPlay } from './history'
import { connectAudio, resumeAudio, setEq, setMediaElement, setNormalizeEnabled, setOutputVolume, setTargetLufs, startSong } from './loudness'
import { BAND_LAYOUTS } from './eq'
import { getSettings, LOUDNESS_LUFS, settingsStore } from './settings'
import { shuffled } from './format'
import { cleanError, resolveStream } from './sources'
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
  /** even out loudness between songs and sources */
  normalize: boolean
  /** what's being played right now, e.g. "Opus · 134 kbps" */
  quality: string | null
  /** queue item whose audio is actually attached (null while switching songs) */
  activeKey: number | null
  /** set when the song plays from a different service than its own (Spotify -> YouTube Music) */
  via: SourceId | null
}

const STORAGE_KEY = 'projectm.player'
/** where to continue the restored song from, on its first play after launch (only that song) */
let resumeAt = 0
let resumeKey: number | null = null
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
    normalize: true,
    quality: null,
    activeKey: null,
    via: null,
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (saved) {
      s.queue = wrap(saved.queue ?? [])
      s.index = Math.min(saved.index ?? -1, s.queue.length - 1)
      s.duration = s.queue[s.index]?.track.duration ?? 0
      s.volume = saved.volume ?? s.volume
      s.position = Math.max(0, saved.position ?? 0)
      resumeAt = s.position > 2 ? s.position : 0
      resumeKey = s.queue[s.index]?.key ?? null
      s.muted = !!saved.muted
      s.shuffle = !!saved.shuffle
      s.repeat = saved.repeat ?? 'off'
      s.normalize = saved.normalize ?? true
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
        position: Math.round(state.position),
        volume: state.volume,
        muted: state.muted,
        shuffle: state.shuffle,
        repeat: state.repeat,
        normalize: state.normalize,
      }),
    )
  } catch {
    // storage full: not critical
  }
}

// keep the saved position fresh while playing, and on close
setInterval(() => state.playing && save(), 5000)
window.addEventListener('beforeunload', save)

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
/** For code outside React that follows playback (e.g. the listening log). */
export const subscribePlayer = subscribe

// ---------- audio engine ----------
// Local files, YouTube Music and SoundCloud play in this one <audio> element ("audio" engine).
// Spotify songs play in the user's Spotify app via Spotify Connect ("spotify" engine, below).

const audio = new Audio()
audio.preload = 'auto'
connectAudio(audio) // loudness normalizer + volume (see loudness.ts)
setMediaElement(audio)
setNormalizeEnabled(state.normalize)
/** queue item currently loaded into the audio element */
let loadedKey: number | null = null
/** bumps on every load, so stale async results are ignored */
let loadSeq = 0
/** pre-shuffle order, to restore when shuffle is turned off */
let original: QueueItem[] | null = null
/** active hls.js instance, for sources that stream in HLS segments (some SoundCloud tracks) */
let hls: Hls | null = null

function detachHls() {
  hls?.destroy()
  hls = null
}

/** Points the audio element at a stream. Returns false if a newer load() superseded this one. */
async function attach(stream: StreamInfo, seq: number, track: Track) {
  detachHls()
  emit({ quality: stream.quality ?? null }, false)
  startSong(track.uid, stream.gainDb)
  resumeAudio()
  if (stream.kind === 'direct') {
    audio.src = stream.url
    return true
  }
  const { default: HlsClass } = await import('hls.js') // only loaded when first needed
  if (seq !== loadSeq) return false
  const instance = new HlsClass({ enableWorker: true })
  hls = instance
  instance.on(HlsClass.Events.ERROR, (_, data) => {
    if (!data.fatal || hls !== instance) return
    if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR) instance.startLoad()
    else fail(track, new Error(`stream error (${data.details})`))
  })
  instance.loadSource(stream.url)
  instance.attachMedia(audio)
  return true
}

const currentItem = () => state.queue[state.index]

let engine: 'audio' | 'spotify' = 'audio'
let spotifyVolumeTimer = 0

function applyVolume() {
  setOutputVolume(state.muted ? 0 : state.volume ** 2) // squared feels linear to the ear
  if (engine === 'spotify') {
    clearTimeout(spotifyVolumeTimer)
    spotifyVolumeTimer = window.setTimeout(() => sp.volume(spotifyVolume()).catch(() => {}), 250)
  }
}
applyVolume()

/** Our 0..1 volume as Spotify's 0..100, on the same curve, plus the user's Spotify level adjustment. */
const spotifyVolume = () =>
  state.muted ? 0 : Math.min(100, Math.round(state.volume ** 2 * 100 * 10 ** (getSettings().spotifyLevelDb / 20)))

// react to settings changes
let lastSettings = getSettings()
settingsStore.subscribe(() => {
  const s = getSettings()
  if (s === lastSettings) return
  if (s.loudnessLevel !== lastSettings.loudnessLevel) setTargetLufs(LOUDNESS_LUFS[s.loudnessLevel])
  if (s.spotifyLevelDb !== lastSettings.spotifyLevelDb) applyVolume()
  if (s.eq !== lastSettings.eq) applyEq()
  lastSettings = s
})
setTargetLufs(LOUDNESS_LUFS[getSettings().loudnessLevel])

function applyEq() {
  const { eq } = getSettings()
  const layout = BAND_LAYOUTS[eq.bands]
  setEq({ enabled: eq.enabled, bands: layout.map((b, i) => ({ freq: b.freq, gain: eq.gains[i] ?? 0 })) })
}
applyEq()

function stopAudio() {
  detachHls()
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
}

async function load(autoplay: boolean) {
  const item = currentItem()
  const seq = ++loadSeq
  if (!item) {
    loadedKey = null
    spotifyStop()
    stopAudio()
    emit({ playing: false, buffering: false, position: 0, duration: 0 })
    return
  }
  loadedKey = item.key
  const startAt = item.key === resumeKey ? resumeAt : 0
  resumeAt = 0
  resumeKey = null
  emit({ position: startAt, duration: item.track.duration, error: null, buffering: autoplay, via: null, activeKey: null })
  setMediaSession(item.track)
  if (autoplay) recordPlay(item.track)

  if (item.track.source === 'spotify') {
    stopAudio()
    engine = 'spotify'
    if (!autoplay) {
      loadedKey = null // nothing sent to Spotify yet; toggle() will start it
      spotifyStop()
      emit({ playing: false, buffering: false })
      return
    }
    if (getSettings().spotifyPlayback === 'alternatives' || Date.now() < spotifyUnavailableUntil) {
      return playFallback(item.track, seq)
    }
    return spotifyStart(item.track, seq, startAt)
  }
  if (engine === 'spotify') spotifyStop()
  engine = 'audio'

  let stream: StreamInfo
  try {
    stream = await resolveStream(item.track)
  } catch (err) {
    if (seq === loadSeq) fail(item.track, err)
    return
  }
  if (seq !== loadSeq || !(await attach(stream, seq, item.track))) return
  if (startAt) audio.currentTime = startAt
  emit({ activeKey: item.key, position: startAt }, false)
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

// ---------- Spotify engine ----------
// We tell the Spotify app what to play, then poll its state once a second. Between polls the
// position is extrapolated so the seek bar moves smoothly.

const sp = window.api.spotify
let spTimer = 0
let spPoll = 0
let spTrackId: string | null = null
let spSeenPlaying = false
let spPlaying = false
let spUserPaused = false
let spPos = 0 // seconds, as of spPosAt
let spPosAt = 0

const spNow = () => (spPlaying ? spPos + (performance.now() - spPosAt) / 1000 : spPos)

function spotifyStop() {
  clearInterval(spTimer)
  clearInterval(spPoll)
  spTimer = spPoll = 0
  if (engine === 'spotify' && spTrackId) sp.pause().catch(() => {})
  spTrackId = null
  spPlaying = false
}

async function spotifyStart(track: Track, seq: number, positionSec = 0) {
  clearInterval(spTimer)
  clearInterval(spPoll)
  try {
    await sp.play(track.id, positionSec * 1000)
  } catch (err) {
    if (seq !== loadSeq) return
    const e = cleanError(err)
    // No Spotify app to play through: use the same song from YouTube Music instead.
    if (/find the spotify app|no active device|device not found|NO_ACTIVE_DEVICE/i.test(e.message)) {
      spotifyUnavailableUntil = Date.now() + 30_000 // re-check soon, in case you open Spotify
      return playFallback(track, seq)
    }
    fail(track, e)
    return
  }
  if (seq !== loadSeq) return
  emit({ quality: 'Spotify app quality', activeKey: state.queue[state.index]?.key ?? null, position: positionSec }, false)
  sp.volume(spotifyVolume()).catch(() => {})
  spTrackId = track.id
  spSeenPlaying = false
  spUserPaused = false
  spPlaying = true
  spPos = positionSec
  spPosAt = performance.now()
  emit({ playing: true, buffering: false }, false)

  // smooth progress + end-of-song detection
  spTimer = window.setInterval(() => {
    if (seq !== loadSeq) return
    const pos = Math.min(spNow(), track.duration)
    emit({ position: pos }, false)
    // Move on just before the end ourselves, so Spotify's own autoplay never kicks in.
    if (spPlaying && track.duration && pos >= track.duration - 0.35) {
      spPlaying = false
      onEnded()
    }
  }, 250)

  spPoll = window.setInterval(async () => {
    const s = await sp.playback().catch(() => null)
    if (seq !== loadSeq || !s) return
    if (s.trackId === track.id) {
      if (s.playing) spSeenPlaying = true
      spPlaying = s.playing
      spPos = s.positionMs / 1000
      spPosAt = performance.now()
      if (state.playing !== s.playing) emit({ playing: s.playing }, false) // paused/resumed from Spotify itself
      // stopped at the start after having played = finished (Spotify resets to 0 at the end)
      if (!s.playing && spSeenPlaying && !spUserPaused && s.positionMs === 0) onEnded()
    } else if (spSeenPlaying && !spUserPaused) {
      onEnded() // Spotify moved on to another song: ours finished
    }
  }, 1000)
}

let spotifyUnavailableUntil = 0
let fallbackNoticeShown = false

/** Plays a Spotify song from YouTube Music (same artist/title/length) through the audio engine. */
async function playFallback(track: Track, seq: number) {
  spotifyStop()
  engine = 'audio'
  emit({ buffering: true })
  if (!fallbackNoticeShown && getSettings().spotifyPlayback === 'app') {
    fallbackNoticeShown = true
    toast("Spotify app isn't available, so Spotify songs play from YouTube Music or SoundCloud")
  }
  let stream: StreamInfo
  try {
    const match = await window.api.sources.match({ title: track.title, artist: track.artist, duration: track.duration })
    if (seq !== loadSeq) return
    if (!match) throw new Error("Spotify app isn't available and no match was found on YouTube Music or SoundCloud")
    emit({ via: match.source })
    stream = await resolveStream(match)
  } catch (err) {
    if (seq === loadSeq) fail(track, cleanError(err))
    return
  }
  if (seq !== loadSeq || !(await attach(stream, seq, track))) return
  emit({ activeKey: state.queue[state.index]?.key ?? null, position: 0 }, false)
  audio.play().catch(() => {})
}

/** Lets the next Spotify song try the Spotify app again (e.g. after the user opened it). */
export function retrySpotifyApp() {
  spotifyUnavailableUntil = 0
}

function spotifyToggle() {
  if (spPlaying) {
    spPos = spNow()
    spPlaying = false
    spUserPaused = true
    emit({ playing: false }, false)
    sp.pause().catch((err) => toast(cleanError(err).message))
  } else {
    spPosAt = performance.now()
    spPlaying = true
    spUserPaused = false
    emit({ playing: true }, false)
    sp.resume().catch((err) => toast(cleanError(err).message))
  }
}

function onEnded() {
  if (state.repeat === 'one') {
    if (engine === 'spotify') return void load(true)
    audio.currentTime = 0
    audio.play().catch(() => {})
  } else if (state.index < state.queue.length - 1) {
    emit({ index: state.index + 1 })
    load(true)
  } else if (state.repeat === 'all' && state.queue.length) {
    emit({ index: 0 })
    load(true)
  } else if (engine === 'spotify') {
    spotifyStop()
    loadedKey = null // pressing play again restarts the song
    emit({ playing: false, position: 0 }, false)
  }
}

audio.addEventListener('play', () => engine === 'audio' && emit({ playing: true }, false))
audio.addEventListener('pause', () => engine === 'audio' && emit({ playing: false }, false))
audio.addEventListener('playing', () => emit({ buffering: false }, false))
audio.addEventListener('waiting', () => emit({ buffering: true }, false))
audio.addEventListener('timeupdate', () => state.activeKey !== null && emit({ position: audio.currentTime }, false))
audio.addEventListener('durationchange', () => {
  if (Number.isFinite(audio.duration)) emit({ duration: audio.duration }, false)
})
audio.addEventListener('error', () => {
  const item = currentItem()
  if (item && loadedKey === item.key && (audio.getAttribute('src') || hls)) {
    fail(item.track, new Error(audio.error?.code === 4 ? 'file missing or format not supported' : 'playback error'))
  }
})
audio.addEventListener('ended', onEnded)

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
  if (engine === 'spotify') return spotifyToggle()
  if (audio.paused) {
    resumeAudio()
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
  const pos = engine === 'spotify' ? spNow() : audio.currentTime
  if (pos > 3 || (state.index === 0 && state.repeat !== 'all')) return seek(0)
  emit({ index: state.index > 0 ? state.index - 1 : state.queue.length - 1 })
  load(true)
}

export function seek(seconds: number) {
  if (loadedKey !== currentItem()?.key) return
  if (engine === 'spotify') {
    spPos = seconds
    spPosAt = performance.now()
    sp.seek(seconds * 1000).catch((err) => toast(cleanError(err).message))
  } else audio.currentTime = seconds
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

export function toggleNormalize() {
  emit({ normalize: !state.normalize })
  setNormalizeEnabled(state.normalize)
  toast(state.normalize ? 'Volume leveling on: every song plays at the same loudness' : 'Volume leveling off')
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
  ms.setActionHandler('pause', () => state.playing && toggle())
  ms.setActionHandler('nexttrack', () => next())
  ms.setActionHandler('previoustrack', () => prev())
  ms.setActionHandler('seekto', (d) => d.seekTime != null && seek(d.seekTime))
}
