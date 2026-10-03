import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { Playlist } from '../shared/types'
import { JsonFile } from './json-file'

/**
 * Private copies of the local songs that are in playlists ("Playlist Files" in the data folder),
 * so a playlist keeps working when the original file is moved, renamed, edited or deleted.
 * Copies are keyed by the library track id; a copy is removed once no playlist uses it.
 */
export class KeptFiles {
  readonly dir: string
  private index: JsonFile<Record<string, string>>

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'Playlist Files')
    this.index = new JsonFile(join(dataDir, 'playlist-files.json'), {})
  }

  private lock: Promise<unknown> = Promise.resolve()
  /** copying and pruning never overlap */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn)
    this.lock = run.catch(() => {})
    return run
  }

  async load() {
    await mkdir(this.dir, { recursive: true })
    await this.index.load()
  }

  pathFor(id: string) {
    const name = this.index.get()[id]
    return name ? join(this.dir, name) : undefined
  }

  has(id: string) {
    return id in this.index.get()
  }

  /** Copies the files (if not copied yet). Returns the ids that now have a copy. */
  keep(items: { id: string; path?: string; title: string; artist: string }[]): Promise<string[]> {
    return this.exclusive(() => this.copyAll(items))
  }

  private async copyAll(items: { id: string; path?: string; title: string; artist: string }[]): Promise<string[]> {
    const kept: string[] = []
    let index = { ...this.index.get() }
    for (const it of items) {
      if (index[it.id]) {
        kept.push(it.id)
        continue
      }
      if (!it.path) continue // original already gone and never copied: nothing to copy from
      const safe = `${it.artist} - ${it.title}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 80)
      const name = `${safe} [${it.id.slice(0, 8)}]${extname(it.path).toLowerCase()}`
      try {
        await copyFile(it.path, join(this.dir, name))
        index = { ...index, [it.id]: name }
        kept.push(it.id)
      } catch (err) {
        console.warn('[kept] could not copy', it.path, err)
      }
    }
    await this.index.set(index)
    return kept
  }

  /** Deletes copies no playlist refers to anymore (and stray files in the folder). */
  prune(playlists: Playlist[]) {
    return this.exclusive(() => this.pruneNow(playlists))
  }

  private async pruneNow(playlists: Playlist[]) {
    const used = new Set(playlists.flatMap((p) => p.tracks.filter((t) => t.source === 'local').map((t) => t.id)))
    const index = this.index.get()
    const next: Record<string, string> = {}
    for (const [id, name] of Object.entries(index)) if (used.has(id)) next[id] = name
    if (Object.keys(next).length !== Object.keys(index).length) await this.index.set(next)
    const keep = new Set(Object.values(next))
    for (const f of await readdir(this.dir).catch(() => [] as string[])) {
      if (!keep.has(f)) await rm(join(this.dir, f), { force: true }).catch(() => {})
    }
  }

  /** Total size of the copies, for Settings. */
  async size() {
    let total = 0
    for (const name of Object.values(this.index.get())) total += (await stat(join(this.dir, name)).catch(() => null))?.size ?? 0
    return total
  }
}
