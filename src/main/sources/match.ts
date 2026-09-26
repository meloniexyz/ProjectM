import type { Track } from '../../shared/types'

/** Lowercase words without brackets/punctuation, for fuzzy matching. */
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(feat|ft)\b\.?/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

/** 0..1: how many words the two strings share. */
export function overlap(a: string, b: string) {
  const wa = new Set(words(a))
  const wb = words(b)
  if (!wa.size || !wb.length) return 0
  return wb.filter((w) => wa.has(w)).length / Math.max(wa.size, wb.length)
}

export interface MatchTarget {
  title: string
  artist: string
  duration: number
}

/**
 * Picks the candidate that is the same recording: title and artist must mostly agree and the
 * length must be within 15 s (so remixes, live versions and covers lose). Null if none is close.
 */
export function bestMatch(t: MatchTarget, candidates: Track[]): Track | null {
  return scoredMatch(t, candidates)?.track ?? null
}

/** Like bestMatch, with the match score (higher = closer title/artist/length). */
export function scoredMatch(t: MatchTarget, candidates: Track[]): { track: Track; score: number } | null {
  let best: { track: Track; score: number } | null = null
  for (const c of candidates) {
    const dur = t.duration && c.duration ? Math.abs(t.duration - c.duration) : 0
    if (dur > 15) continue
    // SoundCloud uploads often put "Artist - Title" in the title field
    const title = Math.max(overlap(t.title, c.title), overlap(`${t.artist} ${t.title}`, c.title))
    const artist = Math.max(overlap(t.artist, c.artist), overlap(t.artist, c.title))
    if (artist === 0) continue // same title by someone else is a different song
    const score = title * 2 + artist - dur / 10
    if (!best || score > best.score) best = { track: c, score }
  }
  return best && best.score > 1 ? best : null
}
