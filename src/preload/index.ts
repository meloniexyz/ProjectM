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
  Track,
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
  },
  soundcloud: {
    findProfiles: (q: string): Promise<SoundCloudProfile[]> => ipcRenderer.invoke('soundcloud:findProfiles', q),
  },
  lyrics: (t: { title: string; artist: string; album: string; duration: number }): Promise<Lyrics | null> =>
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
  playlists: {
    get: (): Promise<Playlist[]> => ipcRenderer.invoke('playlists:get'),
    save: (list: Playlist[]): Promise<void> => ipcRenderer.invoke('playlists:save', list),
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
