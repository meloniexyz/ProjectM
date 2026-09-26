import type { Lyrics } from '../shared/types'

/**
 * Lyrics from LRCLIB (lrclib.net), a free, open lyrics database with time-synced lines.
 * Only the song's title/artist/album/duration are sent.
 *
 * A song often has several entries (album version, radio edit, live, ...), each timed to its own
 * recording. We return all good candidates with their lengths so the player can pick the one
 * matching the audio that's actually playing, and let the user switch if it's still off.
 */

const API = 'https://lrclib.net/api'
const HEADERS = { 'User-Agent': 'ProjectM music player (personal use)' }
const cache = new Map<string, Promise<Lyrics[]>>()

interface LrcRecord {
  id: number
  trackName: string
  artistName: string
  albumName?: string
  duration?: number
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

/** "Song (feat. X) - Remastered 2011" -> "Song" */
const cleanTitle = (t: string) =>
  t
    .replace(/\s*[([](feat|ft|with|prod)\.?[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+.*(remaster|version|edit|mix|live).*$/i, '')
    .trim()
const firstArtist = (a: string) => a.split(/,|&| x | feat\.? /i)[0].trim()

function toLyrics(r: LrcRecord): Lyrics | null {
  const base = { id: r.id, duration: r.duration, label: r.albumName || r.trackName }
  if (r.instrumental) return { ...base, instrumental: true, synced: null, plain: null }
  const synced = r.syncedLyrics ? parseLrc(r.syncedLyrics) : null
  if (!synced?.length && !r.plainLyrics) return null
  return { ...base, instrumental: false, synced: synced?.length ? synced : null, plain: r.plainLyrics ?? null }
}

/** Parses "[mm:ss.xx] line" LRC text into sorted { time, text } lines. */
function parseLrc(lrc: string) {
  const lines: { time: number; text: string }[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]
    if (!stamps.length) continue
    const text = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const s of stamps) lines.push({ time: Number(s[1]) * 60 + Number(s[2]), text })
  }
  return lines.sort((a, b) => a.time - b.time)
}

async function lookup(title: string, artist: string, album: string, duration: number): Promise<Lyrics[]> {
  const found = new Map<number, Lyrics>()
  const add = (r: LrcRecord) => {
    const l = toLyrics(r)
    if (l && !found.has(r.id)) found.set(r.id, l)
  }

  // exact signature match (LRCLIB matches duration within ~2 s)
  const exact = new URLSearchParams({ track_name: title, artist_name: artist })
  if (album && !/^(unknown album|youtube music|soundcloud|spotify)$/i.test(album)) exact.set('album_name', album)
  if (duration) exact.set('duration', String(Math.round(duration)))
  const res = await fetch(`${API}/get?${exact}`, { headers: HEADERS }).catch(() => null)
  if (res?.ok) add((await res.json()) as LrcRecord)

  // other versions of the same song
  const q = new URLSearchParams({ track_name: cleanTitle(title), artist_name: firstArtist(artist) })
  const search = await fetch(`${API}/search?${q}`, { headers: HEADERS }).catch(() => null)
  if (search?.ok) {
    for (const r of (await search.json()) as LrcRecord[]) {
      if (!duration || !r.duration || Math.abs(r.duration - duration) <= 20) add(r)
    }
  }

  // closest length first, synced before plain
  return [...found.values()]
    .sort(
      (a, b) =>
        Number(!!b.synced) - Number(!!a.synced) ||
        Math.abs((a.duration ?? duration) - duration) - Math.abs((b.duration ?? duration) - duration),
    )
    .slice(0, 8)
}

export function getLyrics(title: string, artist: string, album: string, duration: number) {
  const key = `${title}|${artist}|${Math.round(duration)}`.toLowerCase()
  let hit = cache.get(key)
  if (!hit) {
    hit = lookup(title, artist, album, duration).catch(() => {
      cache.delete(key) // network error: allow retry later
      return []
    })
    cache.set(key, hit)
  }
  return hit
}
