export type SourceId = 'local' | 'youtube' | 'soundcloud' | 'spotify'

/** One song, from any source. Everything in the app (queue, playlists, search) works on this shape. */
export interface Track {
  /** `${source}:${id}`, unique across all sources */
  uid: string
  source: SourceId
  /** id within the source (hash of the path for local files) */
  id: string
  title: string
  artist: string
  album: string
  albumArtist?: string
  /** seconds */
  duration: number
  artwork?: string
  trackNo?: number
  discNo?: number
  year?: number
  /** local files: gain (dB) that brings the song to -14 LUFS, from its ReplayGain tag */
  gainDb?: number
}

export interface Playlist {
  id: string
  name: string
  description?: string
  /** custom cover image (media://art/...); falls back to a mosaic of the songs' covers */
  cover?: string
  tracks: Track[]
  createdAt: number
  updatedAt: number
}

export interface LibraryState {
  folders: string[]
  tracks: Track[]
}

export interface ScanProgress {
  phase: 'listing' | 'reading' | 'done'
  done: number
  total: number
}

/** How to play a streaming track: 'direct' in <audio> as-is, 'hls' via hls.js. */
export interface StreamInfo {
  url: string
  kind: 'direct' | 'hls'
  /** known gain (dB) to reach -14 LUFS, when the source publishes loudness info */
  gainDb?: number
}

/** A signed-in streaming account (Spotify, YouTube Music, SoundCloud). */
export interface AccountStatus {
  connected: boolean
  userName: string | null
  /** Spotify only: the user's developer app */
  clientId?: string | null
  /** Spotify only: what the user must register in their developer app */
  redirectUri?: string
}

/** A playlist that lives on a streaming service (not a ProjectM playlist). */
export interface RemotePlaylist {
  id: string
  name: string
  artwork?: string
  owner: string
  total: number
}

export interface Lyrics {
  instrumental: boolean
  /** time-synced lines (seconds), when available */
  synced: { time: number; text: string }[] | null
  plain: string | null
}

export interface SpotifyPlayback {
  trackId: string | null
  playing: boolean
  positionMs: number
}

/** A SoundCloud profile shown in the "which one is you?" picker. */
export interface SoundCloudProfile {
  id: number
  username: string
  permalink: string
  avatar?: string
  followers: number
  likes: number
  city?: string
}

/** App settings (stored in settings.json in the app's data folder). */
export interface Settings {
  /** page shown when ProjectM opens */
  startPage: 'home' | 'songs' | 'search' | 'last'
  /** loudness all songs are leveled to, like Spotify's Quiet / Normal / Loud */
  loudnessLevel: 'quiet' | 'normal' | 'loud'
  /** Spotify songs: through the Spotify app when it's open, or always from YouTube Music / SoundCloud */
  spotifyPlayback: 'app' | 'alternatives'
  /** dB added to Spotify's volume, to match it with the other sources by ear */
  spotifyLevelDb: number
  showLyrics: boolean
  rescanOnStartup: boolean
  openAtLogin: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  startPage: 'home',
  loudnessLevel: 'normal',
  spotifyPlayback: 'app',
  spotifyLevelDb: 0,
  showLyrics: true,
  rescanOnStartup: true,
  openAtLogin: false,
}
