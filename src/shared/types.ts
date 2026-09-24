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
}

export interface Playlist {
  id: string
  name: string
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
