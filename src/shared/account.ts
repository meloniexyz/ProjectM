// ProjectM accounts client, shared by ProjectM (Windows) and ProjectMobile (iOS): keep both copies identical.
// Talks to projectm-server (github.com/meloniexyz/projectm-server). Keys come from shared keys.ts, so the
// password never leaves the device and platform sign-ins are encrypted before they're sent.
import { fromB64, keyProof, lockAccountKey, newAccountLock, newRecoveryCode, normalizeEmail, openJson, passwordKeys, recoveryKeys, sealJson, toB64, unwrapAccountKey } from './keys'
import { mergePlaylists, type MergeResult, type SyncDoc } from './sync'
import { sha256 } from '@noble/hashes/sha2.js'
import type { ListenEntry, Playlist } from './types'

export const ACCOUNT_SERVER = 'https://projectm-server.zmeloniexd.workers.dev'

export interface DeviceInfo {
  /** random id made once per install */
  id: string
  /** shown in the devices list, e.g. "DESKTOP-PC" or "iPhone" */
  name: string
  platform: 'windows' | 'ios'
}

/** What a logged-in device keeps (in DPAPI on Windows, the keychain on iPhone). */
export interface AccountSession {
  email: string
  accountId: string
  token: string
  /** base64 account key: decrypts platform sign-ins; never sent anywhere */
  accountKey: string
}

export interface AccountDevice {
  id: string
  name: string
  platform: string
  lastSeen: number
}

export class AccountError extends Error {
  readonly status: number
  readonly code: string
  readonly retryAfter?: number
  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message)
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
  /** the session no longer works: the device must log in again */
  get signedOut() {
    return this.code === 'signed_out'
  }
}

let server = ACCOUNT_SERVER
/** For tests: point the client at a local server. */
export const setAccountServer = (url: string) => (server = url)

// the platform's fetch; ProjectMobile passes expo/fetch, which can send raw bytes (cover uploads)
let http: typeof fetch = (...args) => fetch(...args)
export const setAccountFetch = (f: typeof fetch) => (http = f)

