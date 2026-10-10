import { Directory, File, Paths } from 'expo-file-system'
import type { SourceId } from '../../../src/shared/types'
import { createStore } from '../../../src/renderer/src/lib/store'
import type { Quality } from './settings'
import { cacheDir, downloadsDir, JsonFile } from './storage'
import { cleanError, resolvePlan, youtube, type StreamPlan } from './sources'
import type { Track } from '../../../src/shared/types'

/**
 * Songs on the phone, like Spotify's cache:
 *  - played songs stay in the cache (up to the size limit), so replays use no data;
 *  - downloaded songs (offline playlists) are kept until you remove them.
 */

export interface CacheEntry {
  uid: string
  /** file name in the cache or downloads folder */
  name: string
  pinned: boolean
  bytes: number
  quality: Quality
  /** e.g. "AAC · 128 kbps" */
  label: string
  /** gain to -14 LUFS, published by the source or measured on the phone */
  gainDb?: number
  /** set when the audio came from another service (Spotify song from YouTube) */
  via?: SourceId
  lastPlayed: number
  savedAt: number
}

const index = new JsonFile<Record<string, CacheEntry>>('audio-index.json', {})
/** bumps whenever songs are added or removed, so "downloaded" badges refresh */
export const cacheStore = createStore<{ version: number }>({ version: 0 })
const bump = () => cacheStore.set((s) => ({ version: s.version + 1 }))

const RANK: Record<Quality, number> = { low: 0, mid: 1, best: 2 }
export const atLeast = (have: Quality, want: Quality) => RANK[have] >= RANK[want]

const safeName = (uid: string, ext: string) => `${uid.replace(/[^\w-]/g, '_')}.${ext}`
const fileOf = (e: CacheEntry) => new File(e.pinned ? downloadsDir : cacheDir, e.name)

/** The song's file, if it's on the phone. */
export function lookup(uid: string): CacheEntry | null {
  const e = index.get()[uid]
  if (!e) return null
  if (!fileOf(e).exists) {
    // iOS may clear the cache folder when space runs low
    const next = { ...index.get() }
    delete next[uid]
    index.set(next)
    return null
  }
  return e
}

export const fileUri = (e: CacheEntry) => fileOf(e).uri
export const isDownloaded = (uid: string) => !!index.get()[uid]?.pinned
export const isOnPhone = (uid: string) => !!index.get()[uid]

export function touch(uid: string) {
  const e = index.get()[uid]
  if (e) index.set({ ...index.get(), [uid]: { ...e, lastPlayed: Date.now() } })
}

export function setGain(uid: string, gainDb: number) {
  const e = index.get()[uid]
  if (e) index.set({ ...index.get(), [uid]: { ...e, gainDb } })
}

// ---------- downloading ----------

/** Downloads one song's audio into `dest` (one file, or HLS segments joined). */
async function fetchInto(plan: StreamPlan, dest: File) {
  if (plan.kind === 'file') {
    await File.downloadFileAsync(plan.url, dest, { idempotent: true })
  } else {
    const res = await fetch(plan.url)
    if (!res.ok) throw new Error(`stream list failed (${res.status})`)
    const text = await res.text()
    const uris: string[] = []
    const map = text.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1]
    if (map) uris.push(map)
    for (const line of text.split(/\r?\n/)) if (line && !line.startsWith('#')) uris.push(line.trim())
    if (!uris.length) throw new Error('empty stream')
    const abs = uris.map((u) => new URL(u, plan.url).toString())
    const parts = new Directory(Paths.cache, `parts-${Date.now().toString(36)}`)
    parts.create({ intermediates: true, idempotent: true })
    try {
      // a few segments at a time
      const files: File[] = new Array(abs.length)
      let next = 0
      const worker = async () => {
        while (next < abs.length) {
          const i = next++
          files[i] = await File.downloadFileAsync(abs[i], new File(parts, `${String(i).padStart(4, '0')}`), { idempotent: true })
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()])
      if (dest.exists) dest.delete()
      dest.create()
      for (const f of files) dest.write(await f.bytes(), { append: true })
    } finally {
      try {
        parts.delete()
      } catch {
        // leftovers get cleared with the cache
      }
    }
  }
  const size = dest.size ?? 0
  if (size < 16_000) {
    if (dest.exists) dest.delete()
    throw new Error('the download came back empty')
  }
  return size
}

