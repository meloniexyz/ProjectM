import type { SongInfo } from '../shared/types'

/**
 * Song details from MusicBrainz (musicbrainz.org), the open music encyclopedia: release date,
 * where/when it was recorded, writers and production credits. Coverage depends on what
 * volunteers have entered: well-known songs usually have plenty, small releases often little.
 * MusicBrainz asks for a descriptive User-Agent and at most one request per second.
 */

const API = 'https://musicbrainz.org/ws/2'
const HEADERS = { 'User-Agent': 'ProjectM/1.0 (personal music player)', Accept: 'application/json' }
const cache = new Map<string, Promise<SongInfo | null>>()

let lastCall = 0
async function mb<T>(path: string): Promise<T> {
  const wait = lastCall + 1100 - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCall = Date.now()
  const res = await fetch(`${API}${path}${path.includes('?') ? '&' : '?'}fmt=json`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`MusicBrainz ${res.status}`)
  return res.json() as Promise<T>
}

interface MbRelation {
  type: string
  'target-type': string
  begin?: string | null
  end?: string | null
  attributes?: string[]
  artist?: { name: string }
  place?: { name: string; area?: { name: string } }
  area?: { name: string }
  work?: { title: string; relations?: MbRelation[] }
}

interface MbRecording {
  id: string
  title: string
  length?: number
  score?: number
  'first-release-date'?: string
  'artist-credit'?: { name: string; joinphrase?: string }[]
  releases?: { title: string; date?: string; status?: string; 'release-group'?: { 'primary-type'?: string } }[]
  isrcs?: string[]
  relations?: MbRelation[]
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
const similar = (a: string, b: string) => {
  const wa = new Set(words(a))
  const wb = words(b)
  if (!wa.size || !wb.length) return 0
  return wb.filter((w) => wa.has(w)).length / Math.max(wa.size, wb.length)
}
const esc = (s: string) => s.replace(/["\\]/g, ' ')

/** Human role names for MusicBrainz relationship types. */
const ROLE: Record<string, string> = {
  producer: 'Produced by',
  engineer: 'Engineered by',
  'audio': 'Engineered by',
  mix: 'Mixed by',
  mastering: 'Mastered by',
  recording: 'Recorded by',
  programming: 'Programmed by',
  vocal: 'Vocals',
  instrument: 'Instruments',
  arranger: 'Arranged by',
  composer: 'Written by',
  lyricist: 'Lyrics by',
  writer: 'Written by',
}

async function lookup(title: string, artist: string, duration: number): Promise<SongInfo | null> {
  const mainArtist = artist.split(/,|&| feat\.? /i)[0].trim()
  const q = `recording:"${esc(title.replace(/\s*[([].*?[)\]]/g, ''))}" AND artist:"${esc(mainArtist)}"`
  const found = await mb<{ recordings: MbRecording[] }>(`/recording?query=${encodeURIComponent(q + " AND video:false")}&limit=60`)

  // candidates: title + artist agree and the length is close
  const good: { rec: MbRecording; match: number }[] = []
  for (const rec of found.recordings ?? []) {
    const credit = (rec['artist-credit'] ?? []).map((c) => c.name).join(' ')
    const t = similar(title, rec.title)
    const a = similar(artist, credit)
    if (t < 0.5 || a === 0) continue
    const lenDiff = duration && rec.length ? Math.abs(rec.length / 1000 - duration) : 5
    if (lenDiff > 12) continue
    good.push({ rec, match: t * 2 + a - lenDiff / 10 })
  }
  if (!good.length) return null
  // among the strong matches prefer the original recording: the earliest release, not a later
  // remaster, remix or compilation (those are separate recordings on MusicBrainz)
  const top = Math.max(...good.map((g) => g.match))
  const best = {
    rec: good
      .filter((g) => g.match >= top - 0.35)
      .sort((x, y) => (x.rec['first-release-date'] || '9999').localeCompare(y.rec['first-release-date'] || '9999'))[0].rec,
  }

  const rec = await mb<MbRecording>(
    `/recording/${best.rec.id}?inc=artist-credits+releases+isrcs+artist-rels+place-rels+area-rels+work-rels+work-level-rels`,
  )

  const credits = new Map<string, Set<string>>()
  const addCredit = (role: string, name: string, detail?: string[]) => {
    const label = ROLE[role] ?? role.replace(/^\w/, (c) => c.toUpperCase())
    const key = role === 'instrument' && detail?.length ? `${detail.join(', ')}`.replace(/^\w/, (c) => c.toUpperCase()) : label
    if (!credits.has(key)) credits.set(key, new Set())
    credits.get(key)!.add(name)
  }
  const recordedAt: SongInfo['recordedAt'] = []
  for (const r of rec.relations ?? []) {
    if (r['target-type'] === 'artist' && r.artist) addCredit(r.type, r.artist.name, r.attributes)
    if (r['target-type'] === 'place' && r.place && /recorded at|mixed at|engineered at/.test(r.type)) {
      recordedAt.push({
        what: r.type.replace(' at', '').replace(/^\w/, (c) => c.toUpperCase()),
        place: r.place.name,
        area: r.place.area?.name,
        date: r.begin ?? undefined,
        until: r.end && r.end !== r.begin ? r.end : undefined,
      })
    }
    if (r['target-type'] === 'area' && r.area && /recorded in/.test(r.type)) {
      recordedAt.push({ what: 'Recorded', place: r.area.name, date: r.begin ?? undefined })
    }
    if (r['target-type'] === 'work' && r.work) {
      for (const wr of r.work.relations ?? []) {
        if (wr['target-type'] === 'artist' && wr.artist && /composer|lyricist|writer/.test(wr.type)) addCredit(wr.type, wr.artist.name)
      }
    }
  }

  const releases = (rec.releases ?? [])
    .filter((r) => r.status !== 'Bootleg')
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))
  const first = releases[0]

  return {
    title: rec.title,
    artist: (rec['artist-credit'] ?? []).map((c) => c.name + (c.joinphrase ?? '')).join('') || artist,
    released: rec['first-release-date'] || first?.date,
    album: first?.title,
    albumType: first?.['release-group']?.['primary-type'],
    recordedAt,
    credits: [...credits.entries()].map(([role, names]) => ({ role, names: [...names] })),
    isrc: rec.isrcs?.[0],
    url: `https://musicbrainz.org/recording/${rec.id}`,
  }
}

export function getSongInfo(title: string, artist: string, duration: number) {
  const key = `${title}|${artist}`.toLowerCase()
  let hit = cache.get(key)
  if (!hit) {
    hit = lookup(title, artist, duration).catch(() => {
      cache.delete(key)
      return null
    })
    cache.set(key, hit)
  }
  return hit
}
