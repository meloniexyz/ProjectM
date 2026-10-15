import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, protocol, screen, shell } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { JsonFile } from './json-file'
import { Library } from './library'
import { handleMedia } from './media'
import { KeptFiles } from './kept-files'
import { updateThumbar } from './thumbar'
import { SoundCloud } from './sources/soundcloud'
import { Spotify } from './sources/spotify'
import type { AccountSource, StreamInfo, StreamingSource } from './sources/types'
import { getLyrics } from './lyrics'
import { ListenHistory } from './history'
import { getSongInfo } from './songinfo'
import { Secrets } from './secrets'
import { AccountSync } from './account-sync'
import { setAccountServer } from '../shared/account'
import { YouTubeMusic } from './sources/youtube'
import { DEFAULT_SETTINGS, type ListenEntry, type Playlist, type ScanProgress, type Settings, type SourceId } from '../shared/types'

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
])

// PROJECTM_DATA lets you run against a throwaway library (handy for testing)
if (process.env.PROJECTM_DATA) app.setPath('userData', process.env.PROJECTM_DATA)

// One ProjectM at a time: launching it again focuses the open window (like Spotify).
if (!app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', () => {
  // the running copy may have lost its window: make a new one rather than doing nothing
  if (!win || win.isDestroyed()) {
    if (app.isReady()) createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})
// Taskbar grouping and the Windows media overlay show "ProjectM"
app.setAppUserModelId('com.projectm.app')

const dataDir = app.getPath('userData')
const library = new Library(dataDir)
const playlists = new JsonFile<Playlist[]>(join(dataDir, 'playlists.json'), [])
const keptFiles = new KeptFiles(dataDir)
const settings = new JsonFile<Settings>(join(dataDir, 'settings.json'), DEFAULT_SETTINGS)
const secrets = new Secrets(join(dataDir, 'accounts.json'))
const listenHistory = new ListenHistory(join(dataDir, 'history.json'))
const youtube = new YouTubeMusic(join(dataDir, 'cache'), secrets)
const spotify = new Spotify(join(dataDir, 'spotify.json'))
const soundcloud = new SoundCloud(secrets)
// PROJECTM_SERVER points a test run at a local projectm-server (wrangler dev)
if (process.env.PROJECTM_SERVER) setAccountServer(process.env.PROJECTM_SERVER)
const accountSync = new AccountSync(
  secrets,
  playlists,
  new JsonFile<Record<string, number>>(join(dataDir, 'deleted-playlists.json'), {}),
  new JsonFile<{ id?: string }>(join(dataDir, 'device.json'), {}),
  (list) => keptFiles.prune(list),
)
accountSync.onStatus = (s) => win?.webContents.send('pmaccount:status', s)
accountSync.onPlaylists = (list) => win?.webContents.send('playlists:changed', list)
const streaming: Partial<Record<SourceId, StreamingSource>> = { youtube, soundcloud, spotify }
const accounts: Partial<Record<SourceId, AccountSource>> = { youtube, soundcloud, spotify }

function streamingSource(id: SourceId) {
  const source = streaming[id]
  if (!source) throw new Error(`${id} is not connected`)
  return source
}
function account(id: SourceId) {
  const source = accounts[id]
  if (!source) throw new Error(`${id} has no account support`)
  return source
}
let win: BrowserWindow | null = null
const windowState = new JsonFile<{ x?: number; y?: number; width: number; height: number; maximized?: boolean; bg?: string; symbol?: string }>(
  join(dataDir, 'window.json'),
  { width: 1320, height: 840 },
)

/** Last window bounds, if they still fit on a connected monitor. */
function savedBounds() {
  const s = windowState.get()
  if (s.x === undefined || s.y === undefined) return { width: s.width, height: s.height }
  const area = screen.getDisplayMatching({ x: s.x, y: s.y, width: s.width, height: s.height }).workArea
  const visible = s.x < area.x + area.width - 100 && s.x + s.width > area.x + 100 && s.y >= area.y - 10 && s.y < area.y + area.height - 100
  return visible ? { x: s.x, y: s.y, width: s.width, height: s.height } : { width: s.width, height: s.height }
}

