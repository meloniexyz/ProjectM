import { useMemo } from 'react'
import type { LibraryState, Playlist, ScanProgress, Track } from '../../../shared/types'
import { collator, norm, plural } from './format'
import { getSettings, settingsStore } from './settings'
import { createStore, useStore } from './store'
import { toast } from './ui'

interface LibState {
  ready: boolean
  folders: string[]
  tracks: Track[]
  /** ids of local tracks currently on disk; playlist entries not in here show as unavailable */
  localIds: Set<string>
  scan: ScanProgress | null
  playlists: Playlist[]
}

export const lib = createStore<LibState>({
  ready: false,
  folders: [],
  tracks: [],
  localIds: new Set(),
  scan: null,
  playlists: [],
})

const api = window.api

const SHORT_CLIP_SECONDS = 30
let scanned: LibraryState = { folders: [], tracks: [] }
let hiding = getSettings().hideShortClips

/** Publishes the scanned library, minus short clips (drum samples etc.) if that setting is on. */
function apply(l: LibraryState) {
  scanned = l
  const tracks = hiding ? l.tracks.filter((t) => !(t.duration > 0 && t.duration < SHORT_CLIP_SECONDS)) : l.tracks
  lib.set({ folders: l.folders, tracks, localIds: new Set(tracks.map((t) => t.id)) })
}

settingsStore.subscribe(() => {
  if (getSettings().hideShortClips === hiding) return
  hiding = getSettings().hideShortClips
  apply(scanned)
})

/** How many scanned files are hidden as short clips (for the Settings page). */
export const hiddenClipCount = () => scanned.tracks.length - lib.get().tracks.length

let started = false
export async function initLibrary() {
  if (started) return
  started = true
  api.library.onProgress((p) => {
    lib.set({ scan: p.phase === 'done' ? null : p })
    if (p.phase === 'done') api.library.get().then(apply)
  })
  const [state, playlists] = await Promise.all([api.library.get(), api.playlists.get()])
  apply(state)
  lib.set({ ready: true, playlists })
}

export async function addFolder() {
  apply(await api.library.addFolder())
}

export async function removeFolder(dir: string) {
  apply(await api.library.removeFolder(dir))
}

export async function rescan() {
  apply(await api.library.rescan())
}

export const isAvailable = (t: Track, localIds: Set<string>) => t.source !== 'local' || !!t.kept || localIds.has(t.id)

// ---------- playlists ----------

function commit(playlists: Playlist[]) {
  lib.set({ playlists })
  api.playlists.save(playlists)
}

const updatePlaylist = (id: string, fn: (p: Playlist) => Partial<Playlist>) =>
  commit(lib.get().playlists.map((p) => (p.id === id ? { ...p, ...fn(p), updatedAt: Date.now() } : p)))

/** Gives local songs their own copy, then marks them in every playlist that has them. */
function keepLocal(tracks: Track[]) {
  const ids = tracks.filter((t) => t.source === 'local' && !t.kept).map((t) => t.id)
  if (!ids.length) return
  api.playlists.keep(ids).then((done) => {
    const kept = new Set(done)
    if (!kept.size) return
    commit(
      lib.get().playlists.map((p) =>
        p.tracks.some((t) => t.source === 'local' && kept.has(t.id) && !t.kept)
          ? { ...p, tracks: p.tracks.map((t) => (t.source === 'local' && kept.has(t.id) ? { ...t, kept: true } : t)) }
          : p,
      ),
    )
  })
}

export function createPlaylist(tracks: Track[] = [], name?: string) {
  const { playlists } = lib.get()
  const now = Date.now()
  const p: Playlist = {
    id: crypto.randomUUID(),
    name: name?.trim() || `My Playlist #${playlists.length + 1}`,
    tracks,
    createdAt: now,
    updatedAt: now,
  }
  commit([...playlists, p])
  keepLocal(tracks)
  if (tracks.length) toast(`Added ${plural(tracks.length, 'song')} to ${p.name}`)
  return p.id
}

