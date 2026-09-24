import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol, shell } from 'electron'
import { join } from 'node:path'
import { JsonFile } from './json-file'
import { Library } from './library'
import { handleMedia } from './media'
import { SoundCloud } from './sources/soundcloud'
import { Spotify } from './sources/spotify'
import type { StreamingSource } from './sources/types'
import { YouTubeMusic } from './sources/youtube'
import type { Playlist, ScanProgress, SourceId } from '../shared/types'

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
])

// PROJECTM_DATA lets you run against a throwaway library (handy for testing)
if (process.env.PROJECTM_DATA) app.setPath('userData', process.env.PROJECTM_DATA)
const dataDir = app.getPath('userData')
const library = new Library(dataDir)
const playlists = new JsonFile<Playlist[]>(join(dataDir, 'playlists.json'), [])
const youtube = new YouTubeMusic(join(dataDir, 'cache'))
const spotify = new Spotify(join(dataDir, 'spotify.json'))
const streaming: Partial<Record<SourceId, StreamingSource>> = { youtube, soundcloud: new SoundCloud(), spotify }

function streamingSource(id: SourceId) {
  const source = streaming[id]
  if (!source) throw new Error(`${id} is not connected`)
  return source
}
let win: BrowserWindow | null = null

const BG = '#09090c'

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 940,
    minHeight: 600,
    show: false,
    title: 'ProjectM',
    backgroundColor: BG,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG, symbolColor: '#a3a3b2', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
    },
  })

  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('before-input-event', (_, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win?.webContents.toggleDevTools()
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

const progress = (p: ScanProgress) => win?.webContents.send('library:progress', p)

ipcMain.handle('library:get', () => library.state())
ipcMain.handle('library:addFolder', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Add music folder',
    properties: ['openDirectory', 'multiSelections'],
  })
  if (!r.canceled && r.filePaths.length) await library.addFolders(r.filePaths, progress)
  return library.state()
})
ipcMain.handle('library:removeFolder', async (_, dir: string) => {
  await library.removeFolder(dir)
  return library.state()
})
ipcMain.handle('library:rescan', async () => {
  await library.rescan(progress)
  return library.state()
})
ipcMain.handle('library:showInFolder', (_, id: string) => {
  const path = library.pathFor(id)
  if (path) shell.showItemInFolder(path)
})
ipcMain.handle('sources:search', (_, source: SourceId, query: string) => streamingSource(source).search(query))
ipcMain.handle('sources:resolve', (_, source: SourceId, id: string) => streamingSource(source).resolve(id))
ipcMain.handle('spotify:status', () => spotify.status())
ipcMain.handle('spotify:login', (_, clientId: string) => spotify.login(clientId))
ipcMain.handle('spotify:logout', async () => {
  await spotify.logout()
  return spotify.status()
})
ipcMain.handle('spotify:liked', () => spotify.likedSongs())
ipcMain.handle('spotify:playlists', () => spotify.playlists())
ipcMain.handle('spotify:playlistTracks', (_, id: string) => spotify.playlistTracks(id))
ipcMain.handle('spotify:play', (_, id: string, positionMs?: number) => spotify.play(id, positionMs))
ipcMain.handle('spotify:pause', () => spotify.pause())
ipcMain.handle('spotify:resume', () => spotify.resume())
ipcMain.handle('spotify:seek', (_, ms: number) => spotify.seek(ms))
ipcMain.handle('spotify:volume', (_, percent: number) => spotify.volume(percent))
ipcMain.handle('spotify:playback', () => spotify.playback())
ipcMain.handle('playlists:get', () => playlists.get())
ipcMain.handle('playlists:save', (_, list: Playlist[]) => playlists.set(list))

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark'
  Menu.setApplicationMenu(null)
  await Promise.all([library.load(), playlists.load(), spotify.load()])
  protocol.handle('media', (req) => handleMedia(req, library, youtube))
  createWindow()
  // Pick up files added/changed while the app was closed.
  library.rescan(progress)
})

app.on('window-all-closed', () => app.quit())
