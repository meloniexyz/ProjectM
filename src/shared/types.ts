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
