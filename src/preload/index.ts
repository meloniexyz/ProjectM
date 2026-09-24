import { contextBridge, ipcRenderer } from 'electron'
import type { LibraryState, Playlist, ScanProgress, SourceId, StreamInfo, Track } from '../shared/types'

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
  playlists: {
    get: (): Promise<Playlist[]> => ipcRenderer.invoke('playlists:get'),
    save: (list: Playlist[]): Promise<void> => ipcRenderer.invoke('playlists:save', list),
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