async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response
  try {
    res = await http(`${server}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new AccountError(0, 'offline', "Can't reach the ProjectM server. Check your internet connection.")
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string; retryAfter?: number }
  if (!res.ok && res.status !== 409) {
    const retry = data.retryAfter ? ` Try again in ${Math.ceil(data.retryAfter / 60)} min.` : ''
    throw new AccountError(res.status, data.error ?? 'server_error', (data.message ?? `Server error (${res.status})`) + retry, data.retryAfter)
  }
  return data
}

// ---------- sign-in ----------

/** Creates an account; returns the session and the recovery code to show once. */
export async function signUp(email: string, password: string, device: DeviceInfo) {
  if (password.length < 8) throw new AccountError(400, 'short_password', 'The password needs at least 8 characters')
  const { accountKey, recoveryCode, lock } = await newAccountLock(password)
  const r = await call<{ token: string; accountId: string; email: string }>('POST', '/v1/signup', { email: normalizeEmail(email), lock, device })
  const session: AccountSession = { email: r.email, accountId: r.accountId, token: r.token, accountKey: toB64(accountKey) }
  return { session, recoveryCode }
}

export async function logIn(email: string, password: string, device: DeviceInfo): Promise<AccountSession> {
  const addr = normalizeEmail(email)
  const lock = await call<{ salt: string; iterations: number }>('GET', `/v1/lock?email=${encodeURIComponent(addr)}`)
  const keys = await passwordKeys(password, lock.salt, lock.iterations)
  const r = await call<{ token: string; accountId: string; email: string; wrappedKey: string }>('POST', '/v1/login', { email: addr, loginKey: keys.loginKey, device })
  return { email: r.email, accountId: r.accountId, token: r.token, accountKey: toB64(unwrapAccountKey(keys.wrapKey, r.wrappedKey)) }
}

/** Forgotten password: the recovery code sets a new one. Returns the session and a new recovery code. */
export async function recover(email: string, code: string, newPassword: string, device: DeviceInfo) {
  if (newPassword.length < 8) throw new AccountError(400, 'short_password', 'The password needs at least 8 characters')
  const addr = normalizeEmail(email)
  const info = await call<{ salt: string; iterations: number; wrappedKey: string }>('GET', `/v1/recovery?email=${encodeURIComponent(addr)}`)
  const rk = await recoveryKeys(code, info.salt, info.iterations)
  let accountKey: Uint8Array
  try {
    accountKey = unwrapAccountKey(rk.wrapKey, info.wrappedKey)
  } catch {
    throw new AccountError(401, 'wrong_recovery', 'Email or recovery code is wrong')
  }
  const recoveryCode = newRecoveryCode()
  const lock = await lockAccountKey(accountKey, newPassword, recoveryCode, info.iterations)
  const r = await call<{ token: string; accountId: string; email: string }>('POST', '/v1/recover', { email: addr, recoveryLoginKey: rk.loginKey, lock, device })
  return { session: { email: r.email, accountId: r.accountId, token: r.token, accountKey: toB64(accountKey) } as AccountSession, recoveryCode }
}

/**
 * New password from a logged-in device, no old password needed (the device proves it holds the
 * account key). Keeps this device logged in, the recovery code and all data; other devices must log in again.
 */
export async function changePassword(session: AccountSession, next: string) {
  if (next.length < 8) throw new AccountError(400, 'short_password', 'The new password needs at least 8 characters')
  const lockInfo = await call<{ salt: string; iterations: number }>('GET', `/v1/lock?email=${encodeURIComponent(session.email)}`)
  const accountKey = fromB64(session.accountKey)
  // the recovery fields of a fresh lock are ignored by the server for a password change
  const { salt, iterations, loginKey, wrappedKey } = await lockAccountKey(accountKey, next, 'UNUSED', lockInfo.iterations)
  await call('POST', '/v1/password', { keyProof: keyProof(accountKey), lock: { salt, iterations, loginKey, wrappedKey } }, session.token)
}

/**
 * Forgot password with no logged-in device and no recovery code: works for 24 hours after the
 * server owner allows it. Starts a new account key, so YouTube Music and SoundCloud must be
 * connected again; playlists, settings and history are kept.
 */
export async function ownerReset(email: string, newPassword: string, device: DeviceInfo) {
  if (newPassword.length < 8) throw new AccountError(400, 'short_password', 'The new password needs at least 8 characters')
  const addr = normalizeEmail(email)
  const { accountKey, recoveryCode, lock } = await newAccountLock(newPassword)
  const r = await call<{ token: string; accountId: string; email: string }>('POST', '/v1/reset', { email: addr, lock, device })
  return { session: { email: r.email, accountId: r.accountId, token: r.token, accountKey: toB64(accountKey) } as AccountSession, recoveryCode }
}

export const accountInfo = (s: AccountSession) => call<{ email: string; accountId: string; thisDevice: string; devices: AccountDevice[] }>('GET', '/v1/me', undefined, s.token)
export const logOut = (s: AccountSession) => call('POST', '/v1/logout', undefined, s.token).catch(() => {})
export const removeDevice = (s: AccountSession, deviceId: string) => call('DELETE', `/v1/devices/${encodeURIComponent(deviceId)}`, undefined, s.token)

export async function deleteAccount(s: AccountSession, password: string) {
  const lock = await call<{ salt: string; iterations: number }>('GET', `/v1/lock?email=${encodeURIComponent(s.email)}`)
  const keys = await passwordKeys(password, lock.salt, lock.iterations)
  await call('POST', '/v1/account/delete', { loginKey: keys.loginKey }, s.token)
}

// ---------- synced documents ----------

type DocKind = 'playlists' | 'look' | 'sound' | 'history' | 'platforms'
interface Doc<T> {
  version: number
  data: T
}

// last copy of each document seen from the server, so an unchanged one isn't downloaded again
const docCache = new Map<string, Doc<unknown>>()

async function getDoc<T>(s: AccountSession, kind: DocKind): Promise<Doc<T> | null> {
  const cacheKey = `${s.accountId}:${kind}`
  const cached = docCache.get(cacheKey) as Doc<T> | undefined
  const have = cached ? `&have=${kind}:${cached.version}` : ''
  const got = (await call<{ docs: Record<string, Doc<T> & { unchanged?: true }> }>('GET', `/v1/docs?kinds=${kind}${have}`, undefined, s.token)).docs[kind]
  if (!got) return null
  if (got.unchanged && cached) return cached
  const doc = { version: got.version, data: got.data }
  docCache.set(cacheKey, doc)
  return doc
}

/**
 * One sync of one document: read it, merge with this device, save the merge if it changed. If another
 * device saved in between (409), merge again with theirs. Network drops get two more tries.
 */
async function syncDoc<T, R>(s: AccountSession, kind: DocKind, merge: (remote: T | null) => { upload: T | null; result: R }): Promise<R> {
  let current: Doc<T> | null = await getDoc<T>(s, kind)
  for (let attempt = 0; attempt < 5; attempt++) {
    const { upload, result } = merge(current?.data ?? null)
    if (!upload) return result
    const res: { version: number; error?: string; data?: T } = await call<{ version: number; error?: string; data?: T }>('PUT', `/v1/docs/${kind}`, { version: current?.version ?? 0, data: upload }, s.token)
    if (!res.error) {
      docCache.set(`${s.accountId}:${kind}`, { version: res.version, data: upload })
      return result
    }
    current = res.version ? { version: res.version, data: res.data as T } : null
    if (current) docCache.set(`${s.accountId}:${kind}`, current)
  }
  throw new AccountError(409, 'busy', 'Another device kept saving at the same time, try again')
}

/** Merges this device's playlists with the account's. The caller applies `playlists` when `localChanged`. */
export function syncPlaylists(s: AccountSession, local: () => { playlists: Playlist[]; deleted: Record<string, number> }): Promise<MergeResult> {
  return syncDoc<SyncDoc, MergeResult>(s, 'playlists', (remote) => {
    const mine = local()
    const r = mergePlaylists(mine.playlists, mine.deleted, remote)
    return { upload: r.upload, result: r }
  })
}

// ---------- settings (look, sound) and platform sign-ins: newest change wins per field ----------

/** Each field with the time it was last changed; fields a device doesn't know are kept for others. */
export interface FieldDoc {
  fields: Record<string, { v: unknown; at: number }>
}

/**
 * Per field, the newer change wins. Returns everything merged, the fields whose value this device
 * should take over, and what to upload (null when the account already has it all).
 */
export function mergeFields(local: FieldDoc, remote: FieldDoc | null) {
  const merged: FieldDoc = { fields: { ...(remote?.fields ?? {}) } }
  const take: string[] = []
  for (const [k, mine] of Object.entries(local.fields)) {
    const theirs = merged.fields[k]
    if (!theirs || mine.at > theirs.at) merged.fields[k] = mine
    else if (JSON.stringify(theirs.v) !== JSON.stringify(mine.v)) take.push(k)
  }
  const same = (a?: { v: unknown; at: number }, b?: { v: unknown; at: number }) => !!a && !!b && a.at === b.at && JSON.stringify(a.v) === JSON.stringify(b.v)
  const upload = !remote || Object.keys(merged.fields).some((k) => !same(merged.fields[k], remote.fields[k])) ? merged : null
  return { merged, take, upload }
}

/**
 * Tracks when this device's synced fields changed: a value that differs from what was last synced
 * counts as changed now. A field never synced from this device counts as oldest, so a device that
 * just logged in takes the account's settings (its own only fill in what the account doesn't have).
 * `known` is kept by the app between syncs.
 */
export function localFields(values: Record<string, unknown>, known: Record<string, { json: string; at: number }>, now = Date.now()): FieldDoc {
  const fields: FieldDoc['fields'] = {}
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue
    const json = JSON.stringify(v)
    fields[k] = { v, at: !known[k] ? 0 : known[k].json === json ? known[k].at : now }
  }
  return { fields }
}

/** What the app keeps as `known` after a sync. */
export const knownFrom = (doc: FieldDoc) => Object.fromEntries(Object.entries(doc.fields).map(([k, f]) => [k, { json: JSON.stringify(f.v), at: f.at }]))

/** Look or sound settings: merged per setting with the account. */
export function syncSettings(s: AccountSession, kind: 'look' | 'sound', local: () => FieldDoc) {
  return syncDoc<FieldDoc, ReturnType<typeof mergeFields>>(s, kind, (remote) => {
    const r = mergeFields(local(), remote)
    return { upload: r.upload, result: r }
  })
}

/**
 * Platform sign-ins (YouTube Music, SoundCloud, Spotify Client ID), encrypted on the device with the
 * account key: the server only ever sees the sealed blob. A disconnect is a field with value null.
 */
export function syncPlatforms(s: AccountSession, local: () => FieldDoc) {
  const key = fromB64(s.accountKey)
  return syncDoc<{ sealed: string }, ReturnType<typeof mergeFields>>(s, 'platforms', (remote) => {
    let open: FieldDoc | null = null
    if (remote?.sealed) {
      try {
        open = openJson<FieldDoc>(key, remote.sealed)
      } catch {
        open = null // sealed with an older key (after an owner reset): start over
      }
    }
    const r = mergeFields(local(), open)
    return { upload: r.upload ? { sealed: sealJson(key, r.upload) } : null, result: r }
  })
}

// ---------- listening history ----------

export interface HistoryChanges {
  entries: ListenEntry[]
  removed: string[]
  clearedBefore: number
  cursor: number
}

/** Sends this device's new or updated plays, removals and "clear history". */
export function sendHistory(s: AccountSession, changes: { entries?: ListenEntry[]; removed?: string[]; clearedBefore?: number }) {
  return call('POST', '/v1/history', changes, s.token)
}

/** Plays changed on any device since `cursor` (0 = everything). */
export async function fetchHistory(s: AccountSession, cursor: number): Promise<HistoryChanges> {
  const out: HistoryChanges = { entries: [], removed: [], clearedBefore: 0, cursor }
  for (let page = 0; page < 10; page++) {
    const r = await call<HistoryChanges & { more: boolean }>('GET', `/v1/history?since=${out.cursor}`, undefined, s.token)
    out.entries.push(...r.entries)
    out.removed.push(...r.removed)
    out.clearedBefore = r.clearedBefore
    out.cursor = r.cursor
    if (!r.more) break
  }
  return out
}

// ---------- local songs passing between devices ----------

/** The same song on every device: normalized title + main artist (file paths differ per device). */
export function songKey(title: string, artist: string) {
  const squash = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const main = artist.split(/,|&| feat\.? | ft\.? /i)[0] ?? ''
  return [...sha256(new TextEncoder().encode(`${squash(title)}|${squash(main)}`))]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export interface RelayPlan {
  /** songs on the server for this device */
  downloads: string[]
  /** songs this device should upload (another device needs them) */
  uploads: string[]
  /** needed songs no device has uploaded yet */
  waitingForDevice: number
  /** songs waiting for the account's 250 MB to free up */
  waitingForSpace: number
  inTransitBytes: number
}

export const relayReport = (s: AccountSession, have: { key: string; size: number }[], need: { key: string; title: string; artist: string; duration: number }[]) =>
  call<RelayPlan>('POST', '/v1/relay/report', { have, need }, s.token)

export async function relayUpload(s: AccountSession, key: string, bytes: Uint8Array, type: string, name: string) {
  const res = await http(`${server}/v1/relay/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) },
    body: new Uint8Array(bytes),
  })
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    throw new AccountError(res.status, d.error ?? 'server_error', d.message ?? `Upload failed (${res.status})`)
  }
}