const BG = '#000000' // default theme (AMOLED Black); the saved theme is applied as soon as the page loads

/** last play state reported by the page, for the taskbar preview buttons */
let thumbState = { playing: false, hasTrack: false }
ipcMain.on('player:state', (_, s: { playing: boolean; hasTrack: boolean }) => {
  if (s.playing === thumbState.playing && s.hasTrack === thumbState.hasTrack) return
  thumbState = { playing: !!s.playing, hasTrack: !!s.hasTrack }
  if (win?.isVisible()) updateThumbar(win, thumbState)
})

function createWindow() {
  win = new BrowserWindow({
    ...savedBounds(),
    minWidth: 940,
    minHeight: 600,
    show: false,
    title: 'ProjectM',
    backgroundColor: windowState.get().bg ?? BG,
    // the installed .exe carries its own icon; in development use the one from build/
    // the logo picked in Themes (saved by the window), else the .exe's own icon / build/ in development
    ...(existsSync(join(dataDir, 'app-icon.png'))
      ? { icon: join(dataDir, 'app-icon.png') }
      : app.isPackaged
        ? {}
        : { icon: join(__dirname, '../../build/icon.png') }),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: windowState.get().bg ?? BG, symbolColor: windowState.get().symbol ?? '#a3a3b2', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      // a music player must keep its timers (loudness meter, Spotify sync) running in the background
      backgroundThrottling: false,
    },
  })

  const reveal = () => {
    if (!win || win.isDestroyed() || win.isVisible()) return
    if (windowState.get().maximized) win.maximize()
    win.show()
    // taskbar preview buttons can only be added once the window is on the taskbar
    updateThumbar(win, thumbState)
  }
  win.once('ready-to-show', reveal)
  // safety net: never stay invisible if the page is slow or fails to signal it's ready
  setTimeout(reveal, 4000)
  win.on('close', () => {
    if (!win) return
    // written synchronously: the app quits right after the window closes
    const state = { ...windowState.get(), ...win.getNormalBounds(), maximized: win.isMaximized() }
    try {
      writeFileSync(join(dataDir, 'window.json'), JSON.stringify(state))
    } catch (err) {
      console.error('[window] could not save size', err)
    }
  })
  win.on('closed', () => {
    win = null
    // hidden helper windows (YouTube's BotGuard) would otherwise keep the app running invisibly
    app.quit()
  })
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
youtube.onDeviceCode = (code) => win?.webContents.send('account:code', { source: 'youtube', ...code })

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
  const path = library.pathFor(id) ?? keptFiles.pathFor(id)
  if (path) shell.showItemInFolder(path)
})
ipcMain.handle('sources:search', (_, source: SourceId, query: string) => streamingSource(source).search(query))
ipcMain.handle('sources:resolve', (_, source: SourceId, id: string) => streamingSource(source).resolve(id))
// Same song on another service, for Spotify songs when the Spotify app isn't available.
ipcMain.handle('sources:match', async (_, t: { title: string; artist: string; duration: number }) => {
  for (const source of [youtube, soundcloud]) {
    const found = await source.match(t).catch(() => null)
    if (found) return found
  }
  return null
})

/**
 * Codecs differ in how good they sound per kbps: Opus beats AAC, AAC beats MP3 at the same
 * bitrate. Effective quality lets e.g. YouTube Opus 134 and SoundCloud AAC 160 be compared fairly.
 */
const CODEC_EFFICIENCY = { opus: 1.4, aac: 1.15, mp3: 1 } as const
const effectiveKbps = (s: StreamInfo) => (s.kbps ?? 96) * CODEC_EFFICIENCY[s.codec ?? 'mp3']

