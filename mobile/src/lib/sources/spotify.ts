import * as Crypto from 'expo-crypto'
import type { AccountStatus, RemotePlaylist, Track } from '../../../../src/shared/types'
import { JsonFile, secrets } from '../storage'

/**
 * Spotify via the official Web API with your own developer app (PKCE, no secret). The same
 * Client ID and redirect address as the desktop app work here: the sign-in page opens inside the
 * app, and we catch the redirect before it goes anywhere.
 *
 * Phones can't play Spotify audio inside another app, so Spotify songs play from YouTube Music or
 * SoundCloud (the closest match, see sources/index.ts).
 */

export const REDIRECT_URI = 'http://127.0.0.1:43821/callback'
const SCOPES = [
  'user-read-private',
  'user-library-read',
  'user-library-modify',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-top-read',
  'playlist-modify-private',
  'playlist-modify-public',
].join(' ')

const KEY = 'spotify.auth'

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

/** Spotify covers come in 640/300/64 px; 300 is plenty on a phone (and a third of the data). */
const pickImage = (images?: { url: string; width?: number }[]) =>
  images?.find((i) => (i.width ?? 0) <= 320 && (i.width ?? 0) >= 200)?.url ?? images?.[0]?.url

const toTrack = (t: ApiTrack): Track => ({
  uid: `spotify:${t.id}`,
  source: 'spotify',
  id: t.id!,
  title: t.name,
  artist: t.artists.map((a) => a.name).join(', ') || 'Unknown Artist',
  album: t.album?.name || 'Spotify',
  duration: t.duration_ms / 1000,
  artwork: pickImage(t.album?.images),
  trackNo: t.track_number,
  discNo: t.disc_number,
  year: Number(t.album?.release_date?.slice(0, 4)) || undefined,
})

