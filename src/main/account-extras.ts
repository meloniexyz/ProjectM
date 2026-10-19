import { readFile, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import * as account from '../shared/account'
import type { AccountSession, FieldDoc, SongMatch } from '../shared/account'
import type { ListenEntry, Playlist, Settings, Track } from '../shared/types'
import type { JsonFile } from './json-file'

/**
 * Everything besides playlists that follows a ProjectM account on this PC: look and sound settings,
 * listening history, platform sign-ins and local songs passing between devices.
 */

const LOOK_KEYS = ['theme', 'accent', 'logo'] as const
const SOUND_KEYS = ['eq', 'loudnessLevel', 'normalize'] as const

export interface ExtrasState {
  /** last synced value + change time of each look/sound/platform field */
  known: { look: Record<string, { json: string; at: number }>; sound: Record<string, { json: string; at: number }>; platforms: Record<string, { json: string; at: number }> }
  /** platforms this PC got from the account (removed again on log out) */
  fromAccount: string[]
  history: { cursor: number; pending: string[]; removed: string[]; clearedBefore?: number; sendAll?: boolean }
  /** local songs received from other devices: song key -> playlist track id */
  received: Record<string, string>
}

export const EMPTY_EXTRAS: ExtrasState = {
  known: { look: {}, sound: {}, platforms: {} },
  fromAccount: [],
  // the first sync sends this device's whole history (newest 5000 plays)
  history: { cursor: 0, pending: [], removed: [], sendAll: true },
  received: {},
}

/** What the PC's parts give this module (kept small so it's easy to follow). */
export interface ExtrasHost {
  settings: () => Settings
  applySettings: (patch: Partial<Settings>) => Promise<void>
  history: { all: () => ListenEntry[]; replaceAll: (list: ListenEntry[]) => void; changed: () => void }
  platforms: {
    get: () => { youtube?: unknown | null; soundcloud?: unknown | null; spotifyClientId?: string | null }
    set: (field: 'youtube' | 'soundcloud' | 'spotifyClientId', value: unknown | null) => Promise<void>
    changed: () => void
  }
  playlists: () => Playlist[]
  /** this PC's own file for a local song (its library file or a playlist copy), if any */
  localFile: (track: Track) => string | undefined
  /** stores a received song as a playlist copy for the given track id */
  keepReceived: (trackId: string, bytes: Uint8Array, ext: string) => Promise<void>
  /** which recording each Spotify song plays from (the first pick on any device wins) */
  matches: { get: () => Record<string, SongMatch>; set: (all: Record<string, SongMatch>) => Promise<void> }
  relayStatus: (s: { waitingForDevice: number; waitingForSpace: number; inTransitBytes: number; sending: number; receiving: number }) => void
}

export class AccountExtras {
  constructor(
    private readonly state: JsonFile<ExtrasState>,
    private readonly host: ExtrasHost,
  ) {}

  load() {
    return this.state.load()
  }

  private get s() {
    return { ...EMPTY_EXTRAS, ...this.state.get() }
  }

  private save(patch: Partial<ExtrasState>) {
    this.state.set({ ...this.s, ...patch })
  }

  /** First login on this PC: send its whole history. */
  onLogin() {
    this.save({ history: { ...this.s.history, sendAll: true, cursor: 0 } })
  }

  // history hooks (from the History page / player)
  noteUpsert(id: string) {
    const h = this.s.history
    if (!h.pending.includes(id)) this.save({ history: { ...h, pending: [...h.pending, id].slice(-5000) } })
  }
  noteRemove(id: string) {
    const h = this.s.history
    this.save({ history: { ...h, removed: [...h.removed, id], pending: h.pending.filter((p) => p !== id) } })
  }
  noteClear() {
    this.save({ history: { ...this.s.history, clearedBefore: Date.now(), pending: [] } })
  }

  async sync(session: AccountSession) {
    await this.syncSettings(session, 'look', LOOK_KEYS)
    await this.syncSettings(session, 'sound', SOUND_KEYS)
    await this.syncHistory(session)
    await this.syncPlatforms(session)
    await this.syncMatches(session)
    await this.syncRelay(session).catch((e) => console.warn('[account] relay', e))
  }

  private async syncMatches(session: AccountSession) {
    const r = await account.syncMatches(session, () => this.host.matches.get())
    if (Object.keys(r.take).length) await this.host.matches.set({ ...this.host.matches.get(), ...r.take })
  }

  private async syncSettings(session: AccountSession, kind: 'look' | 'sound', keys: readonly (keyof Settings)[]) {
    const cur = this.host.settings()
    const values = Object.fromEntries(keys.map((k) => [k, cur[k]]))
    const r = await account.syncSettings(session, kind, () => account.localFields(values, this.s.known[kind]))
    if (r.take.length) {
      const patch = Object.fromEntries(r.take.filter((k) => (keys as readonly string[]).includes(k)).map((k) => [k, r.merged.fields[k].v])) as Partial<Settings>
      if (Object.keys(patch).length) await this.host.applySettings(patch)
    }
    this.save({ known: { ...this.s.known, [kind]: account.knownFrom(r.merged) } })
  }

  private async syncHistory(session: AccountSession) {
    const h = this.s.history
    const all = this.host.history.all()
    const byId = new Map(all.map((e) => [e.id, e]))
    const entries = h.sendAll ? all.slice(0, 5000) : h.pending.map((id) => byId.get(id)).filter((e): e is ListenEntry => !!e)
    if (entries.length || h.removed.length || h.clearedBefore) {
      for (let i = 0; i < Math.max(entries.length, 1); i += 1000) {
        await account.sendHistory(session, {
          entries: entries.slice(i, i + 1000),
          ...(i === 0 ? { removed: h.removed, ...(h.clearedBefore ? { clearedBefore: h.clearedBefore } : {}) } : {}),
        })
      }
    }
    const got = await account.fetchHistory(session, h.cursor)
    // merge: newest version of each play wins; removals and "clear" apply here too
    const removed = new Set(got.removed)
    const merged = new Map<string, ListenEntry>()
    for (const e of [...this.host.history.all(), ...got.entries]) {
      if (removed.has(e.id) || e.endedAt <= got.clearedBefore) continue
      const prev = merged.get(e.id)
      if (!prev || e.endedAt > prev.endedAt) merged.set(e.id, e)
    }
    const list = [...merged.values()].sort((a, b) => b.startedAt - a.startedAt)
    const before = this.host.history.all()
    if (list.length !== before.length || list.some((e, i) => e.id !== before[i]?.id || e.endedAt !== before[i]?.endedAt)) {
      this.host.history.replaceAll(list)
      this.host.history.changed()
    }
    // anything changed locally while we were syncing stays pending
    const sentIds = new Set(entries.map((e) => e.id))
    const now = this.s.history
    this.save({
      history: {
        cursor: got.cursor,
        pending: now.pending.filter((id) => !sentIds.has(id) || byId.get(id)?.endedAt !== this.host.history.all().find((e) => e.id === id)?.endedAt),
        removed: now.removed.filter((id) => !h.removed.includes(id)),
        clearedBefore: now.clearedBefore !== h.clearedBefore ? now.clearedBefore : undefined,
        sendAll: false,
      },
    })
  }

  private async syncPlatforms(session: AccountSession) {
    const local = this.host.platforms.get()
    const values = Object.fromEntries(Object.entries(local).filter(([, v]) => v !== undefined))
    const r = await account.syncPlatforms(session, () => account.localFields(values, this.s.known.platforms))
    const fromAccount = new Set(this.s.fromAccount)
    for (const k of r.take) {
      if (k !== 'youtube' && k !== 'soundcloud' && k !== 'spotifyClientId') continue
      const v = r.merged.fields[k].v
      await this.host.platforms.set(k, v)
      if (v === null) fromAccount.delete(k)
      else fromAccount.add(k)
    }
    if (r.take.length) this.host.platforms.changed()
    this.save({ known: { ...this.s.known, platforms: account.knownFrom(r.merged) }, fromAccount: [...fromAccount] })
  }

  /** On log out: sign-ins that came from the account are removed from this PC. */
  async forgetAccountSignIns() {
    for (const k of this.s.fromAccount) if (k === 'youtube' || k === 'soundcloud') await this.host.platforms.set(k, null)
    if (this.s.fromAccount.length) this.host.platforms.changed()
    this.state.set(EMPTY_EXTRAS)
  }

  // ---------- local songs ----------

  private async syncRelay(session: AccountSession) {
    const localTracks = new Map<string, Track>()
    for (const p of this.host.playlists()) for (const t of p.tracks) if (t.source === 'local') localTracks.set(account.songKey(t.title, t.artist), t)
    const have: { key: string; size: number }[] = []
    const need: { key: string; title: string; artist: string; duration: number }[] = []
    const files = new Map<string, string>()
    for (const [key, t] of localTracks) {
      const file = this.host.localFile(t)
      const size = file ? (await stat(file).catch(() => null))?.size : undefined
      if (file && size) {
        have.push({ key, size })
        files.set(key, file)
      } else need.push({ key, title: t.title, artist: t.artist, duration: t.duration })
    }
    if (!have.length && !need.length) return this.host.relayStatus({ waitingForDevice: 0, waitingForSpace: 0, inTransitBytes: 0, sending: 0, receiving: 0 })
    const plan = await account.relayReport(session, have, need)
    this.host.relayStatus({ ...plan, sending: plan.uploads.length, receiving: plan.downloads.length })
    for (const key of plan.uploads) {
      const file = files.get(key)!
      const ext = extname(file).slice(1).toLowerCase()
      await account.relayUpload(session, key, new Uint8Array(await readFile(file)), MIME[ext] ?? 'application/octet-stream', `${localTracks.get(key)!.title}.${ext}`)
    }
    for (const key of plan.downloads) {
      const got = await account.relayDownload(session, key)
      if (!got) continue
      const ext = (got.name.split('.').pop() ?? '').toLowerCase() || EXT[got.type] || 'mp3'
      await this.host.keepReceived(localTracks.get(key)!.id, got.bytes, ext)
      await account.relayDone(session, key)
      this.save({ received: { ...this.s.received, [key]: localTracks.get(key)!.id } })
    }
    if (plan.uploads.length || plan.downloads.length) this.host.relayStatus({ ...plan, sending: 0, receiving: 0 })
  }
}

const MIME: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', alac: 'audio/mp4' }
const EXT: Record<string, string> = Object.fromEntries(Object.entries(MIME).map(([k, v]) => [v, k]))

// small helper for index.ts: write a received song where the playlist copies live
export async function writeKept(dir: string, name: string, bytes: Uint8Array) {
  await writeFile(join(dir, name), bytes)
}