/**
 * The best-sounding copy of a song on YouTube Music or SoundCloud: both are searched at once,
 * only real matches (same artist, length within 15 s) are kept, and their actual streams are
 * compared. When they're about equal (within 8%), the closer match wins.
 */
ipcMain.handle('sources:bestAlternative', async (_, t: { title: string; artist: string; duration: number }) => {
  const candidates = await Promise.all(
    ([['youtube', youtube], ['soundcloud', soundcloud]] as const).map(async ([id, source]) => {
      const m = await source.matchScored(t).catch(() => null)
      if (!m) return null
      const stream = await streamingSource(id).resolve(m.track.id).catch(() => null)
      return stream ? { track: m.track, stream, score: m.score, quality: effectiveKbps(stream) } : null
    }),
  )
  const found = candidates.filter((c) => c !== null)
  if (!found.length) return null
  found.sort((a, b) => {
    const q = b.quality - a.quality
    return Math.abs(q) > Math.max(a.quality, b.quality) * 0.08 ? q : b.score - a.score
  })
  return { track: found[0].track, stream: found[0].stream, considered: found.map((c) => `${c.track.source}: ${c.stream.quality}`) }
})
ipcMain.handle('account:status', (_, s: SourceId) => account(s).status())
ipcMain.handle('account:login', (_, s: SourceId, arg?: string) => account(s).login(arg))
ipcMain.handle('account:cancel', () => youtube.cancelLogin())
ipcMain.handle('soundcloud:findProfiles', (_, q: string) => soundcloud.findProfiles(q))
ipcMain.handle('account:logout', async (_, s: SourceId) => {
  await account(s).logout()
  return account(s).status()
})
ipcMain.handle('account:liked', (_, s: SourceId) => account(s).liked())
ipcMain.handle('account:top', (_, s: SourceId) => (s === 'spotify' ? spotify.top() : account(s).liked()))
ipcMain.handle('account:playlists', (_, s: SourceId) => account(s).playlists())
ipcMain.handle('account:canLike', (_, s: SourceId) => !!accounts[s]?.setLiked)
ipcMain.handle('account:isLiked', async (_, s: SourceId, ids: string[]) => {
  const src = accounts[s]
  if (!src?.isLiked || !(await src.status()).connected) return ids.map(() => false)
  return src.isLiked(ids)
})
ipcMain.handle('account:addToPlaylist', (_, s: SourceId, playlistId: string, trackId: string) => {
  const src = accounts[s]
  if (!src?.addToPlaylist) throw new Error("This platform doesn't allow adding to playlists from other apps")
  return src.addToPlaylist(playlistId, trackId)
})
ipcMain.handle('account:setLiked', (_, s: SourceId, id: string, liked: boolean) => {
  const src = accounts[s]
  if (!src?.setLiked) throw new Error("This platform doesn't allow liking songs from other apps")
  return src.setLiked(id, liked)
})
ipcMain.handle('account:playlistTracks', (_, s: SourceId, id: string) => account(s).playlistTracks(id))
ipcMain.handle('lyrics:get', (_, t: { title: string; artist: string; album: string; duration: number }) =>
  getLyrics(t.title, t.artist, t.album, t.duration),
)
ipcMain.handle('spotify:play', (_, id: string, positionMs?: number) => spotify.play(id, positionMs))
ipcMain.handle('spotify:appOpen', () => spotify.appOpen())
ipcMain.handle('spotify:pause', () => spotify.pause())
ipcMain.handle('spotify:resume', () => spotify.resume())
ipcMain.handle('spotify:seek', (_, ms: number) => spotify.seek(ms))
ipcMain.handle('spotify:volume', (_, percent: number) => spotify.volume(percent))
ipcMain.handle('spotify:playback', () => spotify.playback())
ipcMain.handle('settings:get', () => ({ ...DEFAULT_SETTINGS, ...settings.get() }))
ipcMain.handle('settings:set', async (_, patch: Partial<Settings>) => {
  const next = { ...DEFAULT_SETTINGS, ...settings.get(), ...patch }
  await settings.set(next)
  if ('openAtLogin' in patch) applyOpenAtLogin(next.openAtLogin)
  return next
})
ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataDir, electron: process.versions.electron }))
ipcMain.handle('app:openDataFolder', () => shell.openPath(dataDir))
ipcMain.handle('app:setIcon', async (_, dataUrl: string) => {
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) return
  win?.setIcon(image)
  await writeFile(join(dataDir, 'app-icon.png'), image.toPNG()) // used from the next launch's first frame
  await updateShortcutIcons(image).catch((e) => console.warn('[icon] shortcuts', e))
})

