import type { SourceId, Track } from '../../../../src/shared/types'
import type { Quality } from '../settings'
import { JsonFile } from '../storage'
import { soundcloud } from './soundcloud'
import { spotify } from './spotify'
import type { StreamPlan } from './types'
import { youtube } from './youtube'

export { soundcloud, spotify, youtube }
export type { StreamPlan }

export interface SourceInfo {
  name: string
  short: string
  color: string
}

export const SOURCES: Record<SourceId, SourceInfo> = {
  local: { name: 'Local Files', short: 'Local', color: '#8b7cff' },
  youtube: { name: 'YouTube Music', short: 'YouTube', color: '#ff0033' },
  soundcloud: { name: 'SoundCloud', short: 'SoundCloud', color: '#ff5500' },
  spotify: { name: 'Spotify', short: 'Spotify', color: '#1ed760' },
}

export const SEARCH_SOURCES: SourceId[] = ['youtube', 'soundcloud', 'spotify']

export function search(source: SourceId, q: string, limit = 30): Promise<Track[]> {
  if (source === 'youtube') return youtube.search(q, limit)
  if (source === 'soundcloud') return soundcloud.search(q, limit)
  if (source === 'spotify') return spotify.search(q, limit)
  return Promise.resolve([])
}

// ---------- Spotify songs: play the same recording from YouTube Music or SoundCloud ----------

/** Efficiency of each codec relative to MP3, for comparing streams across services. */
const CODEC_EFFICIENCY = { aac: 1.15, mp3: 1 } as const
const effective = (p: StreamPlan) => p.kbps * CODEC_EFFICIENCY[p.codec]

/** Matches found earlier, so a Spotify song is only searched for once (saves data). */
const matches = new JsonFile<Record<string, { source: 'youtube' | 'soundcloud'; track: Track }>>('alternatives.json', {})

export interface Resolved {
  plan: StreamPlan
  /** the track actually downloaded (differs from the requested one for Spotify songs) */
  via: Track | null
}

/**
 * Where to get a song's audio at the given quality. For Spotify songs both YouTube Music and
 * SoundCloud are searched (only real matches: same artist, length within 15 s). On "best" the
 * better-sounding copy wins; on "low"/"mid" the smaller one does, like Spotify's data saver.
 */
export async function resolvePlan(track: Track, quality: Quality): Promise<Resolved> {
  if (track.source === 'youtube') return { plan: await youtube.plan(track.id, quality), via: null }
  if (track.source === 'soundcloud') return { plan: await soundcloud.plan(track.id, quality), via: null }
  if (track.source !== 'spotify') throw new Error('Local songs play from the phone')

  const known = matches.get()[track.uid]
  if (known) {
    const src = known.source === 'youtube' ? youtube : soundcloud
    const plan = await src.plan(known.track.id, quality).catch(() => null)
    if (plan) return { plan, via: known.track }
  }

  const target = { title: track.title, artist: track.artist, duration: track.duration }
  const candidates = await Promise.all(
    (['youtube', 'soundcloud'] as const).map(async (id) => {
      const src = id === 'youtube' ? youtube : soundcloud
      const m = await src.matchScored(target).catch(() => null)
      if (!m) return null
      const plan = await src.plan(m.track.id, quality).catch(() => null)
      return plan ? { id, track: m.track, plan, score: m.score } : null
    }),
  )
  const found = candidates.filter((c): c is NonNullable<typeof c> => c !== null)
  if (!found.length) throw new Error('No copy of this Spotify song was found on YouTube Music or SoundCloud')
  found.sort((a, b) => {
    const q = quality === 'best' ? effective(b.plan) - effective(a.plan) : effective(a.plan) - effective(b.plan)
    return Math.abs(q) > Math.max(effective(a.plan), effective(b.plan)) * 0.08 ? q : b.score - a.score
  })
  const best = found[0]
  matches.set({ ...matches.get(), [track.uid]: { source: best.id, track: best.track } })
  return { plan: best.plan, via: best.track }
}

/** Forget a remembered match (e.g. it turned out to be the wrong recording). */
export function forgetMatch(uid: string) {
  const next = { ...matches.get() }
  delete next[uid]
  matches.set(next)
}

export function cleanError(err: unknown): Error {
  const e = err instanceof Error ? err : new Error(String(err))
  e.message = e.message.replace(/^(\w*Error: )+/, '')
  return e
}
