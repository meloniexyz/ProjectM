import { contextBridge, ipcRenderer } from 'electron'
import type {
  LibraryState,
  Playlist,
  ScanProgress,
  SourceId,
  SoundCloudProfile,
  AccountStatus,
  Lyrics,
  RemotePlaylist,
  SpotifyPlayback,
  StreamInfo,
  Settings,
  Track,
  ListenEntry,
  SongInfo,
} from '../shared/types'

const api = {
  library: {
    get: (): Promise<LibraryState> => ipcRenderer.invoke('library:get'),
    addFolder: (): Promise<LibraryState> => ipcRenderer.invoke('library:addFolder'),
    removeFolder: (dir: string): Promise<LibraryState> => ipcRenderer.invoke('library:removeFolder', dir),
    rescan: (): Promise<LibraryState> => ipcRenderer.invoke('library:rescan'),
    showInFolder: (id: string): Promise<void> => ipcRenderer.invoke('library:showInFolder', id),
    onProgress(cb: (p: ScanProgress) => void) {
      const handler = (_: unknown, p: ScanProgress) => cb(p)
      ipcRenderer.on('library:progress', handler)
      return () => {
        ipcRenderer.removeListener('library:progress', handler)
      }
    },
  },
  sources: {
    search: (source: SourceId, query: string): Promise<Track[]> => ipcRenderer.invoke('sources:search', source, query),
    resolve: (source: SourceId, id: string): Promise<StreamInfo> => ipcRenderer.invoke('sources:resolve', source, id),
    /** find the same song on YouTube Music */
    match: (t: { title: string; artist: string; duration: number }): Promise<Track | null> =>
      ipcRenderer.invoke('sources:match', t),
    /** best-sounding match on YouTube Music or SoundCloud, with its stream ready to play */
    bestAlternative: (t: {
      title: string
      artist: string
      duration: number
    }): Promise<{ track: Track; stream: StreamInfo; considered: string[] } | null> =>
      ipcRenderer.invoke('sources:bestAlternative', t),
  },
  accounts: {
    status: (s: SourceId): Promise<AccountStatus> => ipcRenderer.invoke('account:status', s),
    login: (s: SourceId, arg?: string): Promise<AccountStatus> => ipcRenderer.invoke('account:login', s, arg),
    logout: (s: SourceId): Promise<AccountStatus> => ipcRenderer.invoke('account:logout', s),
    cancel: (): Promise<void> => ipcRenderer.invoke('account:cancel'),
    /** sign-in code to enter at google.com/device (YouTube) */
    onCode(cb: (c: { source: SourceId; code: string; url: string }) => void) {
      const handler = (_: unknown, c: { source: SourceId; code: string; url: string }) => cb(c)
      ipcRenderer.on('account:code', handler)
      return () => {
        ipcRenderer.removeListener('account:code', handler)
      }
    },
    liked: (s: SourceId): Promise<Track[]> => ipcRenderer.invoke('account:liked', s),
    top: (s: SourceId): Promise<Track[]> => ipcRenderer.invoke('account:top', s),
    playlists: (s: SourceId): Promise<RemotePlaylist[]> => ipcRenderer.invoke('account:playlists', s),
    playlistTracks: (s: SourceId, id: string): Promise<Track[]> => ipcRenderer.invoke('account:playlistTracks', s, id),
    canLike: (s: SourceId): Promise<boolean> => ipcRenderer.invoke('account:canLike', s),
    isLiked: (s: SourceId, ids: string[]): Promise<boolean[]> => ipcRenderer.invoke('account:isLiked', s, ids),
    setLiked: (s: SourceId, id: string, liked: boolean): Promise<void> => ipcRenderer.invoke('account:setLiked', s, id, liked),
    addToPlaylist: (s: SourceId, playlistId: string, trackId: string): Promise<void> =>
      ipcRenderer.invoke('account:addToPlaylist', s, playlistId, trackId),
  },
  soundcloud: {
    findProfiles: (q: string): Promise<SoundCloudProfile[]> => ipcRenderer.invoke('soundcloud:findProfiles', q),
  },
  /** all lyric versions found, best first */
  lyrics: (t: { title: string; artist: string; album: string; duration: number }): Promise<Lyrics[]> =>
    ipcRenderer.invoke('lyrics:get', t),
  /** play controls for Spotify Connect */
  spotify: {
    play: (id: string, positionMs?: number): Promise<void> => ipcRenderer.invoke('spotify:play', id, positionMs),
    pause: (): Promise<void> => ipcRenderer.invoke('spotify:pause'),
    resume: (): Promise<void> => ipcRenderer.invoke('spotify:resume'),
    seek: (ms: number): Promise<void> => ipcRenderer.invoke('spotify:seek', ms),
    volume: (percent: number): Promise<void> => ipcRenderer.invoke('spotify:volume', percent),
    playback: (): Promise<SpotifyPlayback | null> => ipcRenderer.invoke('spotify:playback'),
  },
  songInfo: (t: { title: string; artist: string; duration: number }): Promise<SongInfo | null> =>
    ipcRenderer.invoke('songinfo:get', t),
  history: {
    upsert: (e: ListenEntry): Promise<void> => ipcRenderer.invoke('history:upsert', e),
    list: (offset: number, limit: number): Promise<{ entries: ListenEntry[]; total: number }> =>
      ipcRenderer.invoke('history:list', offset, limit),
    all: (): Promise<ListenEntry[]> => ipcRenderer.invoke('history:all'),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('history:remove', id),
    clear: (): Promise<void> => ipcRenderer.invoke('history:clear'),
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch),
  },
  app: {
    info: (): Promise<{ version: string; dataDir: string; electron: string }> => ipcRenderer.invoke('app:info'),
    openDataFolder: (): Promise<string> => ipcRenderer.invoke('app:openDataFolder'),
    setWindowColors: (bg: string, symbol: string): Promise<void> => ipcRenderer.invoke('app:setWindowColors', bg, symbol),
  },
  playlists: {
    get: (): Promise<Playlist[]> => ipcRenderer.invoke('playlists:get'),
    save: (list: Playlist[]): Promise<void> => ipcRenderer.invoke('playlists:save', list),
    /** opens a file picker; returns the stored image URL, or null if cancelled */
    pickCover: (): Promise<string | null> => ipcRenderer.invoke('playlists:pickCover'),
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
