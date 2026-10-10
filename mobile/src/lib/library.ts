import { Directory, File } from 'expo-file-system'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import type { Playlist, Track } from '../../../src/shared/types'
import { createStore } from '../../../src/renderer/src/lib/store'
import { dataDir, JsonFile, miscCacheDir, musicDir } from './storage'
import { getSettings } from './settings'
import { toast } from './ui'

/**
 * Local music: songs you import (or drop into "ProjectM > Music" in the Files app), plus
 * ProjectM playlists, which can mix songs from every source.
 */

interface LocalEntry extends Track {
  /** path inside the Music folder */
  file: string
  size: number
}

const localFile = new JsonFile<{ tracks: LocalEntry[] }>('local.json', { tracks: [] })
const playlistFile = new JsonFile<Playlist[]>('playlists.json', [])
/** a playlist's own copy of a local song, so it keeps working if the original is removed */
const keptDir = new Directory(dataDir, 'playlist-files')
const coversDir = new Directory(dataDir, 'covers')

export const libStore = createStore<{ tracks: Track[]; playlists: Playlist[]; scanning: boolean }>({
  tracks: [],
  playlists: [],
  scanning: false,
})

const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'alac', 'wav', 'aif', 'aiff', 'caf', 'flac', 'mp4'])

/** FNV-1a, 64-bit-ish (two 32-bit halves) as 16 hex chars. */
function hash(s: string) {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

function visibleTracks(all: LocalEntry[]) {
  return getSettings().hideShortClips ? all.filter((t) => !t.duration || t.duration >= 30) : all
}

export function initLibrary() {
  for (const d of [keptDir, coversDir]) if (!d.exists) d.create({ intermediates: true, idempotent: true })
  libStore.set({ tracks: visibleTracks(localFile.get().tracks), playlists: playlistFile.get() })
  scanMusic().catch((e) => console.warn('[library] scan', e))
}

export function refreshLocalVisibility() {
  libStore.set({ tracks: visibleTracks(localFile.get().tracks) })
}

/** file:// address of a local song: the playlist copy if there is one, else the Music folder file. */
export function localUri(id: string): string | null {
  const entry = localFile.get().tracks.find((t) => t.id === id)
  const ext = entry?.file.split('.').pop()?.toLowerCase()
  for (const e of ext ? [ext, ...AUDIO_EXT] : AUDIO_EXT) {
    const kept = new File(keptDir, `${id}.${e}`)
    if (kept.exists) return kept.uri
  }
  if (!entry) return null
  const f = new File(musicDir, entry.file)
  return f.exists ? f.uri : null
}

// ---------- scanning ----------

function walk(dir: Directory, prefix: string, out: { rel: string; file: File }[]) {
  for (const entry of dir.list()) {
    if (entry instanceof Directory) walk(entry, `${prefix}${entry.name}/`, out)
    else if (AUDIO_EXT.has(entry.extension.replace('.', '').toLowerCase())) out.push({ rel: `${prefix}${entry.name}`, file: entry })
  }
}

let scanning: Promise<void> | null = null

/** Reads new or changed songs in the Music folder (unchanged ones are reused). */
export function scanMusic() {
  scanning ??= (async () => {
    libStore.set({ scanning: true })
    try {
      const found: { rel: string; file: File }[] = []
      if (musicDir.exists) walk(musicDir, '', found)
      const previous = new Map(localFile.get().tracks.map((t) => [t.file, t]))
      const tracks: LocalEntry[] = []
      for (const { rel, file } of found) {
        const size = file.size ?? 0
        const old = previous.get(rel)
        if (old && old.size === size) {
          tracks.push(old)
          continue
        }
        tracks.push(await readTags(rel, file, size))
      }
      localFile.set({ tracks })
      libStore.set({ tracks: visibleTracks(tracks) })
    } finally {
      libStore.set({ scanning: false })
      scanning = null
    }
  })()
  return scanning
}

async function readTags(rel: string, file: File, size: number): Promise<LocalEntry> {
  const id = hash(rel.toLowerCase())
  const name = rel.split('/').pop()!.replace(/\.[^.]+$/, '')
  const dashed = name.match(/^(.+?)\s+-\s+(.+)$/)
  const base: LocalEntry = {
    uid: `local:${id}`,
    source: 'local',
    id,
    file: rel,
    size,
    title: dashed ? dashed[2] : name,
    artist: dashed ? dashed[1] : 'Unknown Artist',
    album: 'Unknown Album',
    duration: 0,
  }
  try {
    const { parseBuffer } = await import('music-metadata')
    const meta = await parseBuffer(await file.bytes(), { path: rel, size }, { duration: true })
    const c = meta.common
    let artwork: string | undefined
    const pic = c.picture?.[0]
    if (pic) {
      const ext = /png/i.test(pic.format) ? 'png' : 'jpg'
      const art = new File(miscCacheDir, `art-${id}.${ext}`)
      art.write(pic.data)
      artwork = art.uri
    }
    return {
      ...base,
      title: c.title?.trim() || base.title,
      artist: c.artist || c.albumartist || base.artist,
      album: c.album || base.album,
      albumArtist: c.albumartist || undefined,
      duration: meta.format.duration ?? 0,
      artwork,
      trackNo: c.track.no ?? undefined,
      discNo: c.disk.no ?? undefined,
      year: c.year,
      // ReplayGain targets -18 LUFS; we level to -14
      gainDb: c.replaygain_track_gain?.dB != null ? c.replaygain_track_gain.dB + 4 : undefined,
    }
  } catch (err) {
    console.warn('[library] tags', rel, err)
    return base
  }
}

/** Pick songs from Files / iCloud Drive and copy them into the Music folder. */
export async function importSongs() {
  const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true })
  if (res.canceled) return 0
  let n = 0
  for (const a of res.assets) {
    try {
      const src = new File(a.uri)
      let dest = new File(musicDir, a.name)
      for (let i = 2; dest.exists; i++) dest = new File(musicDir, a.name.replace(/(\.[^.]+)?$/, ` (${i})$1`))
      src.copySync(dest)
      n++
    } catch (err) {
      console.warn('[library] import', a.name, err)
    }
  }
  await scanMusic()
  return n
}

