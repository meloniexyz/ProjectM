import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { hostname } from 'node:os'
import { shell } from 'electron'
import { JsonFile } from '../json-file'
import type { AccountStatus, RemotePlaylist, SpotifyPlayback, Track } from '../../shared/types'
import type { AccountSource, StreamingSource } from './types'

/**
 * Spotify via the official Web API, using the user's own developer app (PKCE, no secret).
 * Playback is Spotify Connect: we tell the user's Spotify desktop app what to play.
 * Dev-mode rules (Feb 2026): owner needs Premium, search returns max 10 per page,
 * playlist contents live under /playlists/{id}/items.
 */

export const REDIRECT_PORT = 43821
export const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`
const SCOPES = [
  'user-read-private',
  'user-library-read',
  'user-library-modify',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-top-read',
].join(' ')

interface Saved {
  clientId?: string
  refreshToken?: string
  accessToken?: string
  expiresAt?: number
  userName?: string
}

interface ApiTrack {
  id: string | null
  name: string
  duration_ms: number
  is_local?: boolean
  type?: string
  artists: { name: string }[]
  album: { name: string; images?: { url: string; width?: number }[]; release_date?: string }
  track_number?: number
  disc_number?: number
}

const toTrack = (t: ApiTrack): Track => ({
  uid: `spotify:${t.id}`,
  source: 'spotify',
  id: t.id!,
  title: t.name,
  artist: t.artists.map((a) => a.name).join(', ') || 'Unknown Artist',
  album: t.album?.name || 'Spotify',
  duration: t.duration_ms / 1000,
  artwork: t.album?.images?.[0]?.url,
  trackNo: t.track_number,
  discNo: t.disc_number,
  year: Number(t.album?.release_date?.slice(0, 4)) || undefined,
})

const playable = (t: ApiTrack | null | undefined): t is ApiTrack =>
  !!t && !!t.id && !t.is_local && (t.type ?? 'track') === 'track'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class Spotify implements StreamingSource, AccountSource {
  private store: JsonFile<Saved>
  private refreshing: Promise<string> | null = null
  private deviceId: string | null = null

  constructor(file: string) {
    this.store = new JsonFile<Saved>(file, {})
  }

  load() {
    return this.store.load()
  }

  status(): AccountStatus {
    const s = this.store.get()
    return {
      clientId: s.clientId ?? null,
      connected: !!s.refreshToken,
      userName: s.userName ?? null,
      redirectUri: REDIRECT_URI,
    }
  }

  async logout() {
    const { clientId } = this.store.get()
    await this.store.set({ clientId })
    this.deviceId = null
  }

  // ---------- auth ----------

  /** Opens the Spotify consent page in the browser and waits for the redirect back to us. */
  async login(clientId = ''): Promise<AccountStatus> {
    clientId = clientId.trim() || this.store.get().clientId || ''
    if (!/^[0-9a-f]{32}$/i.test(clientId)) throw new Error("That doesn't look like a Client ID (32 letters/numbers)")

    const verifier = randomBytes(48).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state = randomBytes(12).toString('hex')

    const code = await new Promise<string>((resolve, reject) => {
      let server: Server
      const timer = setTimeout(() => {
        server.close()
        reject(new Error('Login timed out (5 minutes). Try again.'))
      }, 5 * 60_000)
      server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', REDIRECT_URI)
        if (url.pathname !== '/callback') return void res.writeHead(404).end()
        const ok = url.searchParams.get('state') === state && url.searchParams.get('code')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          `<body style="background:#09090c;color:#ededf2;font:16px 'Segoe UI',sans-serif;display:grid;place-items:center;height:90vh">` +
            `<div>${ok ? '✅ Spotify connected. You can close this tab and go back to ProjectM.' : `❌ Login failed: ${url.searchParams.get('error') ?? 'unknown error'}`}</div></body>`,
        )
        clearTimeout(timer)
        server.close()
        if (ok) resolve(url.searchParams.get('code')!)
        else reject(new Error(`Spotify login failed: ${url.searchParams.get('error') ?? 'state mismatch'}`))
      })
      server.on('error', (err) => {
        clearTimeout(timer)
        reject(new Error(`Couldn't listen on port ${REDIRECT_PORT}: ${err.message}`))
      })
      server.listen(REDIRECT_PORT, '127.0.0.1', () => {
        const auth = new URL('https://accounts.spotify.com/authorize')
        auth.search = new URLSearchParams({
          client_id: clientId,
          response_type: 'code',
          redirect_uri: REDIRECT_URI,
          code_challenge_method: 'S256',
          code_challenge: challenge,
          scope: SCOPES,
          state,
        }).toString()
        shell.openExternal(auth.toString())
      })
    })

    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    })
    await this.store.set({ clientId, ...tokens })
    try {
      const me = await this.api<{ display_name?: string; id: string }>('/me')
      await this.store.set({ ...this.store.get(), userName: me.display_name || me.id })
    } catch {
      // name is cosmetic
    }
    return this.status()
  }

  private async tokenRequest(body: Record<string, string>): Promise<Saved> {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    })
    const json = (await res.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      error_description?: string
      error?: string
    }
    if (!res.ok || !json.access_token) {
      throw new Error(`Spotify rejected the login: ${json.error_description || json.error || res.status}`)
    }
    return {
      accessToken: json.access_token,
      // refresh tokens rotate: keep the new one if Spotify sends it
      refreshToken: json.refresh_token ?? this.store.get().refreshToken,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
    }
  }

  private async accessToken(): Promise<string> {
    const s = this.store.get()
    if (!s.refreshToken || !s.clientId) throw new Error('Spotify is not connected')
    if (s.accessToken && (s.expiresAt ?? 0) > Date.now()) return s.accessToken
    this.refreshing ??= this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: s.refreshToken,
      client_id: s.clientId,
    })
      .then(async (t) => {
        await this.store.set({ ...this.store.get(), ...t })
        return t.accessToken!
      })
      .finally(() => (this.refreshing = null))
    return this.refreshing
  }

  private async api<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const token = await this.accessToken()
    const res = await fetch(path.startsWith('http') ? path : `https://api.spotify.com/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
    })
    if (res.status === 401 && attempt === 0) {
      await this.store.set({ ...this.store.get(), expiresAt: 0 })
      return this.api(path, init, 1)
    }
    if (res.status === 429 && attempt < 3) {
      await sleep(Math.min(10, Number(res.headers.get('retry-after')) || 1) * 1000)
      return this.api(path, init, attempt + 1)
    }
    if (!res.ok) {
      let msg = `${res.status}`
      try {
        const j = (await res.json()) as { error?: { message?: string; reason?: string } }
        msg = j.error?.reason || j.error?.message || msg
      } catch {
        // no body
      }
      throw new Error(`Spotify: ${msg}`)
    }
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  /** Follows `next` links until done (or `max` items). */
  private async paged<T>(path: string, max = 10_000): Promise<T[]> {
    const out: T[] = []
    let next: string | null = path
    while (next && out.length < max) {
      const page: { items: T[]; next: string | null } = await this.api(next)
      out.push(...page.items)
      next = page.next
    }
    return out
  }

  // ---------- library ----------

  async search(query: string, limit = 30): Promise<Track[]> {
    // dev-mode apps get at most 10 results per request, so fetch a few pages in parallel
    const pages = await Promise.all(
      [0, 10, 20].slice(0, Math.ceil(limit / 10)).map((offset) =>
        this.api<{ tracks: { items: ApiTrack[] } }>(
          `/search?${new URLSearchParams({ q: query, type: 'track', limit: '10', offset: String(offset) })}`,
        ).catch(() => ({ tracks: { items: [] as ApiTrack[] } })),
      ),
    )
    const seen = new Set<string>()
    return pages
      .flatMap((p) => p.tracks.items)
      .filter(playable)
      .filter((t) => !seen.has(t.id!) && !!seen.add(t.id!))
      .map(toTrack)
  }

  async resolve(): Promise<never> {
    throw new Error('Spotify tracks play through Spotify Connect, not a stream URL')
  }

  /** Your most-played songs lately (needs the user-top-read permission; older logins lack it). */
  async top(): Promise<Track[]> {
    const res = await this.api<{ items: ApiTrack[] }>('/me/top/tracks?limit=30&time_range=short_term')
    return res.items.filter(playable).map(toTrack)
  }

  async liked(): Promise<Track[]> {
    const items = await this.paged<{ track: ApiTrack; added_at?: string }>('/me/tracks?limit=50')
    return items
      .filter((i) => playable(i.track))
      .map((i) => ({ ...toTrack(i.track), likedAt: i.added_at ? Date.parse(i.added_at) : undefined }))
  }

  async isLiked(ids: string[]): Promise<boolean[]> {
    const uris = ids.map((id) => `spotify:track:${id}`).join(',')
    return this.api<boolean[]>(`/me/library/contains?uris=${encodeURIComponent(uris)}`)
  }

  async setLiked(id: string, liked: boolean) {
    const uris = encodeURIComponent(`spotify:track:${id}`)
    try {
      await this.api(`/me/library?uris=${uris}`, { method: liked ? 'PUT' : 'DELETE' })
    } catch (err) {
      // logins from before this feature lack the "modify library" permission
      if (/403|insufficient|scope|forbidden/i.test((err as Error).message)) {
        throw new Error('Reconnect Spotify (Settings → Accounts → Disconnect, then Connect) to let ProjectM save likes.')
      }
      throw err
    }
  }

  async playlists(): Promise<RemotePlaylist[]> {
    const items = await this.paged<{
      id: string
      name: string
      images?: { url: string }[] | null
      owner?: { display_name?: string }
      items?: { total: number }
      tracks?: { total: number }
    } | null>('/me/playlists?limit=50')
    return items
      .filter((p) => p !== null)
      .map((p) => ({
        id: p!.id,
        name: p!.name,
        artwork: p!.images?.[0]?.url,
        owner: p!.owner?.display_name ?? '',
        total: p!.items?.total ?? p!.tracks?.total ?? 0,
      }))
  }

  async playlistTracks(id: string): Promise<Track[]> {
    const items = await this.paged<{ item?: ApiTrack | null; track?: ApiTrack | null }>(
      `/playlists/${encodeURIComponent(id)}/items?limit=50`,
    )
    return items
      .map((i) => i.item ?? i.track)
      .filter(playable)
      .map(toTrack)
  }

  // ---------- playback (Spotify Connect) ----------

  /** Finds this PC's Spotify app as a Connect device, only if it's already running. */
  private async device(): Promise<string> {
    const list = async () =>
      (await this.api<{ devices: { id: string; type: string; name: string; is_active: boolean }[] }>(
        '/me/player/devices',
      )).devices
    const pick = (ds: Awaited<ReturnType<typeof list>>) =>
      ds.find((d) => d.id === this.deviceId) ??
      ds.find((d) => d.type === 'Computer' && d.name.toLowerCase() === hostname().toLowerCase()) ??
      ds.find((d) => d.type === 'Computer') ??
      null

    // Only use Spotify if it's already open; never launch it. If it isn't running, the player
    // plays the song from YouTube Music or SoundCloud instead.
    const found = pick(await list())
    if (!found) throw new Error("Couldn't find the Spotify app on this PC (it isn't open)")
    this.deviceId = found.id
    return found.id
  }

  async play(id: string, positionMs = 0) {
    const device = await this.device()
    const body = JSON.stringify({ uris: [`spotify:track:${id}`], position_ms: Math.round(positionMs) })
    try {
      await this.api(`/me/player/play?device_id=${device}`, { method: 'PUT', body })
    } catch (err) {
      // device went stale (app restarted): look it up again once
      this.deviceId = null
      const again = await this.device()
      if (again === device) throw err
      await this.api(`/me/player/play?device_id=${again}`, { method: 'PUT', body })
    }
    // one song at a time: don't let Spotify wander off into its own queue when it ends
    this.api(`/me/player/repeat?state=off&device_id=${device}`, { method: 'PUT' }).catch(() => {})
  }

  pause() {
    return this.api(`/me/player/pause${this.deviceId ? `?device_id=${this.deviceId}` : ''}`, { method: 'PUT' })
  }

  resume() {
    return this.api(`/me/player/play${this.deviceId ? `?device_id=${this.deviceId}` : ''}`, { method: 'PUT' })
  }

  seek(positionMs: number) {
    return this.api(`/me/player/seek?position_ms=${Math.round(positionMs)}`, { method: 'PUT' })
  }

  volume(percent: number) {
    return this.api(`/me/player/volume?volume_percent=${Math.round(Math.max(0, Math.min(100, percent)))}`, {
      method: 'PUT',
    })
  }

  async playback(): Promise<SpotifyPlayback | null> {
    const s = await this.api<{
      is_playing: boolean
      progress_ms: number | null
      item?: { id: string } | null
      device?: { volume_percent?: number | null }
    } | undefined>('/me/player')
    if (!s) return null
    return { trackId: s.item?.id ?? null, playing: s.is_playing, positionMs: s.progress_ms ?? 0 }
  }
}
