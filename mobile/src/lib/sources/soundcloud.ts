import type { AccountStatus, RemotePlaylist, SoundCloudProfile, Track } from '../../../../src/shared/types'
import { bestMatch, scoredMatch, type MatchTarget } from '../../../../src/main/sources/match'
import { JsonFile } from '../storage'
import type { Quality } from '../settings'
import type { StreamPlan } from './types'

const API = 'https://api-v2.soundcloud.com'
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

interface Transcoding {
  url: string
  preset?: string
  snipped?: boolean
  format: { protocol: string; mime_type: string }
}
interface ScPlaylist {
  id: number
  title: string
  artwork_url?: string | null
  track_count?: number
  user?: { username: string }
  tracks?: ScTrack[]
}
interface ScUserFull {
  id: number
  username: string
  kind?: string
  permalink?: string
  avatar_url?: string
  followers_count?: number
  likes_count?: number
  city?: string | null
}
interface Page<T> {
  collection: T[]
  next_href?: string | null
}
interface ScTrack {
  id: number
  title: string
  duration: number
  full_duration?: number
  policy?: string
  artwork_url?: string | null
  track_authorization?: string
  streamable?: boolean
  user?: { username: string; avatar_url?: string }
  publisher_metadata?: { artist?: string; album_title?: string } | null
  media?: { transcodings: Transcoding[] }
}

