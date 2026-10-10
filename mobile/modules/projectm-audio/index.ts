import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core'

/** A song for the native player: a local file plus what the lock screen shows. */
export interface NativeTrack {
  id: string
  /** file:// address of the downloaded / imported audio */
  uri: string
  title: string
  artist: string
  album: string
  artwork?: string
  duration: number
  /** gain (dB) that brings this song to the reference loudness (-14 LUFS) */
  gainDb: number
}

export interface NativeFilter {
  type: 'peaking' | 'lowshelf' | 'highshelf'
  freq: number
  q: number
  gain: number
}

export interface NativeState {
  id?: string
  position: number
  duration: number
  playing: boolean
  buffering: boolean
}

export interface AudioEvents {
  onState: (s: NativeState) => void
  onTrackChange: (e: { id: string }) => void
  onEnded: (e: { id: string }) => void
  onRemote: (e: { command: 'play' | 'pause' | 'next' | 'previous' | 'seek'; position?: number }) => void
  onError: (e: { id: string; message: string }) => void
}

export interface ProjectMAudioModule {
  play(track: NativeTrack, startAt: number, autoplay: boolean): Promise<void>
  setNext(track: NativeTrack | null): Promise<void>
  resume(): Promise<void>
  pause(): Promise<void>
  seek(seconds: number): Promise<void>
  stop(): Promise<void>
  setEq(filters: NativeFilter[], peakRiseDb: number): Promise<void>
  setLevel(normalize: boolean, offsetDb: number): Promise<void>
  holdSilence(on: boolean): Promise<void>
  getState(): Promise<NativeState & { queued?: number }>
  measureLoudness(uri: string): Promise<number | null>
  addListener<K extends keyof AudioEvents>(event: K, listener: AudioEvents[K]): EventSubscription
}

const native = requireOptionalNativeModule<ProjectMAudioModule>('ProjectMAudio')

/**
 * Stand-in for the browser preview (npx expo start --web): plays through an <audio> element,
 * without EQ. Only meant for checking the UI on a computer.
 */
function webFallback(): ProjectMAudioModule {
  const listeners: { [K in keyof AudioEvents]?: Set<AudioEvents[K]> } = {}
  const fire = <K extends keyof AudioEvents>(k: K, payload: Parameters<AudioEvents[K]>[0]) =>
    listeners[k]?.forEach((l) => (l as (p: typeof payload) => void)(payload))
  const hasAudio = typeof Audio !== 'undefined'
  const el = hasAudio ? new Audio() : null
  let current: NativeTrack | null = null
  let next: NativeTrack | null = null
  const state = (): NativeState => ({
    id: current?.id,
    position: el?.currentTime ?? 0,
    duration: el && Number.isFinite(el.duration) ? el.duration : (current?.duration ?? 0),
    playing: !!el && !el.paused,
    buffering: false,
  })
  if (el) {
    el.addEventListener('timeupdate', () => fire('onState', state()))
    el.addEventListener('play', () => fire('onState', state()))
    el.addEventListener('pause', () => fire('onState', state()))
    el.addEventListener('ended', () => {
      if (next) {
        current = next
        next = null
        el.src = current.uri
        el.play().catch(() => {})
        fire('onTrackChange', { id: current.id })
      } else if (current) fire('onEnded', { id: current.id })
    })
  }
  return {
    async play(track, startAt, autoplay) {
      current = track
      next = null
      if (!el) return
      el.src = track.uri
      el.currentTime = startAt
      if (autoplay) await el.play().catch(() => {})
    },
    async setNext(track) {
      next = track
    },
    async resume() {
      await el?.play().catch(() => {})
    },
    async pause() {
      el?.pause()
    },
    async seek(s) {
      if (el) el.currentTime = s
    },
    async stop() {
      el?.pause()
      current = null
    },
    async setEq() {},
    async setLevel() {},
    async holdSilence() {},
    async getState() {
      return state()
    },
    async measureLoudness() {
      return null
    },
    addListener(event, listener) {
      const map = listeners as Record<string, Set<unknown> | undefined>
      const set = (map[event] ??= new Set()) as Set<unknown>
      set.add(listener)
      return { remove: () => set.delete(listener) } as EventSubscription
    },
  }
}

export const NativeAudio: ProjectMAudioModule = native ?? webFallback()
export const hasNativeAudio = !!native
