import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { parseFile, selectCover, type IAudioMetadata } from 'music-metadata'
import { JsonFile } from './json-file'
import type { LibraryState, ScanProgress, Track } from '../shared/types'

const AUDIO_EXT = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.webm'])
const COVER_NAMES = new Set(['cover', 'folder', 'front', 'album', 'albumart', 'albumartsmall'])
const IMAGE_EXT: Record<string, string> = { '.jpg': 'jpg', '.jpeg': 'jpg', '.png': 'png', '.webp': 'webp' }
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const CONCURRENCY = 6

type LocalTrack = Track & { path: string; mtime: number }
interface Data {
  version: 1
  folders: string[]
  tracks: LocalTrack[]
}
type Progress = (p: ScanProgress) => void

const hash = (data: string | Uint8Array) => createHash('sha1').update(data).digest('hex').slice(0, 16)
const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p)

function isInside(child: string, parent: string) {
  const rel = relative(fold(parent), fold(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Collects audio files under `dir`. Folders we can't open (e.g. "System Volume Information"
 * at a drive root, or other users' folders) are skipped instead of failing the whole scan.
 */
async function walk(dir: string, out: string[]) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '$RECYCLE.BIN' || e.name === 'System Volume Information') continue
      await walk(full, out)
    } else if (e.isFile() && AUDIO_EXT.has(extname(e.name).toLowerCase())) out.push(full)
  }
}

export class Library {
  readonly artDir: string
  private store: JsonFile<Data>
  private byId = new Map<string, LocalTrack>()
  private knownArt = new Set<string>()
  private lock: Promise<unknown> = Promise.resolve()

  constructor(dataDir: string) {
    this.artDir = join(dataDir, 'art')
    this.store = new JsonFile<Data>(join(dataDir, 'library.json'), { version: 1, folders: [], tracks: [] })
  }

  async load() {
    await mkdir(this.artDir, { recursive: true })
    await this.store.load()
    for (const f of await readdir(this.artDir)) this.knownArt.add(f)
    this.reindex()
  }

  state(): LibraryState {
    const { folders, tracks } = this.store.get()
    return { folders, tracks }
  }

  pathFor(id: string) {
    return this.byId.get(id)?.path
  }

  addFolders(dirs: string[], progress: Progress) {
    return this.exclusive(async () => {
      let folders = this.store.get().folders
      for (const dir of dirs.map((d) => resolve(d))) {
        if (folders.some((f) => isInside(dir, f))) continue // already covered
        folders = [...folders.filter((f) => !isInside(f, dir)), dir] // new folder swallows its subfolders
      }
      await this.scan(folders, progress)
    })
  }

  removeFolder(dir: string) {
    return this.exclusive(async () => {
      const folders = this.store.get().folders.filter((f) => f !== dir)
      const tracks = this.store.get().tracks.filter((t) => folders.some((f) => isInside(t.path, f)))
      await this.commit({ version: 1, folders, tracks })
    })
  }

  rescan(progress: Progress) {
    return this.exclusive(() => this.scan(this.store.get().folders, progress))
  }

  /** Runs library mutations one at a time. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn)
    this.lock = run.catch(() => {})
    return run
  }

  private commit(data: Data) {
    const saved = this.store.set(data)
    this.reindex()
    return saved
  }

  private reindex() {
    this.byId = new Map(this.store.get().tracks.map((t) => [t.id, t]))
  }

  private async scan(folders: string[], progress: Progress) {
    progress({ phase: 'listing', done: 0, total: 0 })

    const files: string[] = []
    for (const folder of folders) await walk(folder, files)

    // Unchanged files (same mtime) are reused instead of re-parsed, so rescans are fast.
    const previous = new Map(this.store.get().tracks.map((t) => [t.path, t]))
    const covers = new Map<string, Promise<string | undefined>>()
    const tracks: LocalTrack[] = []
    let next = 0
    let done = 0

    const worker = async () => {
      while (next < files.length) {
        const path = files[next++]
        try {
          const { mtimeMs } = await stat(path)
          const prev = previous.get(path)
          tracks.push(prev && prev.mtime === mtimeMs ? prev : await this.readTrack(path, mtimeMs, covers))
        } catch (err) {
          console.warn('[library] skipped', path, err)
        }
        if (++done % 20 === 0) progress({ phase: 'reading', done, total: files.length })
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))

    await this.commit({ version: 1, folders, tracks })
    progress({ phase: 'done', done: files.length, total: files.length })
  }

  private async readTrack(
    path: string,
    mtime: number,
    covers: Map<string, Promise<string | undefined>>,
  ): Promise<LocalTrack> {
    const id = hash(fold(path))
    let meta: IAudioMetadata | undefined
    try {
      meta = await parseFile(path, { duration: false })
    } catch (err) {
      console.warn('[library] no tags for', path, err)
    }
    const c = meta?.common

    // Untagged files named "Artist - Title.mp3" still get a sensible artist/title.
    const name = basename(path, extname(path))
    const dashed = name.match(/^(.+?)\s+-\s+(.+)$/)

    const pic = c ? selectCover(c.picture) : null
    const artwork = pic
      ? await this.saveArt(pic.data, MIME_EXT[pic.format.toLowerCase()] ?? 'jpg')
      : await this.folderCover(dirname(path), covers)

    return {
      uid: `local:${id}`,
      source: 'local',
      id,
      path,
      mtime,
      title: c?.title?.trim() || (dashed ? dashed[2] : name),
      artist: c?.artist || c?.albumartist || (!c?.title && dashed ? dashed[1] : '') || 'Unknown Artist',
      album: c?.album || 'Unknown Album',
      albumArtist: c?.albumartist || undefined,
      duration: meta?.format.duration ?? 0,
      artwork,
      trackNo: c?.track.no ?? undefined,
      discNo: c?.disk.no ?? undefined,
      year: c?.year,
      // ReplayGain targets -18 LUFS; we target -14, so 4 dB louder
      gainDb: c?.replaygain_track_gain?.dB != null ? c.replaygain_track_gain.dB + 4 : undefined,
    }
  }

  /** Copies an image the user picked (e.g. a playlist cover) into the art store. */
  async importImage(path: string): Promise<string> {
    const ext = IMAGE_EXT[extname(path).toLowerCase()]
    if (!ext) throw new Error('Pick a JPG, PNG or WebP image')
    const { size } = await stat(path)
    if (size > 15 * 1024 * 1024) throw new Error('That image is too big (max 15 MB)')
    return this.saveArt(await readFile(path), ext)
  }

  /** Stores cover art once per unique image, keyed by content hash. */
  private async saveArt(data: Uint8Array, ext: string) {
    const name = `${hash(data)}.${ext}`
    if (!this.knownArt.has(name)) {
      this.knownArt.add(name)
      await writeFile(join(this.artDir, name), data)
    }
    return `media://art/${name}`
  }

  /** Fallback for files without embedded art: cover.jpg / folder.jpg etc. next to the file. */
  private folderCover(dir: string, cache: Map<string, Promise<string | undefined>>) {
    let found = cache.get(dir)
    if (!found) {
      found = (async () => {
        try {
          const hit = (await readdir(dir)).find(
            (f) => COVER_NAMES.has(basename(f, extname(f)).toLowerCase()) && IMAGE_EXT[extname(f).toLowerCase()],
          )
          if (!hit) return undefined
          return await this.saveArt(await readFile(join(dir, hit)), IMAGE_EXT[extname(hit).toLowerCase()])
        } catch {
          return undefined
        }
      })()
      cache.set(dir, found)
    }
    return found
  }
}
