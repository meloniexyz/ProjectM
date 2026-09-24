import { safeStorage } from 'electron'
import { JsonFile } from './json-file'

/**
 * Small encrypted key/value store for account logins (cookies/tokens).
 * Values are encrypted with Windows DPAPI via Electron's safeStorage, so the file is
 * useless if copied to another user or machine.
 */
export class Secrets {
  private file: JsonFile<Record<string, string>>

  constructor(path: string) {
    this.file = new JsonFile(path, {})
  }

  load() {
    return this.file.load()
  }

  get(key: string): string | undefined {
    const stored = this.file.get()[key]
    if (!stored) return undefined
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    } catch {
      return undefined // encrypted by another user/machine
    }
  }

  set(key: string, value: string | undefined) {
    const next = { ...this.file.get() }
    if (value) next[key] = safeStorage.encryptString(value).toString('base64')
    else delete next[key]
    return this.file.set(next)
  }
}
