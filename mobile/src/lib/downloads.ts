import type { Track } from '../../../src/shared/types'
import { createStore, useStore } from '../../../src/renderer/src/lib/store'
import { ensureOnPhone, isDownloaded, unpin, lookup, cacheStore } from './audioCache'
import { libStore } from './library'
import { canStream, netStore, onWifi } from './net'
import { getSettings, settingsStore } from './settings'
import { cleanError } from './sources'
import { JsonFile } from './storage'

/**
 * Offline playlists, like Spotify's Download switch: turn it on for a playlist or a Liked Songs
 * list and every song in it is saved on the phone (at the "Download quality"), on Wi-Fi only
 * unless you allow mobile data. New songs added to the list download too.
 */

export interface Collection {
  /** 'playlist:<id>', 'liked:<source>' or 'remote:<source>:<id>' */
  key: string
  name: string
  tracks: Track[]
}

const file = new JsonFile<Record<string, Collection>>('downloads.json', {})
export const downloadStore = createStore<{
  collections: Record<string, Collection>
  /** the download running now */
  current: { title: string; done: number; total: number } | null
  /** why downloads are waiting, if they are */
  paused: string | null
}>({ collections: {}, current: null, paused: null })

export function initDownloads() {
  downloadStore.set({ collections: file.get() })
  // ProjectM playlists: keep downloaded ones in sync when songs are added or removed
  let lastPlaylists = libStore.get().playlists
  libStore.subscribe(() => {
    const pls = libStore.get().playlists
    if (pls === lastPlaylists) return
    lastPlaylists = pls
    const cols = { ...downloadStore.get().collections }
    let changed = false
    for (const key of Object.keys(cols)) {
      if (!key.startsWith('playlist:')) continue
      const p = pls.find((x) => `playlist:${x.id}` === key)
      if (!p) {
        delete cols[key]
        changed = true
      } else if (p.tracks !== cols[key].tracks) {
        cols[key] = { ...cols[key], name: p.name, tracks: p.tracks }
        changed = true
      }
    }
    if (changed) commit(cols)
  })
  netStore.subscribe(() => run())
  settingsStore.subscribe(() => run())
  run()
}

function commit(collections: Record<string, Collection>) {
  file.set(collections)
  downloadStore.set({ collections })
  releaseUnused()
  run()
}

export const useCollection = (key: string) => useStore(downloadStore, (s) => s.collections[key])

export function setDownloaded(key: string, name: string, tracks: Track[], on: boolean) {
  const cols = { ...downloadStore.get().collections }
  if (on) cols[key] = { key, name, tracks }
  else delete cols[key]
  commit(cols)
}

/** A downloaded list was refreshed from the service: download what's new. */
export function updateCollection(key: string, tracks: Track[]) {
  const cur = downloadStore.get().collections[key]
  if (!cur) return
  commit({ ...downloadStore.get().collections, [key]: { ...cur, tracks } })
}

/** Songs no downloaded list contains any more go back to being normal cached songs. */
function releaseUnused() {
  const wanted = new Set<string>()
  for (const c of Object.values(downloadStore.get().collections)) for (const t of c.tracks) wanted.add(t.uid)
  for (const c of Object.values(file.get())) for (const t of c.tracks) wanted.add(t.uid)
  for (const uid of pinnedUids()) if (!wanted.has(uid)) unpin(uid)
}

const pinned = new JsonFile<string[]>('downloaded-uids.json', [])
function pinnedUids() {
  return pinned.get()
}
function rememberPinned(uid: string) {
  if (!pinned.get().includes(uid)) pinned.set([...pinned.get(), uid])
}

/** How many of a list's songs are downloaded. */
export function collectionProgress(c: Collection) {
  const streamable = c.tracks.filter((t) => t.source !== 'local')
  return { done: streamable.filter((t) => isDownloaded(t.uid)).length, total: streamable.length }
}

const failed = new Set<string>() // songs that failed this session (retried next launch)
let running = false

function allowed(): string | null {
  const s = getSettings()
  if (s.offlineMode) return 'Offline mode is on'
  if (!canStream()) return 'Waiting for a connection'
  if (!onWifi() && !s.downloadOnCellular) return 'Waiting for Wi-Fi'
  return null
}

function nextToDownload(): Track | null {
  for (const c of Object.values(downloadStore.get().collections)) {
    for (const t of c.tracks) {
      if (t.source === 'local' || failed.has(t.uid)) continue
      if (!isDownloaded(t.uid)) return t
    }
  }
  return null
}

function totals() {
  const all = new Map<string, Track>()
  for (const c of Object.values(downloadStore.get().collections)) for (const t of c.tracks) if (t.source !== 'local') all.set(t.uid, t)
  let done = 0
  for (const uid of all.keys()) if (isDownloaded(uid)) done++
  return { done, total: all.size }
}

/** The download worker: one song at a time, so playback always gets the bandwidth first. */
async function run() {
  if (running) return
  running = true
  try {
    for (;;) {
      const why = allowed()
      const track = nextToDownload()
      if (!track) {
        downloadStore.set({ current: null, paused: null })
        return
      }
      if (why) {
        downloadStore.set({ current: null, paused: why })
        return
      }
      const t = totals()
      downloadStore.set({ current: { title: track.title, done: t.done, total: t.total }, paused: null })
      try {
        const had = lookup(track.uid)
        await ensureOnPhone(track, getSettings().downloadQuality, true)
        if (!had?.pinned) rememberPinned(track.uid)
        cacheStore.set((s) => ({ version: s.version + 1 }))
      } catch (err) {
        console.warn('[downloads]', track.title, cleanError(err).message)
        failed.add(track.uid)
      }
    }
  } finally {
    running = false
  }
}
