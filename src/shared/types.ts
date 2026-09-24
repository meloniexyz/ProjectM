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

export interface SpotifyStatus {
  clientId: string | null
  connected: boolean
  userName: string | null
  /** what the user must register in their Spotify developer app */
  redirectUri: string
}

export interface SpotifyPlaylist {
  id: string
  name: string
  artwork?: string
  owner: string
  total: number
}

export interface SpotifyPlayback {
  trackId: string | null
  playing: boolean
  positionMs: number
}
