import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import * as account from '../shared/account'
import type { AccountDevice, AccountSession, DeviceInfo } from '../shared/account'
import { mergePlaylists, type SyncDoc } from '../shared/sync'
import type { Playlist } from '../shared/types'
import type { AccountExtras } from './account-extras'
import type { JsonFile } from './json-file'
import type { Secrets } from './secrets'

/** What Settings → Account shows. */
export interface ProjectMAccountStatus {
  loggedIn: boolean
  email?: string
  syncing: boolean
  lastSync?: number
  error?: string
  /** logged out by the server (password changed elsewhere, removed from the devices list) */
  needsLogin?: boolean
  /** local songs passing between devices */
  relay?: { waitingForDevice: number; waitingForSpace: number; inTransitBytes: number; sending: number; receiving: number }
}

/** Reading and storing playlist cover images on this PC (media://art/...). */
export interface CoverStore {
  /** a cover picked from files, shrunk to a small JPEG for uploading; null if it's gone */
  forUpload(url: string): Promise<Uint8Array | null>
  /** saves a downloaded cover; returns its media://art/ address */
  save(bytes: Uint8Array, type: string): Promise<string>
}

const SESSION = 'projectm-account'
/** the old GitHub playlist sync's token (ProjectM 1.0.12-1.0.15), removed on first login */
const GITHUB_TOKEN = 'github-sync'