export function addToPlaylist(id: string, tracks: Track[]) {
  const p = lib.get().playlists.find((x) => x.id === id)
  if (!p) return
  const existing = new Set(p.tracks.map((t) => t.uid))
  const added = tracks.filter((t) => !existing.has(t.uid))
  if (!added.length) return toast(`Already in ${p.name}`)
  updatePlaylist(id, (p) => ({ tracks: [...p.tracks, ...added] }))
  keepLocal(added)
  toast(`Added ${plural(added.length, 'song')} to ${p.name}`)
}

/** Removes every copy of a song (by uid) from a playlist. */
export function removeTrackFromPlaylist(id: string, uid: string) {
  updatePlaylist(id, (p) => ({ tracks: p.tracks.filter((t) => t.uid !== uid) }))
}

export function removeFromPlaylist(id: string, indices: number[]) {
  const drop = new Set(indices)
  updatePlaylist(id, (p) => ({ tracks: p.tracks.filter((_, i) => !drop.has(i)) }))
}

export function updatePlaylistDetails(id: string, details: { name: string; description: string; cover?: string }) {
  const name = details.name.trim()
  if (!name) return
  updatePlaylist(id, () => ({ name, description: details.description.trim() || undefined, cover: details.cover }))
}

/** Which playlist's "Edit details" dialog is open. */
export const editPlaylistStore = createStore<{ id: string | null }>({ id: null })
export const openPlaylistEditor = (id: string) => editPlaylistStore.set({ id })

export function renamePlaylist(id: string, name: string) {
  name = name.trim()
  if (name) updatePlaylist(id, () => ({ name }))
}

export function deletePlaylist(id: string) {
  commit(lib.get().playlists.filter((p) => p.id !== id))
}

// ---------- derived views (cached per tracks array) ----------

export interface Album {
  key: string
  name: string
  artist: string
  year?: number
  artwork?: string
  duration: number
  tracks: Track[]
}

export const albumKey = (t: Track) => `${t.source}|${norm(t.albumArtist || t.artist)}|${norm(t.album)}`

export const byDiscTrack = (a: Track, b: Track) =>
  (a.discNo ?? 1) - (b.discNo ?? 1) || (a.trackNo ?? 0) - (b.trackNo ?? 0) || collator.compare(a.title, b.title)

function cached<R>(fn: (tracks: Track[]) => R) {
  const cache = new WeakMap<Track[], R>()
  return (tracks: Track[]) => {
    let r = cache.get(tracks)
    if (r === undefined) cache.set(tracks, (r = fn(tracks)))
    return r
  }
}

export const sortedLibrary = cached((tracks) =>
  tracks
    .slice()
    .sort(
      (a, b) =>
        collator.compare(a.albumArtist || a.artist, b.albumArtist || b.artist) ||
        collator.compare(a.album, b.album) ||
        byDiscTrack(a, b),
    ),
)

export const groupAlbums = cached((tracks) => {
  const map = new Map<string, Album>()
  for (const t of tracks) {
    const key = albumKey(t)
    let a = map.get(key)
    if (!a) map.set(key, (a = { key, name: t.album, artist: t.albumArtist || t.artist, duration: 0, tracks: [] }))
    a.tracks.push(t)
    a.duration += t.duration
    a.artwork ||= t.artwork
    a.year ||= t.year
  }
  const albums = [...map.values()]
  for (const a of albums) a.tracks.sort(byDiscTrack)
  return albums.sort((a, b) => collator.compare(a.artist, b.artist) || collator.compare(a.name, b.name))
})

const haystacks = new WeakMap<Track, string>()
export function matches(t: Track, tokens: string[]) {
  let h = haystacks.get(t)
  if (h === undefined) haystacks.set(t, (h = norm(`${t.title} ${t.artist} ${t.album} ${t.albumArtist ?? ''}`)))
  return tokens.every((tok) => h.includes(tok))
}

export function useAlbums() {
  const tracks = useStore(lib, (s) => s.tracks)
  return useMemo(() => groupAlbums(tracks), [tracks])
}