const inFlight = new Map<string, Promise<CacheEntry>>()

/**
 * Makes sure a streaming song is on the phone at (at least) the given quality, downloading it
 * if needed. `pinned` keeps it for offline listening.
 */
export function ensureOnPhone(track: Track, quality: Quality, pinned = false): Promise<CacheEntry> {
  const have = lookup(track.uid)
  if (have && atLeast(have.quality, quality)) {
    if (pinned && !have.pinned) return Promise.resolve(pin(track.uid) ?? have)
    return Promise.resolve(have)
  }
  const key = `${track.uid}|${quality}`
  let job = inFlight.get(key)
  if (!job) {
    job = download(track, quality, pinned || !!have?.pinned).finally(() => inFlight.delete(key))
    inFlight.set(key, job)
  }
  return job
}

async function download(track: Track, quality: Quality, pinned: boolean): Promise<CacheEntry> {
  let resolved = await resolvePlan(track, quality)
  const dir = pinned ? downloadsDir : cacheDir
  const name = safeName(track.uid, resolved.plan.ext)
  const tmp = new File(dir, `${name}.part`)
  let bytes: number
  try {
    bytes = await fetchInto(resolved.plan, tmp)
  } catch (err) {
    // YouTube refused the token: new session, one more try
    if (resolved.plan.source === 'youtube' && /403|401/.test(String(err))) {
      youtube.invalidateSession()
      resolved = await resolvePlan(track, quality)
      bytes = await fetchInto(resolved.plan, tmp)
    } else throw cleanError(err)
  }
  const old = index.get()[track.uid]
  if (old) {
    try {
      fileOf(old).delete()
    } catch {
      // already gone
    }
  }
  const final = new File(dir, name)
  if (final.exists) final.delete()
  tmp.moveSync(final)
  const entry: CacheEntry = {
    uid: track.uid,
    name,
    pinned,
    bytes,
    quality,
    label: resolved.plan.quality,
    gainDb: resolved.plan.gainDb ?? old?.gainDb,
    via: resolved.via?.source,
    lastPlayed: Date.now(),
    savedAt: Date.now(),
  }
  index.set({ ...index.get(), [track.uid]: entry })
  bump()
  return entry
}

/** Keep a cached song for offline listening. */
export function pin(uid: string): CacheEntry | null {
  const e = lookup(uid)
  if (!e) return null
  if (e.pinned) return e
  const moved: CacheEntry = { ...e, pinned: true }
  fileOf(e).moveSync(new File(downloadsDir, e.name))
  index.set({ ...index.get(), [uid]: moved })
  bump()
  return moved
}

/** No longer needed offline: becomes a normal cached song (may be cleared to make room). */
export function unpin(uid: string) {
  const e = lookup(uid)
  if (!e?.pinned) return
  fileOf(e).moveSync(new File(cacheDir, e.name))
  index.set({ ...index.get(), [uid]: { ...e, pinned: false } })
  bump()
}

/** Deletes least recently played cached songs until the cache fits the limit. */
export function trimCache(limitBytes: number, keep: Set<string> = new Set()) {
  const entries = Object.values(index.get()).filter((e) => !e.pinned)
  let total = entries.reduce((s, e) => s + e.bytes, 0)
  if (total <= limitBytes) return
  const next = { ...index.get() }
  for (const e of entries.sort((a, b) => a.lastPlayed - b.lastPlayed)) {
    if (total <= limitBytes) break
    if (keep.has(e.uid)) continue
    try {
      fileOf(e).delete()
    } catch {
      // gone already
    }
    delete next[e.uid]
    total -= e.bytes
  }
  index.set(next)
  bump()
}

export function clearCache(keep: Set<string> = new Set()) {
  trimCache(0, keep)
}

export function removeDownload(uid: string) {
  const e = index.get()[uid]
  if (!e) return
  try {
    fileOf(e).delete()
  } catch {
    // gone already
  }
  const next = { ...index.get() }
  delete next[uid]
  index.set(next)
  bump()
}

export function storageStats() {
  let cache = 0
  let downloads = 0
  let downloadCount = 0
  for (const e of Object.values(index.get())) {
    if (e.pinned) {
      downloads += e.bytes
      downloadCount++
    } else cache += e.bytes
  }
  return { cache, downloads, downloadCount }
}