/** Keeps this PC's ProjectM playlists in step with the person's ProjectM account (see shared/account.ts). */
export class AccountSync {
  status: ProjectMAccountStatus = { loggedIn: false, syncing: false }
  onStatus: (s: ProjectMAccountStatus) => void = () => {}
  /** called when playlists changed because of another device */
  onPlaylists: (list: Playlist[]) => void = () => {}
  private session: AccountSession | null = null
  private running: Promise<void> | null = null
  private again = false
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly secrets: Secrets,
    private readonly playlists: JsonFile<Playlist[]>,
    private readonly deleted: JsonFile<Record<string, number>>,
    private readonly deviceFile: JsonFile<{ id?: string }>,
    /** local cover address <-> uploaded cover (projectm-cover:<sha256>) */
    private readonly coverMap: JsonFile<Record<string, string>>,
    private readonly covers: CoverStore,
    private readonly afterApply: (list: Playlist[]) => void,
  ) {}

  /** settings, history, platform sign-ins and local songs (set by index.ts) */
  extras: AccountExtras | null = null

  setRelayStatus(relay: ProjectMAccountStatus['relay']) {
    this.set({ relay })
  }

  /** marks local songs that now have a copy on this PC (received from another device) */
  markKept(trackIds: string[]) {
    const ids = new Set(trackIds)
    const list = this.playlists.get().map((p) => (p.tracks.some((t) => ids.has(t.id)) ? { ...p, tracks: p.tracks.map((t) => (ids.has(t.id) ? { ...t, kept: true } : t)) } : p))
    this.playlists.set(list)
    this.onPlaylists(list)
  }

  async load() {
    await Promise.all([this.deleted.load(), this.deviceFile.load(), this.coverMap.load(), this.extras?.load()])
  }

  // ---------- covers picked from files ----------

  /** Uploads covers picked on this PC that the account doesn't have yet. */
  private async uploadCovers(s: AccountSession) {
    const map = { ...this.coverMap.get() }
    const touched = new Set<string>()
    for (const p of this.playlists.get()) {
      if (!p.cover?.startsWith('media://art/') || map[p.cover]) continue
      const bytes = await this.covers.forUpload(p.cover)
      if (!bytes) continue
      const ref = await account.uploadCover(s, bytes, 'image/jpeg')
      map[p.cover] = ref
      map[ref] = p.cover
      touched.add(p.id)
    }
    if (!touched.size) return
    this.coverMap.set(map)
    // the account's copy of these playlists gets the cover: count them as changed so it's sent
    const now = Date.now()
    const list = this.playlists.get().map((p) => (touched.has(p.id) ? { ...p, updatedAt: now } : p))
    this.playlists.set(list)
    this.onPlaylists(list)
  }

  /** Playlists as the account sees them: local cover files replaced by their uploaded copies. */
  private outgoing(list: Playlist[]) {
    const map = this.coverMap.get()
    return list.map((p) => (p.cover && map[p.cover]?.startsWith(account.COVER_PREFIX) ? { ...p, cover: map[p.cover] } : p))
  }

  /** Playlists from the account: uploaded covers become local files (downloaded once). */
  private async incoming(list: Playlist[], s: AccountSession) {
    const map = { ...this.coverMap.get() }
    let changed = false
    const out: Playlist[] = []
    for (const p of list) {
      if (!p.cover?.startsWith(account.COVER_PREFIX)) {
        out.push(p)
        continue
      }
      let local = map[p.cover]
      if (!local) {
        const got = await account.downloadCover(s, p.cover).catch(() => null)
        if (got) {
          local = await this.covers.save(got.bytes, got.type)
          map[p.cover] = local
          map[local] = p.cover
          changed = true
        }
      }
      // not downloaded yet: keep the reference so it isn't lost; the mosaic shows meanwhile
      out.push(local ? { ...p, cover: local } : p)
    }
    if (changed) this.coverMap.set(map)
    return out
  }

  start() {
    const raw = this.secrets.get(SESSION)
    if (raw) {
      try {
        this.session = JSON.parse(raw) as AccountSession
        this.set({ loggedIn: true, email: this.session.email })
        this.syncNow()
      } catch {
        // unreadable: stay logged out
      }
    }
    setInterval(() => this.syncNow(), 2 * 60 * 1000)
  }

  private set(patch: Partial<ProjectMAccountStatus>) {
    this.status = { ...this.status, ...patch }
    this.onStatus(this.status)
  }

  private device(): DeviceInfo {
    let id = this.deviceFile.get().id
    if (!id) {
      id = randomUUID()
      this.deviceFile.set({ id })
    }
    return { id, name: hostname() || 'Windows PC', platform: 'windows' }
  }

  private async begin(session: AccountSession) {
    this.session = session
    await this.secrets.set(SESSION, JSON.stringify(session))
    // GitHub playlist sync is replaced by the account: its playlists are already on this PC
    await this.secrets.set(GITHUB_TOKEN, undefined)
    this.extras?.onLogin()
    this.set({ loggedIn: true, email: session.email, needsLogin: false, error: undefined })
    await this.syncNow()
  }

  // ---------- account actions (from Settings → Account) ----------

  async signUp(email: string, password: string) {
    const { session, recoveryCode } = await account.signUp(email, password, this.device())
    await this.begin(session)
    return { recoveryCode }
  }

  async logIn(email: string, password: string) {
    await this.begin(await account.logIn(email, password, this.device()))
  }

  async recover(email: string, code: string, newPassword: string) {
    const { session, recoveryCode } = await account.recover(email, code, newPassword, this.device())
    await this.begin(session)
    return { recoveryCode }
  }

  /** New password from this logged-in PC (no old password needed). */
  async changePassword(next: string) {
    await this.guard(account.changePassword(this.need(), next))
  }

  /** Forgot password, no device logged in and no recovery code: after the owner allowed it. */
  async ownerReset(email: string, newPassword: string) {
    const { session, recoveryCode } = await account.ownerReset(email, newPassword, this.device())
    await this.begin(session)
    return { recoveryCode }
  }

  async devices(): Promise<{ devices: AccountDevice[]; thisDevice: string }> {
    const info = await this.guard(account.accountInfo(this.need()))
    return { devices: info.devices, thisDevice: info.thisDevice }
  }

  removeDevice(id: string) {
    return this.guard(account.removeDevice(this.need(), id))
  }

  /** Stops syncing and forgets the session; playlists, settings and history stay on this PC. */
  async logOut() {
    const s = this.session
    this.session = null
    await this.secrets.set(SESSION, undefined)
    this.set({ loggedIn: false, email: undefined, syncing: false, lastSync: undefined, error: undefined, needsLogin: false, relay: undefined })
    await this.extras?.forgetAccountSignIns()
    if (s) await account.logOut(s)
  }

  async deleteAccount(password: string) {
    await account.deleteAccount(this.need(), password)
    await this.logOut()
  }

  private need() {
    if (!this.session) throw new account.AccountError(401, 'signed_out', 'Not logged in')
    return this.session
  }

  /** A request that found the session gone: show "log in again" but keep everything on this PC. */
  private async guard<T>(p: Promise<T>): Promise<T> {
    try {
      return await p
    } catch (e) {
      if (e instanceof account.AccountError && e.signedOut) await this.sessionEnded()
      throw e
    }
  }

  private async sessionEnded() {
    const email = this.session?.email
    this.session = null
    await this.secrets.set(SESSION, undefined)
    this.set({ loggedIn: false, email, syncing: false, needsLogin: true, error: 'Logged out on this PC. Log in again to keep syncing.' })
  }

  // ---------- playlists ----------

  /** A playlist was deleted on this PC: remember it so other devices delete it too. */
  markDeleted(id: string) {
    this.deleted.set({ ...this.deleted.get(), [id]: Date.now() })
  }

  /**
   * Playlists saved by the window. Merged with what's stored, so a window that hadn't seen
   * another device's latest changes yet can't undo them. Returns the list to keep.
   */
  merge(list: Playlist[]) {
    const stored: SyncDoc = { v: 1, updatedAt: 0, playlists: this.playlists.get(), deleted: this.deleted.get() }
    const m = mergePlaylists(list, this.deleted.get(), stored)
    if (this.session) {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => this.syncNow(), 3000)
    }
    return { list: m.playlists, changed: m.localChanged }
  }

  /** Something small changed (e.g. a new song match): sync in a few seconds. */
  soon() {
    if (!this.session) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.syncNow(), 3000)
  }

  /** Runs one sync (or queues another if one is already running). */
  syncNow(): Promise<void> {
    if (!this.session) return Promise.resolve()
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = this.run().finally(() => {
      this.running = null
      if (this.again) {
        this.again = false
        this.syncNow()
      }
    })
    return this.running
  }

  private async run() {
    const s = this.session
    if (!s) return
    this.set({ syncing: true })
    try {
      await this.guard(this.uploadCovers(s))
      const r = await this.guard(account.syncPlaylists(s, () => ({ playlists: this.outgoing(this.playlists.get()), deleted: this.deleted.get() })))
      // the person may have edited while we were online: merge their latest on top
      const online: SyncDoc = { v: 1, updatedAt: 0, playlists: r.playlists, deleted: r.deleted }
      const m = mergePlaylists(this.outgoing(this.playlists.get()), this.deleted.get(), online)
      this.deleted.set(m.deleted)
      if (m.localChanged) {
        const list = await this.incoming(m.playlists, s)
        this.playlists.set(list)
        this.afterApply(list)
        this.onPlaylists(list)
      }
      // something newer than what was uploaded: send it next round
      if (m.upload) this.again = true
      if (this.extras) await this.guard(this.extras.sync(s))
      this.set({ syncing: false, lastSync: Date.now(), error: undefined })
    } catch (e) {
      if (this.session) this.set({ syncing: false, error: (e as Error).message })
    }
  }
}
