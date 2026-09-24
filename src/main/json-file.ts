import { readFile, rename, writeFile } from 'node:fs/promises'

/** A value kept in memory and persisted to a JSON file. Writes are serialized and atomic (tmp + rename). */
export class JsonFile<T> {
  private value: T
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string,
    fallback: T,
  ) {
    this.value = fallback
  }

  async load(): Promise<T> {
    try {
      this.value = JSON.parse(await readFile(this.path, 'utf8'))
    } catch {
      // missing or corrupt: keep the fallback
    }
    return this.value
  }

  get(): T {
    return this.value
  }

  set(value: T): Promise<void> {
    this.value = value
    this.writing = this.writing
      .then(async () => {
        const tmp = `${this.path}.tmp`
        await writeFile(tmp, JSON.stringify(value))
        await rename(tmp, this.path)
      })
      .catch((err) => console.error('[store] failed to save', this.path, err))
    return this.writing
  }
}