export async function relayDownload(s: AccountSession, key: string): Promise<{ bytes: Uint8Array; type: string; name: string } | null> {
  const res = await http(`${server}/v1/relay/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${s.token}` } })
  if (res.status === 404) return null
  if (!res.ok) throw new AccountError(res.status, res.status === 401 ? 'signed_out' : 'server_error', `Download failed (${res.status})`)
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('Content-Type') ?? 'audio/mpeg', name: decodeURIComponent(res.headers.get('X-File-Name') ?? '') }
}

export const relayDone = (s: AccountSession, key: string) => call('POST', `/v1/relay/${encodeURIComponent(key)}/done`, undefined, s.token)

// ---------- playlist covers picked from files ----------

/** Playlists refer to uploaded covers as projectm-cover:<sha256>. */
export const COVER_PREFIX = 'projectm-cover:'

export async function uploadCover(s: AccountSession, bytes: Uint8Array, type: 'image/jpeg' | 'image/png' | 'image/webp') {
  const body = new Uint8Array(bytes) // a plain ArrayBuffer-backed copy for fetch
  const hash = [...sha256(body)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const res = await http(`${server}/v1/covers/${hash}`, { method: 'PUT', headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': type }, body })
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    throw new AccountError(res.status, d.error ?? 'server_error', d.message ?? `Cover upload failed (${res.status})`)
  }
  return `${COVER_PREFIX}${hash}`
}

export async function downloadCover(s: AccountSession, ref: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  const hash = ref.slice(COVER_PREFIX.length)
  const res = await http(`${server}/v1/covers/${hash}`, { headers: { Authorization: `Bearer ${s.token}` } })
  if (res.status === 404) return null
  if (!res.ok) throw new AccountError(res.status, res.status === 401 ? 'signed_out' : 'server_error', `Cover download failed (${res.status})`)
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('Content-Type') ?? 'image/jpeg' }
}
