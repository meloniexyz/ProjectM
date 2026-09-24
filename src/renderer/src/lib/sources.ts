import type { SourceId, Track } from '../../../shared/types'

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

export const isConnected = (source: SourceId) => source === 'local'

/** Turns a track into something the audio element can play. Streaming sources plug in here. */
export async function resolveStream(track: Track): Promise<string> {
  switch (track.source) {
    case 'local':
      return `media://local/${encodeURIComponent(track.id)}`
    default:
      throw new Error(`${SOURCES[track.source].name} isn't connected yet`)
  }
}