/** An .ico holding the image at the sizes Windows uses (PNG-compressed entries). */
function toIco(image: Electron.NativeImage) {
  const pngs = [16, 24, 32, 48, 64, 256].map((size) => ({ size, data: image.resize({ width: size, height: size, quality: 'best' }).toPNG() }))
  const header = Buffer.alloc(6 + 16 * pngs.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  let offset = header.length
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + i * 16
    header.writeUInt8(size >= 256 ? 0 : size, e)
    header.writeUInt8(size >= 256 ? 0 : size, e + 1)
    header.writeUInt16LE(1, e + 4)
    header.writeUInt16LE(32, e + 6)
    header.writeUInt32LE(data.length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([header, ...pngs.map((p) => p.data)])
}

/**
 * Points ProjectM's desktop, Start menu and pinned-taskbar shortcuts at the chosen logo. Only
 * shortcuts that open this ProjectM.exe are touched. The .ico gets a new name each time so
 * Windows doesn't keep showing its cached old icon.
 */
async function updateShortcutIcons(image: Electron.NativeImage) {
  if (!app.isPackaged) return
  const icons = join(dataDir, 'icons')
  await mkdir(icons, { recursive: true })
  const ico = join(icons, `projectm-${Date.now().toString(36)}.ico`)
  await writeFile(ico, toIco(image))
  const roaming = app.getPath('appData')
  const links = [
    join(app.getPath('desktop'), 'ProjectM.lnk'),
    join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'ProjectM.lnk'),
    join(roaming, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', 'ProjectM.lnk'),
  ]
  const exe = process.execPath.toLowerCase()
  for (const link of links) {
    try {
      if (!existsSync(link)) continue
      const details = shell.readShortcutLink(link)
      if (details.target.toLowerCase() !== exe) continue
      shell.writeShortcutLink(link, 'update', { ...details, icon: ico, iconIndex: 0 })
    } catch {
      // can't read or write this shortcut: leave it
    }
  }
  // older icon files are no longer used by any shortcut
  for (const f of await readdir(icons)) if (join(icons, f) !== ico) await rm(join(icons, f), { force: true })
}
ipcMain.handle('app:setWindowColors', (_, bg: string, symbol: string) => {
  if (!win || win.isDestroyed()) return
  win.setBackgroundColor(bg)
  win.setTitleBarOverlay({ color: bg, symbolColor: symbol, height: 40 })
  windowState.set({ ...windowState.get(), bg, symbol }) // next launch opens in the theme's colours
})

/** Start with Windows. In development the app runs as electron.exe + project folder, so pass the folder along. */
function applyOpenAtLogin(on: boolean) {
  const args = app.isPackaged ? [] : [app.getAppPath()]
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args })
}

