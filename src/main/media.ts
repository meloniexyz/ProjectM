import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import type { Library } from './library'
import type { YouTubeMusic } from './sources/youtube'

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

/**
 * media://local/<trackId>   -> the audio file of a library track
 * media://art/<hash>.<ext>  -> cached cover art
 * media://youtube/<videoId> -> proxied YouTube audio stream
 * Only files known to the library are served; arbitrary paths are never exposed.
 */
export async function handleMedia(req: Request, library: Library, youtube: YouTubeMusic): Promise<Response> {
  const url = new URL(req.url)
  const name = decodeURIComponent(url.pathname.slice(1))

  if (url.host === 'youtube') {
    try {
      return await youtube.serve(name, req.headers.get('range'))
    } catch (err) {
      return new Response(String((err as Error).message ?? err), { status: 502 })
    }
  }
  if (url.host === 'local') {
    const path = library.pathFor(name)
    if (path) return serveFile(path, req.headers.get('range'))
  } else if (url.host === 'art' && /^[a-f0-9]{16}\.(jpg|png|webp)$/.test(name)) {
    return serveFile(join(library.artDir, name), null, { 'Cache-Control': 'max-age=31536000, immutable' })
  }
  return new Response('Not found', { status: 404 })
}

/** Serves a file with HTTP Range support, which the audio element needs for seeking. */
async function serveFile(path: string, range: string | null, extra: Record<string, string> = {}) {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return new Response('Not found', { status: 404 })
  }

  const headers: Record<string, string> = {
    'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    ...extra,
  }
  let start = 0
  let end = size - 1
  let status = 200

  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
  if (m && (m[1] || m[2])) {
    if (m[1]) {
      start = Number(m[1])
      if (m[2]) end = Math.min(Number(m[2]), size - 1)
    } else {
      start = Math.max(0, size - Number(m[2])) // suffix range: last N bytes
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    status = 206
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  }

  headers['Content-Length'] = String(size === 0 ? 0 : end - start + 1)
  if (size === 0) return new Response(null, { status: 200, headers })

  const body = Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream
  return new Response(body, { status, headers })
}
