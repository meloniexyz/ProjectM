import { JsonFile } from './json-file'
import type { ListenEntry } from '../shared/types'

const MAX_ENTRIES = 50_000

/** Every play, newest first, stored in history.json. Writes are batched every few seconds. */
export class ListenHistory {
  private file: JsonFile<ListenEntry[]>
  private timer: NodeJS.Timeout | null = null

  constructor(path: string) {
    this.file = new JsonFile<ListenEntry[]>(path, [])
  }

  load() {
    return this.file.load()
  }

  list(offset = 0, limit = 500): { entries: ListenEntry[]; total: number } {
    const all = this.file.get()
    return { entries: all.slice(offset, offset + limit), total: all.length }
  }

  all() {
    return this.file.get()
  }

  /** told about local changes, so the account can send them */
  onChange: (change: { upsert?: string; remove?: string; clear?: true }) => void = () => {}

  /** After merging with the account: the whole list, newest first. */
  replaceAll(list: ListenEntry[]) {
    this.save(list.slice(0, MAX_ENTRIES))
  }

  /** Adds a new play or updates it (same id) as it progresses. */
  upsert(entry: ListenEntry) {
    this.onChange({ upsert: entry.id })
    const all = this.file.get()
    const i = all.findIndex((e) => e.id === entry.id)
    const next = i >= 0 ? all.map((e, k) => (k === i ? entry : e)) : [entry, ...all].slice(0, MAX_ENTRIES)
    this.save(next)
  }

  remove(id: string) {
    this.onChange({ remove: id })
    this.save(this.file.get().filter((e) => e.id !== id))
  }

  clear() {
    this.onChange({ clear: true })
    this.save([])
  }

  /** Writes now (on quit) instead of waiting for the batch timer. */
  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    return this.file.set(this.file.get())
  }

  private save(next: ListenEntry[]) {
    // keep in memory right away; write to disk at most every 3 s
    ;(this.file as unknown as { value: ListenEntry[] }).value = next
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.file.set(this.file.get())
    }, 3000)
  }
}
