import type { AccountStatus, RemotePlaylist, Track } from '../../shared/types'
import type { Secrets } from '../secrets'
import { UA, type AccountSource, type StreamInfo, type StreamingSource } from './types'

/** Accepts the token itself, "oauth_token=...", or a whole pasted cookie string. */
function extractToken(input: string) {
  const text = input.trim().replace(/^["']|["']$/g, '')
  const m = text.match(/oauth_token=([^;\s]+)/)
  return (m ? m[1] : text).replace(/^OAuth\s+/i, '').trim()
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
  private me: Promise<ScUser> | null = null

  constructor(private readonly secrets: Secrets) {}

  /** The signed-in user's OAuth token (the `oauth_token` cookie soundcloud.com sets). */
  private async token(): Promise<string | undefined> {
    return this.secrets.get('soundcloud.token')
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
    const token = await this.token()
    const headers: Record<string, string> = { 'User-Agent': UA }
    if (token) headers.Authorization = `OAuth ${token}`
    const res = await fetch(url, { headers })
    if ((res.status === 401 || res.status === 403) && retry) {
      await this.getClientId(true) // client id rotated
      return this.api(path, params, false)
    }
    if (!res.ok) throw new Error(`SoundCloud returned ${res.status}`)
    return res.json() as Promise<T>
  }

  // ---------- account ----------

  async status(): Promise<AccountStatus> {
    if (!(await this.token())) return { connected: false, userName: null }
    const me = await this.user().catch(() => null)
    return { connected: true, userName: me?.username ?? null }
  }

  /** Signs in with the `oauth_token` cookie copied from a browser logged in to soundcloud.com. */
  async login(pasted = ''): Promise<AccountStatus> {
    const token = extractToken(pasted)
    if (!/^[\w.-]{20,}$/.test(token)) {
      throw new Error("That doesn't look like a SoundCloud oauth_token. Copy the Value of the oauth_token cookie.")
    }
    await this.secrets.set('soundcloud.token', token)
    this.me = null
    try {
      await this.user()
    } catch {
      await this.logout()
      throw new Error("SoundCloud didn't accept that token. Make sure you're logged in on soundcloud.com and copy it again.")
    }
    return this.status()
  }

  async logout() {
    await this.secrets.set('soundcloud.token', undefined)
    this.me = null
  }

  private user() {
    this.me ??= this.api<ScUser>('/me').catch((err) => {
      this.me = null
      throw err
    })
    return this.me
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
    const items = await this.all<{ type?: string; playlist?: ScPlaylist }>('/me/library/all', { limit: '50' }, 500)
    const seen = new Set<number>()
    const out: RemotePlaylist[] = []
    // own playlists come back from a separate endpoint on some accounts
    const own = await this.all<ScPlaylist>(`/users/${me.id}/playlists_without_albums`, { limit: '50' }, 500).catch(
      () => [],
    )
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
