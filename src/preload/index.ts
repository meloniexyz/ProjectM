import { contextBridge, ipcRenderer } from 'electron'
import type {
  LibraryState,
  Playlist,
  ScanProgress,
  SourceId,
  SpotifyPlayback,
  SpotifyPlaylist,
  SpotifyStatus,
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
  },
  spotify: {
    status: (): Promise<SpotifyStatus> => ipcRenderer.invoke('spotify:status'),
    login: (clientId: string): Promise<SpotifyStatus> => ipcRenderer.invoke('spotify:login', clientId),
    logout: (): Promise<SpotifyStatus> => ipcRenderer.invoke('spotify:logout'),
    liked: (): Promise<Track[]> => ipcRenderer.invoke('spotify:liked'),
    playlists: (): Promise<SpotifyPlaylist[]> => ipcRenderer.invoke('spotify:playlists'),
    playlistTracks: (id: string): Promise<Track[]> => ipcRenderer.invoke('spotify:playlistTracks', id),
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