ipcMain.handle('songinfo:get', (_, t: { title: string; artist: string; duration: number }) =>
  getSongInfo(t.title, t.artist, t.duration),
)
ipcMain.handle('history:upsert', (_, e: ListenEntry) => listenHistory.upsert(e))
ipcMain.handle('history:list', (_, offset: number, limit: number) => listenHistory.list(offset, limit))
ipcMain.handle('history:all', () => listenHistory.all())
ipcMain.handle('history:remove', (_, id: string) => listenHistory.remove(id))
ipcMain.handle('history:clear', () => listenHistory.clear())
app.on('before-quit', () => void listenHistory.flush())
/** Makes sure every local song in a playlist has its own copy (also upgrades older playlists). */
let keptMigration: Promise<void> | null = null
function keepPlaylistFiles() {
  keptMigration ??= (async () => {
    const list = playlists.get()
    const missing = list.flatMap((p) => p.tracks).filter((t) => t.source === 'local' && !t.kept)
    if (!missing.length) return
    const kept = new Set(await keepTracks(missing.map((t) => t.id)))
    // re-read: the list may have changed while copying
    await playlists.set(
      playlists.get().map((p) => ({ ...p, tracks: p.tracks.map((t) => (kept.has(t.id) && t.source === 'local' ? { ...t, kept: true } : t)) })),
    )
  })().finally(() => (keptMigration = null))
  return keptMigration
}
function keepTracks(ids: string[]) {
  const byId = new Map(library.state().tracks.map((t) => [t.id, t]))
  return keptFiles.keep(
    [...new Set(ids)].map((id) => ({ id, path: library.pathFor(id), title: byId.get(id)?.title ?? id, artist: byId.get(id)?.artist ?? '' })),
  )
}
ipcMain.handle('playlists:get', async () => {
  await keepPlaylistFiles()
  return playlists.get()
})
ipcMain.handle('playlists:save', async (_, saved: Playlist[]) => {
  const { list, changed } = accountSync.merge(saved)
  if (changed) win?.webContents.send('playlists:changed', list)
  await playlists.set(list)
  await keptFiles.prune(list)
})
ipcMain.handle('playlists:deleted', (_, id: string) => accountSync.markDeleted(id))
ipcMain.handle('pmaccount:status', () => accountSync.status)
ipcMain.handle('pmaccount:signUp', (_, email: string, password: string) => accountSync.signUp(email, password))
ipcMain.handle('pmaccount:logIn', (_, email: string, password: string) => accountSync.logIn(email, password))
ipcMain.handle('pmaccount:recover', (_, email: string, code: string, password: string) => accountSync.recover(email, code, password))
ipcMain.handle('pmaccount:changePassword', (_, next: string) => accountSync.changePassword(next))
ipcMain.handle('pmaccount:ownerReset', (_, email: string, password: string) => accountSync.ownerReset(email, password))
ipcMain.handle('pmaccount:devices', () => accountSync.devices())
ipcMain.handle('pmaccount:removeDevice', (_, id: string) => accountSync.removeDevice(id))
ipcMain.handle('pmaccount:logOut', () => accountSync.logOut())
ipcMain.handle('pmaccount:delete', (_, password: string) => accountSync.deleteAccount(password))
ipcMain.handle('pmaccount:syncNow', () => accountSync.syncNow())
ipcMain.handle('playlists:keep', (_, ids: string[]) => keepTracks(ids))
ipcMain.handle('playlists:pickCover', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Choose a playlist picture',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  })
  if (r.canceled || !r.filePaths[0]) return null
  return library.importImage(r.filePaths[0])
})

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark'
  Menu.setApplicationMenu(null)
  await Promise.all([library.load(), playlists.load(), keptFiles.load(), spotify.load(), secrets.load(), windowState.load(), settings.load(), listenHistory.load()])
  await accountSync.load()
  protocol.handle('media', (req) => handleMedia(req, library, youtube, keptFiles))
  createWindow()
  accountSync.start()
  win?.on('focus', () => accountSync.syncNow())
  // Pick up files added/changed while the app was closed.
  if ({ ...DEFAULT_SETTINGS, ...settings.get() }.rescanOnStartup) library.rescan(progress)
})

app.on('window-all-closed', () => app.quit())
