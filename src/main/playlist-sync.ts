import { hostname } from 'node:os'
import type { Playlist } from '../shared/types'
import { finishDeviceLogin, GitHubSync, mergePlaylists, startDeviceLogin, syncOnce, SyncError, type SyncDoc, type SyncStatus } from '../shared/sync'
import type { JsonFile } from './json-file'
import type { Secrets } from './secrets'

const TOKEN = 'github-sync'

/** Keeps ProjectM playlists in sync with the private GitHub repo (see shared/sync.ts). */
export class PlaylistSync {
  status: SyncStatus = { connected: false, syncing: false }
  onStatus: (s: SyncStatus) => void = () => {}
  /** called when playlists changed because of another device */
  onPlaylists: (list: Playlist[]) => void = () => {}
  private gh: GitHubSync | null = null
  private running: Promise<void> | null = null
  private again = false
  private timer: NodeJS.Timeout | null = null
  private loginId = 0

  constructor(
    private readonly secrets: Secrets,
    private readonly playlists: JsonFile<Playlist[]>,
    private readonly deleted: JsonFile<Record<string, number>>,
    private readonly afterApply: (list: Playlist[]) => void,
  ) {}

  load() {
    return this.deleted.load()
  }

  start() {
    const token = this.secrets.get(TOKEN)
    if (token) {
      this.gh = new GitHubSync(token)
      this.set({ connected: true })
      this.syncNow()
    }
    setInterval(() => this.syncNow(), 2 * 60 * 1000)
  }

  private set(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch }
    this.onStatus(this.status)
  }

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
    if (this.gh) {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => this.syncNow(), 3000)
    }
    return { list: m.playlists, changed: m.localChanged }
  }

  async connect(openUrl: (url: string) => void) {
    const id = ++this.loginId
    this.set({ error: undefined })
    try {
      const code = await startDeviceLogin()
      this.set({ code: { userCode: code.user_code, url: code.verification_uri } })
      openUrl(code.verification_uri)
      const token = await finishDeviceLogin(code, () => id !== this.loginId)
      const gh = new GitHubSync(token)
      const account = await gh.account()
      await this.secrets.set(TOKEN, token)
      this.gh = gh
      this.set({ connected: true, account, code: undefined })
      await this.syncNow()
    } catch (e) {
      if (id === this.loginId) this.set({ code: undefined, error: (e as Error).message })
    }
  }

  cancelConnect() {
    this.loginId++
    this.set({ code: undefined })
  }

  async disconnect() {
    this.loginId++
    this.gh = null
    await this.secrets.set(TOKEN, undefined)
    this.set({ connected: false, account: undefined, lastSync: undefined, error: undefined, code: undefined })
  }

  /** Runs one sync (or queues another if one is already running). */
  syncNow(): Promise<void> {
    if (!this.gh) return Promise.resolve()
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
    const gh = this.gh
    if (!gh) return
    this.set({ syncing: true })
    try {
      if (!this.status.account) this.set({ account: await gh.account() })
      await syncOnce(
        gh,
        () => ({ playlists: this.playlists.get(), deleted: this.deleted.get() }),
        (r) => {
          // the user may have edited while we were online: merge their latest on top
          const now: SyncDoc = { v: 1, updatedAt: 0, playlists: r.playlists, deleted: r.deleted }
          const m = mergePlaylists(this.playlists.get(), this.deleted.get(), now)
          this.deleted.set(m.deleted)
          if (m.localChanged) {
            this.playlists.set(m.playlists)
            this.afterApply(m.playlists)
            this.onPlaylists(m.playlists)
          }
          // something newer than what we uploaded: send it next round
          if (m.upload) this.again = true
        },
        hostname() || 'Windows PC',
      )
      this.set({ syncing: false, lastSync: Date.now(), error: undefined })
    } catch (e) {
      if (e instanceof SyncError && e.signedOut) await this.disconnect()
      this.set({ syncing: false, error: (e as Error).message })
    }
  }
}