// ---------- playlists ----------

function commit(playlists: Playlist[]) {
  playlistFile.set(playlists)
  libStore.set({ playlists })
  pruneKept(playlists)
}

const update = (id: string, fn: (p: Playlist) => Partial<Playlist>) =>
  commit(libStore.get().playlists.map((p) => (p.id === id ? { ...p, ...fn(p), updatedAt: Date.now() } : p)))

/** Copies local songs into the playlist folder so the playlist doesn't depend on the original file. */
function keepLocal(tracks: Track[]) {
  for (const t of tracks) {
    if (t.source !== 'local') continue
    const entry = localFile.get().tracks.find((e) => e.id === t.id)
    if (!entry) continue
    const ext = entry.file.split('.').pop()?.toLowerCase() ?? 'mp3'
    const dest = new File(keptDir, `${t.id}.${ext}`)
    if (dest.exists) continue
    try {
      new File(musicDir, entry.file).copySync(dest)
    } catch (err) {
      console.warn('[library] keep', entry.file, err)
    }
  }
}

function pruneKept(playlists: Playlist[]) {
  const used = new Set(playlists.flatMap((p) => p.tracks.filter((t) => t.source === 'local').map((t) => t.id)))
  if (!keptDir.exists) return
  for (const f of keptDir.list()) {
    if (f instanceof File && !used.has(f.name.replace(/\.[^.]+$/, ''))) f.delete()
  }
}

export function createPlaylist(tracks: Track[] = [], name?: string) {
  const { playlists } = libStore.get()
  const now = Date.now()
  const p: Playlist = {
    id: `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    name: name?.trim() || `My Playlist #${playlists.length + 1}`,
    tracks,
    createdAt: now,
    updatedAt: now,
  }
  keepLocal(tracks)
  commit([...playlists, p])
  return p.id
}

export function addToPlaylist(id: string, tracks: Track[]) {
  const p = libStore.get().playlists.find((x) => x.id === id)
  if (!p) return
  const existing = new Set(p.tracks.map((t) => t.uid))
  const added = tracks.filter((t) => !existing.has(t.uid))
  if (!added.length) return toast(`Already in ${p.name}`)
  keepLocal(added)
  update(id, (pl) => ({ tracks: [...pl.tracks, ...added] }))
  toast(`Added to ${p.name}`)
}

export function removeFromPlaylist(id: string, uid: string) {
  update(id, (p) => ({ tracks: p.tracks.filter((t) => t.uid !== uid) }))
}

export function movePlaylistTrack(id: string, from: number, to: number) {
  update(id, (p) => {
    const tracks = p.tracks.slice()
    const [t] = tracks.splice(from, 1)
    tracks.splice(Math.max(0, Math.min(to, tracks.length)), 0, t)
    return { tracks }
  })
}

export function updatePlaylistDetails(id: string, details: { name: string; description: string; cover?: string }) {
  const name = details.name.trim()
  if (!name) return
  update(id, () => ({ name, description: details.description.trim() || undefined, cover: details.cover }))
}

export function deletePlaylist(id: string) {
  commit(libStore.get().playlists.filter((p) => p.id !== id))
}

/** Pick a photo for a playlist cover; returns its file address. */
export async function pickCover(): Promise<string | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 })
  if (res.canceled || !res.assets[0]) return null
  const src = new File(res.assets[0].uri)
  const dest = new File(coversDir, `cover-${Date.now().toString(36)}.jpg`)
  src.copySync(dest)
  return dest.uri
}

export const isPlaylistTrackAvailable = (t: Track) => t.source !== 'local' || !!localUri(t.id)