const playable = (t: ApiTrack | null | undefined): t is ApiTrack => !!t && !!t.id && !t.is_local && (t.type ?? 'track') === 'track'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const b64url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function bytesToB64(bytes: Uint8Array) {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

export interface SpotifyAuthRequest {
  url: string
  state: string
  verifier: string
  clientId: string
}

class Spotify {
  private refreshing: Promise<string> | null = null
  /** liked songs on disk: downloaded again only when Spotify reports a change (saves data and API quota) */
  private likedCache = new JsonFile<{ total: number; newest?: string; tracks: Track[] } | null>('spotify-liked.json', null)

  private saved(): Saved {
    try {
      return JSON.parse(secrets.get(KEY) ?? '{}') as Saved
    } catch {
      return {}
    }
  }

  private async save(s: Saved) {
    await secrets.set(KEY, JSON.stringify(s))
  }

  status(): AccountStatus {
    const s = this.saved()
    return { clientId: s.clientId ?? null, connected: !!s.refreshToken, userName: s.userName ?? null, redirectUri: REDIRECT_URI }
  }

  async logout() {
    const { clientId } = this.saved()
    await this.save({ clientId })
  }

  /** Builds the consent page address; the sign-in sheet opens it and hands back the redirect. */
  async beginLogin(clientId: string): Promise<SpotifyAuthRequest> {
    clientId = clientId.trim() || this.saved().clientId || ''
    if (!/^[0-9a-f]{32}$/i.test(clientId)) throw new Error("That doesn't look like a Client ID (32 letters/numbers)")
    const verifier = b64url(bytesToB64(Crypto.getRandomBytes(48)))
    const challenge = b64url(
      await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }),
    )
    const state = b64url(bytesToB64(Crypto.getRandomBytes(12)))
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      scope: SCOPES,
      state,
    })
    return { url: `https://accounts.spotify.com/authorize?${params}`, state, verifier, clientId }
  }

  /** Finishes sign-in with the redirect address the sheet caught. */
  async finishLogin(req: SpotifyAuthRequest, redirectedTo: string): Promise<AccountStatus> {
    const u = new URL(redirectedTo)
    const code = u.searchParams.get('code')
    if (u.searchParams.get('state') !== req.state || !code) {
      throw new Error(`Spotify sign-in failed: ${u.searchParams.get('error') ?? 'state mismatch'}`)
    }
    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: req.clientId,
      code_verifier: req.verifier,
    })
    await this.save({ clientId: req.clientId, ...tokens })
    try {
      const me = await this.api<{ display_name?: string; id: string }>('/me')
      await this.save({ ...this.saved(), userName: me.display_name || me.id })
    } catch {
      // name is cosmetic
    }
    return this.status()
  }

  private async tokenRequest(body: Record<string, string>): Promise<Saved> {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    })
    const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string }
    if (!res.ok || !json.access_token) throw new Error(`Spotify rejected the login: ${json.error_description || json.error || res.status}`)
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? this.saved().refreshToken,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
    }
  }

  private async accessToken(): Promise<string> {
    const s = this.saved()
    if (!s.refreshToken || !s.clientId) throw new Error('Spotify is not connected')
    if (s.accessToken && (s.expiresAt ?? 0) > Date.now()) return s.accessToken
    this.refreshing ??= this.tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refreshToken, client_id: s.clientId })
      .then(async (t) => {
        await this.save({ ...this.saved(), ...t })
        return t.accessToken!
      })
      .finally(() => (this.refreshing = null))
    return this.refreshing
  }

  private async api<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const token = await this.accessToken()
    const res = await fetch(path.startsWith('http') ? path : `https://api.spotify.com/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
    })
    if (res.status === 401 && attempt === 0) {
      await this.save({ ...this.saved(), expiresAt: 0 })
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
      if (/QUOTA_EXCEEDED/i.test(msg)) throw new Error("Spotify's request limit for your developer app is used up for now. Try again later.")
      throw new Error(`Spotify: ${msg}`)
    }
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

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

  async search(query: string, limit = 30): Promise<Track[]> {
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

  async top(): Promise<Track[]> {
    const res = await this.api<{ items: ApiTrack[] }>('/me/top/tracks?limit=30&time_range=short_term')
    return res.items.filter(playable).map(toTrack)
  }

  /** Cached liked songs, if any (no network). */
  cachedLiked() {
    return this.likedCache.get()?.tracks ?? null
  }

  async liked(): Promise<Track[]> {
    const cached = this.likedCache.get()
    let head: { total: number; items: { added_at?: string }[] }
    try {
      head = await this.api('/me/tracks?limit=1')
    } catch (err) {
      if (cached) return cached.tracks
      throw err
    }
    const newest = head.items[0]?.added_at
    if (cached && cached.total === head.total && cached.newest === newest) return cached.tracks
    const items = await this.paged<{ track: ApiTrack; added_at?: string }>('/me/tracks?limit=50')
    const tracks = items
      .filter((i) => playable(i.track))
      .map((i) => ({ ...toTrack(i.track), likedAt: i.added_at ? Date.parse(i.added_at) : undefined }))
    this.likedCache.set({ total: head.total, newest, tracks })
    return tracks
  }

  async isLiked(ids: string[]): Promise<boolean[]> {
    const uris = ids.map((id) => `spotify:track:${id}`).join(',')
    return this.api<boolean[]>(`/me/library/contains?uris=${encodeURIComponent(uris)}`)
  }

  async setLiked(id: string, liked: boolean) {
    await this.api(`/me/library?uris=${encodeURIComponent(`spotify:track:${id}`)}`, { method: liked ? 'PUT' : 'DELETE' })
    this.likedCache.set(null) // next liked() reloads
  }

  private myId: Promise<string> | null = null

  async playlists(): Promise<RemotePlaylist[]> {
    this.myId ??= this.api<{ id: string }>('/me')
      .then((me) => me.id)
      .catch((err) => {
        this.myId = null
        throw err
      })
    const [items, me] = await Promise.all([
      this.paged<{
        id: string
        name: string
        collaborative?: boolean
        images?: { url: string; width?: number }[] | null
        owner?: { id?: string; display_name?: string }
        items?: { total: number }
        tracks?: { total: number }
      } | null>('/me/playlists?limit=50'),
      this.myId.catch(() => ''),
    ])
    return items
      .filter((p) => p !== null)
      .map((p) => ({
        id: p!.id,
        name: p!.name,
        artwork: pickImage(p!.images ?? undefined),
        owner: p!.owner?.display_name ?? '',
        total: p!.items?.total ?? p!.tracks?.total ?? 0,
        editable: !!p!.collaborative || (!!me && p!.owner?.id === me),
      }))
  }

  async addToPlaylist(playlistId: string, trackId: string) {
    await this.api(`/playlists/${encodeURIComponent(playlistId)}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
    })
  }

  async playlistTracks(id: string): Promise<Track[]> {
    const items = await this.paged<{ item?: ApiTrack | null; track?: ApiTrack | null }>(`/playlists/${encodeURIComponent(id)}/items?limit=50`)
    return items.map((i) => i.item ?? i.track).filter(playable).map(toTrack)
  }
}

export const spotify = new Spotify()
