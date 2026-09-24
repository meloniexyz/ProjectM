import type { Lyrics } from '../shared/types'

/**
 * Lyrics from LRCLIB (lrclib.net), a free, open lyrics database with time-synced lines.
 * Only the song's title/artist/album/duration are sent.
 */

const API = 'https://lrclib.net/api'
const HEADERS = { 'User-Agent': 'ProjectM music player (personal use)' }
const cache = new Map<string, Promise<Lyrics | null>>()

interface LrcRecord {
  trackName: string
  artistName: string
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
  if (r.instrumental) return { instrumental: true, synced: null, plain: null }
  const synced = r.syncedLyrics ? parseLrc(r.syncedLyrics) : null
  if (!synced?.length && !r.plainLyrics) return null
  return { instrumental: false, synced: synced?.length ? synced : null, plain: r.plainLyrics ?? null }
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

async function lookup(title: string, artist: string, album: string, duration: number): Promise<Lyrics | null> {
  // 1) exact signature match (fast, most accurate)
  const exact = new URLSearchParams({ track_name: title, artist_name: artist })
  if (album && !/^(unknown album|youtube music|soundcloud|spotify)$/i.test(album)) exact.set('album_name', album)
  if (duration) exact.set('duration', String(Math.round(duration)))
  const res = await fetch(`${API}/get?${exact}`, { headers: HEADERS })
  if (res.ok) {
    const found = toLyrics((await res.json()) as LrcRecord)
    if (found) return found
  }

  // 2) fuzzy search, then pick the closest duration (prefer synced)
  const q = new URLSearchParams({ track_name: cleanTitle(title), artist_name: firstArtist(artist) })
  const search = await fetch(`${API}/search?${q}`, { headers: HEADERS })
  if (!search.ok) return null
  const results = ((await search.json()) as LrcRecord[])
    .filter((r) => !duration || !r.duration || Math.abs(r.duration - duration) <= 8)
    .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics))
  for (const r of results) {
    const found = toLyrics(r)
    if (found) return found
  }
  return null
}

export function getLyrics(title: string, artist: string, album: string, duration: number) {
  const key = `${title}|${artist}|${Math.round(duration)}`.toLowerCase()
  let hit = cache.get(key)
  if (!hit) {
    hit = lookup(title, artist, album, duration).catch(() => {
      cache.delete(key) // network error: allow retry later
      return null
    })
    cache.set(key, hit)
  }
  return hit
}
