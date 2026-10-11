// Playlist sync through a private GitHub repo (<you>/projectm-sync), shared by ProjectM (Windows) and
// ProjectMobile (iOS) - keep both copies of this file identical.
// Sign-in is GitHub's device flow with the "ProjectM Sync" GitHub App, which can only touch that one repo.
import type { Playlist, Track } from './types'

/** Client ID of the "ProjectM Sync" GitHub App (public, not a secret). */
export const SYNC_CLIENT_ID = ''
export const SYNC_REPO_NAME = 'projectm-sync'
const FILE = 'playlists.json'
/** deleted playlists are remembered this long so other devices also delete them */
const TOMBSTONE_MS = 180 * 24 * 3600 * 1000

export interface SyncDoc {
  v: 1
  updatedAt: number
  playlists: Playlist[]
  /** playlist id -> when it was deleted */
  deleted: Record<string, number>
}

/** What the Settings screen shows. */
export interface SyncStatus {
  connected: boolean
  account?: string
  syncing: boolean
  lastSync?: number
  error?: string
  /** while signing in: the code to enter on GitHub */
  code?: { userCode: string; url: string }
}

// ---------- merging ----------

const isWeb = (u?: string) => !!u && /^https?:\/\//.test(u)

/** What goes online: device-only bits (local cover files, kept copies) are left out. */
function forUpload(p: Playlist): Playlist {
  return {
    ...p,
    cover: isWeb(p.cover) ? p.cover : undefined,
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
    cover: remote.cover ?? (local?.cover && !isWeb(local.cover) ? local.cover : undefined),
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

// ---------- GitHub ----------

export interface DeviceCode {
  device_code: string
  user_code: string
  verification_uri: string
  interval: number
  expires_in: number
}

const form = (body: Record<string, string>) => new URLSearchParams(body).toString()

/** Step 1 of signing in: a code for the user to enter at github.com/login/device. */
export async function startDeviceLogin(clientId = SYNC_CLIENT_ID): Promise<DeviceCode> {
  if (!clientId) throw new Error('Sync is not set up in this build yet')
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: clientId }),
  })
  const json = (await res.json()) as DeviceCode & { error_description?: string }
  if (!res.ok || !json.device_code) throw new Error(json.error_description || `GitHub said ${res.status}`)
  return json
}

/** Step 2: waits until the code is entered; resolves with the access token. */
export async function finishDeviceLogin(code: DeviceCode, isCancelled: () => boolean = () => false, clientId = SYNC_CLIENT_ID): Promise<string> {
  let interval = Math.max(code.interval, 5)
  const until = Date.now() + code.expires_in * 1000
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, interval * 1000))
    if (isCancelled()) throw new Error('Cancelled')
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: clientId, device_code: code.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    })
    const json = (await res.json()) as { access_token?: string; error?: string; error_description?: string; interval?: number }
    if (json.access_token) return json.access_token
    if (json.error === 'authorization_pending') continue
    if (json.error === 'slow_down') {
      interval = (json.interval ?? interval) + 1
      continue
    }
    throw new Error(json.error === 'expired_token' ? 'The code expired, try again' : json.error === 'access_denied' ? 'Sign-in was cancelled on GitHub' : json.error_description || json.error || 'Sign-in failed')
  }
  throw new Error('The code expired, try again')
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

export class SyncError extends Error {
  readonly signedOut: boolean
  constructor(message: string, signedOut = false) {
    super(message)
    this.signedOut = signedOut
  }
}

/** Talks to the private sync repo with a signed-in token. */
export class GitHubSync {
  private repo: string | null = null
  private token: string
  constructor(token: string) {
    this.token = token
  }

  private async api(path: string, init: RequestInit = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
    if (res.status === 401) throw new SyncError('Signed out of GitHub, connect sync again', true)
    return res
  }

  /** "<login>/projectm-sync" for the signed-in account. */
  async repoName() {
    if (this.repo) return this.repo
    const res = await this.api('/user')
    if (!res.ok) throw new SyncError(`GitHub said ${res.status}`)
    const { login } = (await res.json()) as { login: string }
    this.repo = `${login}/${SYNC_REPO_NAME}`
    return this.repo
  }

  async account() {
    return (await this.repoName()).split('/')[0]
  }

  /** The online copy and its version (sha), or null if nothing is saved yet. */
  async read(): Promise<{ doc: SyncDoc | null; sha: string | null }> {
    const repo = await this.repoName()
    const res = await this.api(`/repos/${repo}/contents/${FILE}`)
    if (res.status === 404) {
      const r = await this.api(`/repos/${repo}`)
      if (r.status === 404)
        throw new SyncError(`Can't reach the private repo ${repo}. Create it and install the ProjectM Sync app on it.`)
      return { doc: null, sha: null }
    }
    if (!res.ok) throw new SyncError(`GitHub said ${res.status}`)
    const meta = (await res.json()) as { sha: string; content?: string; encoding?: string }
    let b64 = meta.encoding === 'base64' ? meta.content : ''
    if (!b64) {
      // files over 1 MB come back without content; read the blob instead
      const blob = await this.api(`/repos/${repo}/git/blobs/${meta.sha}`)
      if (!blob.ok) throw new SyncError(`GitHub said ${blob.status}`)
      b64 = ((await blob.json()) as { content: string }).content
    }
    const doc = JSON.parse(fromBase64(b64 ?? '')) as SyncDoc
    return { doc: doc && Array.isArray(doc.playlists) ? doc : null, sha: meta.sha }
  }

  /** Saves the online copy; false when someone else saved first (read again and retry). */
  async write(doc: SyncDoc, sha: string | null, device: string): Promise<boolean> {
    const repo = await this.repoName()
    const res = await this.api(`/repos/${repo}/contents/${FILE}`, {
      method: 'PUT',
      body: JSON.stringify({ message: `Playlists from ${device}`, content: toBase64(JSON.stringify(doc)), ...(sha ? { sha } : {}) }),
    })
    if (res.status === 409 || res.status === 422) return false
    if (!res.ok) throw new SyncError(res.status === 403 || res.status === 404 ? `No write access to ${repo}. Install the ProjectM Sync app on it.` : `GitHub said ${res.status}`)
    return true
  }
}

/** One full sync: read, merge, save if needed (retrying when another device saved at the same time). */
export async function syncOnce(
  gh: GitHubSync,
  local: () => { playlists: Playlist[]; deleted: Record<string, number> },
  apply: (r: MergeResult) => void,
  device: string,
): Promise<MergeResult> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { doc, sha } = await gh.read()
    const mine = local()
    const result = mergePlaylists(mine.playlists, mine.deleted, doc)
    if (result.upload && !(await gh.write(result.upload, sha, device))) continue
    apply(result)
    return result
  }
  throw new SyncError('Another device kept saving at the same time, try again')
}
