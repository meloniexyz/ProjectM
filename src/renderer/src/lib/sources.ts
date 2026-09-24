import type { SourceId, StreamInfo, Track } from '../../../shared/types'

export interface SourceInfo {
  name: string
  color: string
  /** shown on the source page until the integration exists */
  plan?: string
}

export const SOURCE_ORDER: SourceId[] = ['local', 'youtube', 'soundcloud', 'spotify']

export const SOURCES: Record<SourceId, SourceInfo> = {
  local: { name: 'Local Files', color: '#8b7cff' },
  youtube: {
    name: 'YouTube Music',
    color: '#ff0033',
    plan: 'Search and stream all of YouTube Music, and bring in your liked songs and playlists.',
  },
  soundcloud: {
    name: 'SoundCloud',
    color: '#ff5500',
    plan: 'Search SoundCloud tracks, remixes and sets, and stream them right alongside everything else.',
  },
  spotify: {
    name: 'Spotify',
    color: '#1ed760',
    plan: 'Play your Spotify library and playlists (Premium required). Audio runs through a small background helper.',
  },
}

const CONNECTED = new Set<SourceId>(['local', 'youtube', 'soundcloud'])
export const isConnected = (source: SourceId) => CONNECTED.has(source)
export const isStreaming = (source: SourceId) => source !== 'local' && isConnected(source)
export const STREAMING_SOURCES = SOURCE_ORDER.filter(isStreaming)

/** Turns a track into something the audio element can play. */
export async function resolveStream(track: Track): Promise<StreamInfo> {
  if (track.source === 'local') return { url: `media://local/${encodeURIComponent(track.id)}`, kind: 'direct' }
  if (!isConnected(track.source)) throw new Error(`${SOURCES[track.source].name} isn't connected yet`)
  return window.api.sources.resolve(track.source, track.id).catch((err) => {
    throw cleanError(err)
  })
}

/** Errors from the main process arrive as "Error invoking remote method 'x': Error: msg"; keep just msg. */
export function cleanError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err)
  return new Error(msg.replace(/^Error invoking remote method '[^']+': (w*Error: )?/, ''))
}

const searchCache = new Map<string, Promise<Track[]>>()

/** Searches a streaming source. Results are cached for the session so going back is instant. */
export function searchSource(source: SourceId, query: string): Promise<Track[]> {
  const key = `${source}|${query.trim().toLowerCase()}`
  let hit = searchCache.get(key)
  if (!hit) {
    hit = window.api.sources.search(source, query.trim()).catch((err) => {
      throw cleanError(err)
    })
    hit.catch(() => searchCache.delete(key)) // don't cache failures
    searchCache.set(key, hit)
  }
  return hit
}

/** Link to the song on the service's own website, if there is one. */
export function webUrl(track: Track): string | undefined {
  if (track.source === 'youtube') return `https://music.youtube.com/watch?v=${track.id}`
}
