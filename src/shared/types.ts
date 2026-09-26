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
  /** when you liked it (ms), for liked-songs lists that provide it */
  likedAt?: number
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
  /** what's being played, for display, e.g. "Opus · 134 kbps" */
  quality?: string
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
  /** LRCLIB entry id */
  id?: number
  /** length of the recording these lyrics are timed to (s) */
  duration?: number
  /** which release it's from, e.g. the album name */
  label?: string
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

export type EqBands = 3 | 5 | 7

export interface EqSettings {
  enabled: boolean
  bands: EqBands
  /** dB per band for the current band count */
  gains: number[]
  /** name of the preset the gains came from, or 'Custom' once edited */
  preset: string
  /** user presets, stored as gains at the 7-band frequencies so they work in every mode */
  custom: { name: string; curve: number[] }[]
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
  /** hide local audio under 30 s (samples, sound effects, voice memos) */
  hideShortClips: boolean
  openAtLogin: boolean
  eq: EqSettings
  /** colour theme id (see renderer/lib/themes.ts) */
  theme: string
  /** custom accent colour on top of the theme, or null to use the theme's own */
  accent: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  startPage: 'home',
  loudnessLevel: 'normal',
  spotifyPlayback: 'app',
  spotifyLevelDb: 0,
  showLyrics: true,
  rescanOnStartup: true,
  hideShortClips: true,
  openAtLogin: false,
  eq: { enabled: false, bands: 7, gains: [0, 0, 0, 0, 0, 0, 0], preset: 'Flat', custom: [] },
  theme: 'projectm',
  accent: null,
}

/** One play of a song: when, which parts were heard, and for how long. */
export interface ListenEntry {
  id: string
  track: Track
  /** set when it played from another service (Spotify song played from YouTube) */
  via?: SourceId | null
  /** wall-clock start and last update (ms) */
  startedAt: number
  endedAt: number
  /** parts of the song heard, as [from, to] positions in seconds */
  segments: [number, number][]
  /** seconds actually heard */
  listened: number
  /** song length (s) */
  duration: number
}

/** Details about a recording (from MusicBrainz). */
export interface SongInfo {
  title: string
  artist: string
  /** first release date, e.g. "2013-05-17" */
  released?: string
  album?: string
  albumType?: string
  /** where/when it was recorded, mixed etc. */
  recordedAt: { what: string; place: string; area?: string; date?: string; until?: string }[]
  credits: { role: string; names: string[] }[]
  isrc?: string
  url: string
}