function profileUrl(input: string) {
  const text = input.trim().replace(/[?#].*$/, '').replace(/\/+$/, '')
  const m = text.match(/soundcloud\.com\/([^/\s]+)/i)
  const name = m ? m[1] : text.replace(/^@/, '')
  if (!/^[\w-]{2,}$/.test(name)) return 'https://soundcloud.com/-'
  return `https://soundcloud.com/${name}`
}

const kbpsOf = (t: Transcoding) => {
  const p = t.preset ?? ''
  return Number(p.match(/(\d+)k/)?.[1]) || (p.startsWith('mp3') ? 128 : p.startsWith('opus') ? 64 : 160)
}

/**
 * Which stream to use for each quality step. iPhones can't play SoundCloud's Opus streams, so
 * the choices are AAC 96 / 160 (256 on Go+ uploads) over HLS, or MP3 128 as a plain file.
 */
function pickTranscoding(options: Transcoding[], quality: Quality): Transcoding | null {
  const ok = options.filter(
    (t) =>
      !t.snipped &&
      ['hls', 'progressive'].includes(t.format.protocol) && // encrypted variants need SoundCloud's own app
      (t.preset?.startsWith('aac') || t.preset?.startsWith('mp3')),
  )
  const aac = ok.filter((t) => t.preset?.startsWith('aac') && t.format.protocol === 'hls').sort((a, b) => kbpsOf(a) - kbpsOf(b))
  const mp3 = ok.find((t) => t.preset?.startsWith('mp3') && t.format.protocol === 'progressive') ?? ok.find((t) => t.preset?.startsWith('mp3'))
  if (quality === 'best') return aac[aac.length - 1] ?? mp3 ?? null
  // low / mid: the smallest AAC (usually 96 kbps), else MP3
  return aac[0] ?? mp3 ?? null
}

class SoundCloud {
  private clientId: Promise<string> | null = null
  /** client id scraped from soundcloud.com, kept on disk (the scrape downloads ~1 MB of scripts) */
  private store = new JsonFile<{ clientId?: string; profile?: { id: number; username: string } }>('soundcloud.json', {})

  private getClientId(refresh = false) {
    if (refresh) {
      this.clientId = null
      this.store.set({ ...this.store.get(), clientId: undefined })
    }
    const saved = this.store.get().clientId
    if (!this.clientId && saved) this.clientId = Promise.resolve(saved)
    this.clientId ??= (async () => {
      const html = await (await fetch('https://soundcloud.com/', { headers: { 'User-Agent': UA } })).text()
      const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1]).reverse()
      for (const src of scripts) {
        const js = await (await fetch(src)).text()
        const m = js.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/)
        if (m) {
          this.store.set({ ...this.store.get(), clientId: m[1] })
          return m[1]
        }
      }
      throw new Error("Couldn't connect to SoundCloud (client id not found)")
    })().catch((err) => {
      this.clientId = null
      throw err
    })
    return this.clientId
  }

  private async api<T>(path: string, params: Record<string, string> = {}, retry = true): Promise<T> {
    const clientId = await this.getClientId()
    const url = `${path.startsWith('http') ? path : API + path}?${new URLSearchParams({ client_id: clientId, ...params })}`
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if ((res.status === 401 || res.status === 403) && retry) {
      await this.getClientId(true)
      return this.api(path, params, false)
    }
    if (!res.ok) throw new Error(`SoundCloud returned ${res.status}`)
    return res.json() as Promise<T>
  }

  // ---------- account (your public profile; no password needed) ----------

  status(): AccountStatus {
    const p = this.store.get().profile
    return { connected: !!p, userName: p?.username ?? null }
  }

  async connect(input: string): Promise<AccountStatus> {
    let found: ScUserFull | null
    const byId = input.match(/^id:(\d+)$/)
    if (byId) found = await this.api<ScUserFull>(`/users/${byId[1]}`).catch(() => null)
    else {
      found = await this.api<ScUserFull>('/resolve', { url: profileUrl(input) }).catch(() => null)
      if (found?.kind !== 'user') found = null
    }
    if (!found?.id) throw new Error("Couldn't find that SoundCloud profile")
    this.store.set({ ...this.store.get(), profile: { id: found.id, username: found.username ?? '' } }, true)
    return this.status()
  }

  async findProfiles(query: string): Promise<SoundCloudProfile[]> {
    const q = query.trim()
    if (!q) return []
    const toProfile = (u: ScUserFull): SoundCloudProfile => ({
      id: u.id,
      username: u.username,
      permalink: u.permalink ?? '',
      avatar: u.avatar_url?.replace('-large.', '-t200x200.'),
      followers: u.followers_count ?? 0,
      likes: u.likes_count ?? 0,
      city: u.city ?? undefined,
    })
    const out: SoundCloudProfile[] = []
    const exact = await this.api<ScUserFull>('/resolve', { url: profileUrl(q) }).catch(() => null)
    if (exact?.kind === 'user') out.push(toProfile(exact))
    if (!/soundcloud\.com\//i.test(q)) {
      const res = await this.api<{ collection: ScUserFull[] }>('/search/users', { q, limit: '10' }).catch(() => null)
      for (const u of res?.collection ?? []) if (!out.some((p) => p.id === u.id)) out.push(toProfile(u))
    }
    return out.slice(0, 10)
  }

  logout() {
    this.store.set({ ...this.store.get(), profile: undefined }, true)
  }

  private me() {
    const p = this.store.get().profile
    if (!p) throw new Error('No SoundCloud profile connected')
    return p
  }

  private async all<T>(path: string, params: Record<string, string>, max: number): Promise<T[]> {
    const out: T[] = []
    let page = await this.api<Page<T>>(path, { ...params, linked_partitioning: '1' })
    out.push(...page.collection)
    while (page.next_href && out.length < max) {
      const next = new URL(page.next_href)
      next.searchParams.delete('client_id')
      const params2: Record<string, string> = {}
      next.searchParams.forEach((v, k) => (params2[k] = v))
      page = await this.api<Page<T>>(`${next.origin}${next.pathname}`, params2)
      out.push(...page.collection)
    }
    return out
  }

  async liked(): Promise<Track[]> {
    const me = this.me()
    const likes = await this.all<{ track?: ScTrack; created_at?: string }>(`/users/${me.id}/track_likes`, { limit: '200' }, 5000)
    return likes
      .filter((l): l is { track: ScTrack; created_at?: string } => !!l.track && l.track.policy !== 'BLOCK')
      .map((l) => ({ ...this.toTrack(l.track), likedAt: l.created_at ? Date.parse(l.created_at) : undefined }))
  }

  async playlists(): Promise<RemotePlaylist[]> {
    const me = this.me()
    const own = await this.all<ScPlaylist>(`/users/${me.id}/playlists_without_albums`, { limit: '50' }, 500)
    const items = await this.all<{ playlist?: ScPlaylist }>(`/users/${me.id}/likes`, { limit: '200' }, 2000).catch(() => [])
    const seen = new Set<number>()
    const out: RemotePlaylist[] = []
    for (const p of [...own, ...items.map((i) => i.playlist)]) {
      if (!p || seen.has(p.id)) continue
      seen.add(p.id)
      out.push({
        id: String(p.id),
        name: p.title,
        artwork: (p.artwork_url || p.tracks?.[0]?.artwork_url || undefined)?.replace('-large.', '-t300x300.'),
        owner: p.user?.username ?? '',
        total: p.track_count ?? 0,
      })
    }
    return out
  }

  async playlistTracks(id: string): Promise<Track[]> {
    const pl = await this.api<ScPlaylist>(`/playlists/${id}`, { representation: 'full' })
    const tracks = pl.tracks ?? []
    const missing = tracks.filter((t) => !t.title).map((t) => t.id)
    const full = new Map<number, ScTrack>()
    for (let i = 0; i < missing.length; i += 50) {
      const batch = await this.api<ScTrack[]>('/tracks', { ids: missing.slice(i, i + 50).join(',') })
      for (const t of batch) full.set(t.id, t)
    }
    return tracks
      .map((t) => (t.title ? t : full.get(t.id)))
      .filter((t): t is ScTrack => !!t && t.policy !== 'BLOCK')
      .map((t) => this.toTrack(t))
  }

  private toTrack(t: ScTrack): Track {
    const art = t.artwork_url || t.user?.avatar_url
    return {
      uid: `soundcloud:${t.id}`,
      source: 'soundcloud',
      id: String(t.id),
      title: t.title,
      artist: t.publisher_metadata?.artist || t.user?.username || 'Unknown Artist',
      album: t.publisher_metadata?.album_title || 'SoundCloud',
      duration: (t.full_duration ?? t.duration) / 1000,
      artwork: art?.replace('-large.', '-t300x300.'),
    }
  }

  async search(query: string, limit = 30): Promise<Track[]> {
    const res = await this.api<{ collection: ScTrack[] }>('/search/tracks', { q: query, limit: String(limit + 10) })
    return res.collection
      .filter((t) => t.streamable !== false && t.policy !== 'BLOCK' && t.policy !== 'SNIP')
      .slice(0, limit)
      .map((t) => this.toTrack(t))
  }

  async match(t: MatchTarget) {
    return bestMatch(t, await this.search(`${t.artist.split(',')[0].trim()} ${t.title}`, 15))
  }

  async matchScored(t: MatchTarget) {
    return scoredMatch(t, await this.search(`${t.artist.split(',')[0].trim()} ${t.title}`, 15))
  }

  async plan(id: string, quality: Quality): Promise<StreamPlan> {
    const track = await this.api<ScTrack>(`/tracks/${id}`)
    const pick = pickTranscoding(track.media?.transcodings ?? [], quality)
    if (!pick) throw new Error('SoundCloud has no iPhone-playable stream for this track')
    const params: Record<string, string> = {}
    if (track.track_authorization) params.track_authorization = track.track_authorization
    const { url } = await this.api<{ url: string }>(pick.url, params)
    const isAac = pick.preset?.startsWith('aac')
    const kbps = kbpsOf(pick)
    return {
      source: 'soundcloud',
      id,
      kind: pick.format.protocol === 'hls' ? 'hls' : 'file',
      url,
      ext: isAac ? 'mp4' : 'mp3',
      codec: isAac ? 'aac' : 'mp3',
      kbps,
      quality: isAac ? `AAC · ${kbps} kbps` : 'MP3 · 128 kbps',
    }
  }
}

export const soundcloud = new SoundCloud()
