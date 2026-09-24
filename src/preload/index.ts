import { contextBridge, ipcRenderer } from 'electron'
import type { LibraryState, Playlist, ScanProgress } from '../shared/types'

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
  playlists: {
    get: (): Promise<Playlist[]> => ipcRenderer.invoke('playlists:get'),
    save: (list: Playlist[]): Promise<void> => ipcRenderer.invoke('playlists:save', list),
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
