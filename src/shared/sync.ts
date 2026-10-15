// Merging ProjectM playlists between devices (ProjectM accounts, see account.ts). Shared by
// ProjectM (Windows) and ProjectMobile (iOS) - keep both copies of this file identical.
import type { Playlist, Track } from './types'

/** deleted playlists are remembered this long so other devices also delete them */
const TOMBSTONE_MS = 180 * 24 * 3600 * 1000

export interface SyncDoc {
  v: 1
  updatedAt: number
  playlists: Playlist[]
  /** playlist id -> when it was deleted */
  deleted: Record<string, number>
}

// ---------- merging ----------

const isWeb = (u?: string) => !!u && /^https?:\/\//.test(u)
/** a cover uploaded to the account (projectm-cover:<sha256>, see account.ts) travels like a web image */
const isShared = (u?: string) => isWeb(u) || (!!u && u.startsWith('projectm-cover:'))

/** What goes online: device-only bits (local cover files, kept copies) are left out. */
function forUpload(p: Playlist): Playlist {
  return {
    ...p,
    cover: isShared(p.cover) ? p.cover : undefined,
    tracks: p.tracks.map((t) => {
      const { kept: _kept, ...rest } = t
      return isWeb(rest.artwork) ? rest : { ...rest, artwork: undefined }
    }),
  }
}

/** A playlist from another device, keeping this device's own details (local covers, kept copies) where it has them. */
function fromRemote(remote: Playlist, local?: Playlist): Playlist {
  const mine = new Map<string, Track>((local?.tracks ?? []).map((t) => [t.uid, t]))
  return {
    ...remote,
    cover: remote.cover ?? (local?.cover && !isShared(local.cover) ? local.cover : undefined),
    tracks: remote.tracks.map((t) => {
      const m = mine.get(t.uid)
      return m ? { ...t, artwork: t.artwork ?? m.artwork, kept: m.kept } : t
    }),
  }
}

const strip = (u: Record<string, unknown>) => JSON.stringify(u, (_k, v) => (v === undefined ? undefined : v))
const sameList = (a: Playlist[], b: Playlist[]) =>
  a.length === b.length && a.every((p, i) => p.id === b[i].id && p.updatedAt === b[i].updatedAt)

export interface MergeResult {
  /** the playlists this device should have now */
  playlists: Playlist[]
  deleted: Record<string, number>
  /** whether this device's playlists changed */
  localChanged: boolean
  /** the document to upload, or null when the online copy is already up to date */
  upload: SyncDoc | null
}

/** Newest edit wins per playlist; a deletion wins over edits made before it. */
export function mergePlaylists(local: Playlist[], localDeleted: Record<string, number>, remote: SyncDoc | null, now = Date.now()): MergeResult {
  const deleted: Record<string, number> = {}
  for (const src of [localDeleted, remote?.deleted ?? {}])
    for (const [id, at] of Object.entries(src)) if (now - at < TOMBSTONE_MS) deleted[id] = Math.max(deleted[id] ?? 0, at)

  const remoteList = remote?.playlists ?? []
  const remoteById = new Map(remoteList.map((p) => [p.id, p]))
  const localById = new Map(local.map((p) => [p.id, p]))
  const alive = (p: Playlist) => !(deleted[p.id] >= p.updatedAt)

  const playlists: Playlist[] = []
  for (const p of local) {
    if (!alive(p)) continue
    const r = remoteById.get(p.id)
    playlists.push(r && r.updatedAt > p.updatedAt ? fromRemote(r, p) : p)
  }
  for (const r of remoteList) if (!localById.has(r.id) && alive(r)) playlists.push(fromRemote(r))

  const uploadList = playlists.map(forUpload)
  const remoteChanged =
    !remote ||
    !sameList(uploadList, remoteList) ||
    strip(deleted) !== strip(Object.fromEntries(Object.entries(remote.deleted ?? {}).filter(([, at]) => now - at < TOMBSTONE_MS)))
  return {
    playlists,
    deleted,
    localChanged: !sameList(playlists, local),
    upload: remoteChanged ? { v: 1, updatedAt: now, playlists: uploadList, deleted } : null,
  }
}

// UTF-8 safe base64 without Buffer (works in the browser, Electron and React Native)
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function toBase64(text: string) {
  const bytes = new TextEncoder().encode(text)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=')
  }
  return out
}
export function fromBase64(b64: string) {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '')
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let j = 0
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63)
    bytes[j++] = (n >> 16) & 255
    if (clean[i + 2] !== undefined) bytes[j++] = (n >> 8) & 255
    if (clean[i + 3] !== undefined) bytes[j++] = n & 255
  }
  return new TextDecoder().decode(bytes.subarray(0, j))
}
