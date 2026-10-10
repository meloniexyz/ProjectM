import { Directory, File, Paths } from 'expo-file-system'
import * as SecureStore from 'expo-secure-store'

/** App data lives in Documents/.projectm (backed up, not visible in the Files app). */
export const dataDir = new Directory(Paths.document, '.projectm')
/** Songs you saved for offline listening (kept until you remove them). */
export const downloadsDir = new Directory(Paths.document, '.projectm', 'downloads')
/** Recently played songs (the system may clear this when the phone runs low on space). */
export const cacheDir = new Directory(Paths.cache, 'audio')
/** Small files: cover art for the lock screen, imported playlist covers, YouTube player script. */
export const miscCacheDir = new Directory(Paths.cache, 'misc')
/** Music you add yourself, visible as "ProjectM" in the Files app (drop songs into Music/). */
export const musicDir = new Directory(Paths.document, 'Music')

export function ensureDirs() {
  for (const d of [dataDir, downloadsDir, cacheDir, miscCacheDir, musicDir]) {
    if (!d.exists) d.create({ intermediates: true, idempotent: true })
  }
}

/** A value kept in memory and saved to a JSON file (writes are batched). */
export class JsonFile<T> {
  private value: T
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly file: File
  private loaded = false

  constructor(
    name: string,
    private readonly fallback: T,
  ) {
    this.file = new File(dataDir, name)
    this.value = fallback
  }

  load(): T {
    if (this.loaded) return this.value
    this.loaded = true
    try {
      if (this.file.exists) this.value = JSON.parse(this.file.textSync()) as T
    } catch {
      this.value = this.fallback // corrupt: start fresh
    }
    return this.value
  }

  get(): T {
    if (!this.loaded) this.load()
    return this.value
  }

  set(value: T, immediate = false) {
    this.value = value
    this.loaded = true
    if (this.timer) clearTimeout(this.timer)
    if (immediate) this.flush()
    else this.timer = setTimeout(() => this.flush(), 400)
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      this.file.write(JSON.stringify(this.value))
    } catch (err) {
      console.warn('[storage] could not save', this.file.uri, err)
    }
  }
}

/** Login tokens, in the iOS keychain. */
export const secrets = {
  get(key: string): string | null {
    try {
      return SecureStore.getItem(key)
    } catch {
      return null
    }
  },
  async set(key: string, value: string | null | undefined) {
    if (value) await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK })
    else await SecureStore.deleteItemAsync(key).catch(() => {})
  },
}

/** Total size of the files in a folder (bytes). */
export function folderSize(dir: Directory): number {
  if (!dir.exists) return 0
  let total = 0
  for (const entry of dir.list()) {
    if (entry instanceof File) total += entry.size ?? 0
    else total += folderSize(entry)
  }
  return total
}

export const fmtBytes = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(0, Math.round(n / 1e3))} KB`
