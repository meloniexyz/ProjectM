import type { AccountStatus, RemotePlaylist, Track } from '../../shared/types'
import type { Secrets } from '../secrets'
import { UA, type AccountSource, type StreamInfo, type StreamingSource } from './types'

const PROFILE_KEY = 'soundcloud.profile'

/** "soundcloud.com/name", a full URL, or just "name" -> profile URL. */
function profileUrl(input: string) {
  const text = input.trim().replace(/[?#].*$/, '').replace(/\/+$/, '')
  const m = text.match(/soundcloud\.com\/([^/\s]+)/i)
  const name = m ? m[1] : text.replace(/^@/, '')
  if (!/^[\w-]{2,}$/.test(name)) throw new Error("That doesn't look like a SoundCloud profile link or username")
  return `https://soundcloud.com/${name}`
}

const API = 'https://api-v2.soundcloud.com'

interface Transcoding {
  url: string
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
interface ScUser {
  id: number
  username: string
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

/**
 * SoundCloud's public API is closed to new apps, so this uses the same client id the
 * soundcloud.com website uses (scraped from its JS bundle and refreshed when it rotates).
 */
export class SoundCloud implements StreamingSource, AccountSource {
  private clientId: Promise<string> | null = null
  constructor(private readonly secrets: Secrets) {}

  /** The profile the user connected. Likes and public playlists need no login. */
  private profile(): ScUser | undefined {
    const raw = this.secrets.get(PROFILE_KEY)
    return raw ? (JSON.parse(raw) as ScUser) : undefined
  }

  private getClientId(refresh = false) {
    if (refresh) this.clientId = null
    this.clientId ??= (async () => {
      const html = await (await fetch('https://soundcloud.com/', { headers: { 'User-Agent': UA } })).text()
      const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)]
        .map((m) => m[1])
        .reverse() // the client id lives in one of the last bundles
      for (const src of scripts) {
        const js = await (await fetch(src)).text()
        const m = js.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/)
        if (m) return m[1]
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
      await this.getClientId(true) // client id rotated
      return this.api(path, params, false)
    }
    if (!res.ok) throw new Error(`SoundCloud returned ${res.status}`)
    return res.json() as Promise<T>
  }

  // ---------- account ----------

  async status(): Promise<AccountStatus> {
    const p = this.profile()
    return { connected: !!p, userName: p?.username ?? null }
  }

  /** "Connects" a profile by its link or username: SoundCloud likes and playlists are public. */
  async login(input = ''): Promise<AccountStatus> {
    const url = profileUrl(input)
    const found = await this.api<{ kind?: string; id?: number; username?: string }>('/resolve', { url }).catch(() => null)
    if (found?.kind !== 'user' || !found.id) throw new Error(`Couldn't find a SoundCloud profile at ${url}`)
    await this.secrets.set(PROFILE_KEY, JSON.stringify({ id: found.id, username: found.username ?? '' }))
    return this.status()
  }

  async logout() {
    await this.secrets.set(PROFILE_KEY, undefined)
  }

  private async user(): Promise<ScUser> {
    const p = this.profile()
    if (!p) throw new Error('No SoundCloud profile connected')
    return p
  }

  /** Follows SoundCloud's next_href pagination. */
  private async all<T>(path: string, params: Record<string, string>, max: number): Promise<T[]> {
    const out: T[] = []
    let page = await this.api<Page<T>>(path, { ...params, linked_partitioning: '1' })
    out.push(...page.collection)
    while (page.next_href && out.length < max) {
      const next = new URL(page.next_href)
      next.searchParams.delete('client_id')
      page = await this.api<Page<T>>(`${next.origin}${next.pathname}`, Object.fromEntries(next.searchParams))
      out.push(...page.collection)
    }
    return out
  }

  async liked(): Promise<Track[]> {
    const me = await this.user()
    const likes = await this.all<{ track?: ScTrack }>(`/users/${me.id}/track_likes`, { limit: '200' }, 5000)
    return likes
      .map((l) => l.track)
      .filter((t): t is ScTrack => !!t && t.policy !== 'BLOCK')
      .map((t) => this.toTrack(t))
  }

  async playlists(): Promise<RemotePlaylist[]> {
    const me = await this.user()
    const own = await this.all<ScPlaylist>(`/users/${me.id}/playlists_without_albums`, { limit: '50' }, 500)
    // /likes mixes liked tracks and liked playlists; keep the playlists
    const items = await this.all<{ playlist?: ScPlaylist }>(`/users/${me.id}/likes`, { limit: '200' }, 2000).catch(
      () => [],
    )
    const seen = new Set<number>()
    const out: RemotePlaylist[] = []
    for (const p of [...own, ...items.map((i) => i.playlist)]) {
      if (!p || seen.has(p.id)) continue
      seen.add(p.id)
      out.push({
        id: String(p.id),
        name: p.title,
        artwork: (p.artwork_url || p.tracks?.[0]?.artwork_url || undefined)?.replace('-large.', '-t500x500.'),
        owner: p.user?.username ?? '',
        total: p.track_count ?? 0,
      })
    }
    return out
  }

  async playlistTracks(id: string): Promise<Track[]> {
    const pl = await this.api<ScPlaylist>(`/playlists/${id}`, { representation: 'full' })
    const tracks = pl.tracks ?? []
    // SoundCloud only sends the first few tracks in full; the rest are just ids
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
      artwork: art?.replace('-large.', '-t500x500.'),
    }
  }

  async search(query: string, limit = 30): Promise<Track[]> {
    const res = await this.api<{ collection: ScTrack[] }>('/search/tracks', { q: query, limit: String(limit + 10) })
    return res.collection
      .filter((t) => t.streamable !== false && t.policy !== 'BLOCK' && t.policy !== 'SNIP') // SNIP = 30s Go+ preview
      .slice(0, limit)
      .map((t) => this.toTrack(t))
  }

  async resolve(id: string): Promise<StreamInfo> {
    const track = await this.api<ScTrack>(`/tracks/${id}`)
    const options = (track.media?.transcodings ?? []).filter((t) => !t.snipped)
    const pick =
      options.find((t) => t.format.protocol === 'progressive') ??
      options.find((t) => t.format.protocol === 'hls' && t.format.mime_type.includes('mp4')) ??
      options.find((t) => t.format.protocol === 'hls' && t.format.mime_type === 'audio/mpeg')
    if (!pick) throw new Error('SoundCloud has no playable stream for this track')

    const params: Record<string, string> = {}
    if (track.track_authorization) params.track_authorization = track.track_authorization
    const { url } = await this.api<{ url: string }>(pick.url, params)
    return { url, kind: pick.format.protocol === 'hls' ? 'hls' : 'direct' }
  }
}
