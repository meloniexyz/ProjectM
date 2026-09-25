import vm from 'node:vm'
import { join } from 'node:path'
import { Innertube, Log, Platform, UniversalCache, type OAuth2Tokens } from 'youtubei.js'
import type { AccountStatus, RemotePlaylist, Track } from '../../shared/types'
import type { Secrets } from '../secrets'
import { bestMatch, type MatchTarget } from './match'
import { PoTokenMinter } from './potoken'
import { UA, type AccountSource, type StreamInfo, type StreamingSource } from './types'

// Clients tried in order when fetching audio. YouTube changes which ones work every so often;
// if playback breaks, reordering this list (or `npm update youtubei.js`) is usually the fix.
const CLIENTS = ['YTMUSIC', 'IOS', 'MWEB'] as const
/** Max bytes fetched per range request; YouTube throttles/refuses huge open-ended ranges. */
const CHUNK = 8 * 1024 * 1024
const OAUTH_KEY = 'youtube.oauth'

/** Stored sign-in: YouTube's OAuth tokens, plus the user's own Google client if they used one. */
type SavedLogin = OAuth2Tokens & {
  client?: { client_id: string; client_secret: string }
  /** which API accepted this login: YouTube Music's own, or the official YouTube Data API */
  mode?: 'music' | 'dataapi'
}

interface DataApiItem {
  snippet?: {
    title?: string
    videoOwnerChannelTitle?: string
    channelTitle?: string
    resourceId?: { videoId?: string }
    thumbnails?: Record<string, { url: string }>
  }
  contentDetails?: { videoId?: string; itemCount?: number }
  id?: string
}

const GOOGLE_OAUTH = 'https://oauth2.googleapis.com'
const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * POST to Google's OAuth server with a time limit and one retry: a stalled connection
 * must not leave the sign-in spinning forever.
 */
async function googlePost(path: string, body: Record<string, string>): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetch(`${GOOGLE_OAUTH}${path}`, {
        method: 'POST',
        body: new URLSearchParams(body),
        signal: AbortSignal.timeout(15_000),
      })
    } catch (err) {
      lastError = err
    }
  }
  const e = lastError as Error & { cause?: { code?: string } }
  throw new Error(`Couldn't reach Google (${e.name === 'TimeoutError' ? 'timed out' : (e.cause?.code ?? e.message)}). Check your connection and try again.`)
}

interface GoogleTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  scope?: string
  error?: string
  error_description?: string
}

/** "PT3M25S" -> 205 */
function isoSeconds(iso = '') {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0
}
const bestThumb = (t?: Record<string, { url: string }>) =>
  t?.maxres?.url ?? t?.high?.url ?? t?.medium?.url ?? t?.default?.url

export interface DeviceCode {
  code: string
  url: string
}

interface ResolvedStream {
  url: string
  mime: string
  length: number
  expires: number
  /** gain (dB) to reach -14 LUFS, from YouTube's own loudness measurement */
  gainDb?: number
}

/**
 * YouTube's stream URLs are scrambled by its player JavaScript. youtubei.js extracts the
 * relevant functions; we run them in an isolated VM context (no Node, no network, 5s limit).
 */
Platform.shim.eval = (data, env) => {
  const arg = (v: unknown) => JSON.stringify(v ?? '')
  const code = `(function(){\n${data.output}\nreturn process(${arg(env.n)}, ${arg(env.sp)}, ${arg(env.sig)});\n})()`
  return vm.runInNewContext(code, {}, { timeout: 5000 })
}
Log.setLevel(Log.Level.ERROR)

/** YouTube thumbnail URLs carry their size in the URL; ask for a larger one. */
function bigThumb(url?: string) {
  if (!url) return undefined
  return url.replace(/=w\d+-h\d+/, '=w544-h544').replace(/\/(default|mqdefault|hqdefault)\.jpg/, '/hqdefault.jpg')
}

/** Shape shared by search results and playlist rows (MusicResponsiveListItem). */
interface ListItem {
  id?: string
  title?: string
  artists?: { name: string }[]
  author?: { name: string }
  album?: { name?: string }
  duration?: { seconds: number }
  thumbnails?: { url: string }[]
}

/** Shape of library grid cards (MusicTwoRowItem). */
interface CardItem {
  id?: string
  item_type?: string
  title?: { toString(): string }
  subtitle?: { toString(): string }
  thumbnail?: { url: string }[]
}

function toTrack(s: ListItem): Track | null {
  if (!s.id || !s.title) return null
  return {
    uid: `youtube:${s.id}`,
    source: 'youtube',
    id: s.id,
    title: s.title,
    artist: s.artists?.map((a) => a.name).join(', ') || s.author?.name || 'Unknown Artist',
    album: s.album?.name ?? 'YouTube Music',
    duration: s.duration?.seconds ?? 0,
    artwork: bigThumb(s.thumbnails?.[0]?.url),
  }
}

export class YouTubeMusic implements StreamingSource, AccountSource {
  /** anonymous client: search + streaming (tested path, independent of any login) */
  private client: Promise<Innertube> | null = null
  /** signed-in client: only for the user's own library */
  private authedClient: Promise<Innertube> | null = null
  private streams = new Map<string, ResolvedStream>()
  private userName: string | null = null
  private poTokens = new PoTokenMinter(async () => {
    const res = await (await this.yt()).getAttestationChallenge('ENGAGEMENT_TYPE_UNBOUND')
    const bg = res.bg_challenge
    const interpreterUrl = bg?.interpreter_url.private_do_not_access_or_else_trusted_resource_url_wrapped_value
    if (!bg || !interpreterUrl) throw new Error('YouTube sent no BotGuard challenge')
    return { program: bg.program, globalName: bg.global_name, interpreterUrl }
  })

  constructor(
    private readonly cacheDir: string,
    private readonly secrets: Secrets,
  ) {}

  /** Called with the code the user types at google.com/device during sign-in. */
  onDeviceCode: (code: DeviceCode) => void = () => {}
  private loginAttempt = 0

  private saved(): SavedLogin | undefined {
    const raw = this.secrets.get(OAUTH_KEY)
    return raw ? (JSON.parse(raw) as SavedLogin) : undefined
  }

  private save(tokens: SavedLogin | undefined) {
    return this.secrets.set(OAUTH_KEY, tokens ? JSON.stringify(tokens) : undefined)
  }

  private yt() {
    this.client ??= Innertube.create({
      generate_session_locally: true,
      retrieve_player: true,
      user_agent: UA,
      cache: new UniversalCache(true, join(this.cacheDir, 'youtube')),
    }).catch((err) => {
      this.client = null // retry next time
      throw err
    })
    return this.client
  }

  private authed() {
    this.authedClient ??= (async () => {
      if (this.saved()?.client) await this.bearer() // refresh our own client's token first
      const saved = this.saved()
      if (!saved) throw new Error('YouTube Music account is not connected')
      const yt = await Innertube.create({ retrieve_player: false })
      // tokens refresh themselves hourly; keep the newest ones
      yt.session.on('update-credentials', ({ credentials }) => {
        if (credentials?.access_token) {
          void this.save({ ...(credentials as OAuth2Tokens), client: saved.client, mode: saved.mode })
        }
      })
      await yt.session.signIn(saved)
      return yt
    })().catch((err) => {
      this.authedClient = null
      throw err
    })
    return this.authedClient
  }

  // ---------- account ----------

  async status(): Promise<AccountStatus> {
    return { connected: !!this.saved(), userName: this.userName }
  }

  /**
   * "Sign in with a code", like on a smart TV: we show a code, the user approves it at
   * google.com/device in their own browser. `arg` may carry the user's own Google OAuth
   * client ("TVs and Limited Input devices" type) as JSON, if YouTube refuses the default one.
   */
  async login(arg = ''): Promise<AccountStatus> {
    const attempt = ++this.loginAttempt
    const custom = arg ? (JSON.parse(arg) as { clientId: string; clientSecret: string }) : null
    const client = custom ? { client_id: custom.clientId.trim(), client_secret: custom.clientSecret.trim() } : undefined

    let tokens: OAuth2Tokens
    if (client) {
      tokens = await this.deviceFlow(client, attempt)
    } else {
      const yt = await Innertube.create({ retrieve_player: false })
      tokens = await new Promise<OAuth2Tokens>((resolve, reject) => {
        const noCode = setTimeout(() => reject(new Error("Google didn't send a sign-in code (timed out)")), 30_000)
        yt.session.on('auth-pending', (d) => {
          clearTimeout(noCode)
          this.onDeviceCode({ code: d.user_code, url: d.verification_url })
        })
        yt.session.on('auth', ({ credentials }) => (credentials ? resolve(credentials) : reject(new Error('no credentials'))))
        yt.session.on('auth-error', (err) => reject(err))
        yt.session.signIn().catch(reject)
      }).catch((err: Error) => {
        throw new Error(`Google sign-in failed: ${err.message}`)
      })
    }
    if (attempt !== this.loginAttempt) throw new Error('Sign-in was cancelled')

    // Prove the library is reachable before calling it connected. YouTube Music's own API is
    // tried first; if it refuses this kind of login, the official YouTube Data API often accepts it.
    const reasons: string[] = []
    for (const mode of ['music', 'dataapi'] as const) {
      await this.save({ ...tokens, client, mode })
      this.authedClient = null
      try {
        if (mode === 'music') await (await this.authed()).music.getPlaylist('LM')
        else {
          const me = await this.dataApi<{ items?: { snippet?: { title?: string } }[] }>('/channels', {
            part: 'snippet',
            mine: 'true',
          })
          this.userName = me.items?.[0]?.snippet?.title ?? null
        }
        if (mode === 'music') {
          try {
            const info = await (await this.authed()).account.getInfo()
            const first = (info.contents?.contents as unknown as { account_name?: { toString(): string } }[] | undefined)?.[0]
            this.userName = first?.account_name?.toString() ?? null
          } catch {
            // name is cosmetic
          }
        }
        return this.status()
      } catch (err) {
        reasons.push(`${mode === 'music' ? 'YouTube Music' : 'YouTube Data API'}: ${(err as Error).message}`)
      }
    }
    await this.logout()
    throw new Error(
      custom
        ? `YouTube refused this sign-in (${reasons.join('; ')}).`
        : `NEEDS_CLIENT: YouTube didn't accept the TV sign-in (${reasons.join('; ')}).`,
    )
  }

  cancelLogin() {
    this.loginAttempt++
  }

  /** Google's "sign in on another device" flow with the user's own OAuth client. */
  private async deviceFlow(client: { client_id: string; client_secret: string }, attempt: number): Promise<OAuth2Tokens> {
    const start = await googlePost('/device/code', { client_id: client.client_id, scope: YOUTUBE_SCOPE })
    const d = (await start.json()) as {
      device_code?: string
      user_code?: string
      verification_url?: string
      interval?: number
      expires_in?: number
      error?: string
      error_description?: string
    }
    if (!start.ok || !d.device_code) {
      throw new Error(`Google refused the client (${d.error_description || d.error || start.status}). Check the Client ID and that its type is "TVs and Limited Input devices".`)
    }
    this.onDeviceCode({ code: d.user_code!, url: d.verification_url! })

    let interval = (d.interval ?? 5) * 1000
    const deadline = Date.now() + (d.expires_in ?? 1800) * 1000
    while (Date.now() < deadline) {
      await sleep(interval)
      if (attempt !== this.loginAttempt) throw new Error('Sign-in was cancelled')
      const res = await googlePost('/token', {
        client_id: client.client_id,
        client_secret: client.client_secret,
        device_code: d.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }).catch(() => null) // a dropped poll just means we ask again next round
      if (!res) continue
      const t = (await res.json()) as GoogleTokenResponse
      if (t.access_token && t.refresh_token) {
        return {
          access_token: t.access_token,
          refresh_token: t.refresh_token,
          expiry_date: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
          token_type: t.token_type ?? 'Bearer',
          scope: t.scope ?? YOUTUBE_SCOPE,
        } as OAuth2Tokens
      }
      if (t.error === 'authorization_pending') continue
      if (t.error === 'slow_down') {
        interval += 5000
        continue
      }
      if (t.error === 'access_denied') {
        throw new Error(
          'Google blocked or declined the sign-in. If it said "Access blocked … has not completed the Google verification process", add your Gmail under Google Auth Platform → Audience → Test users, then sign in again.',
        )
      }
      throw new Error(`Google sign-in failed: ${t.error_description || t.error || res.status}`)
    }
    throw new Error('The sign-in code expired. Try again.')
  }

  /** A fresh access token. The user's own client refreshes directly with Google. */
  private async bearer(): Promise<string> {
    const saved = this.saved()
    if (!saved) throw new Error('not signed in')
    if (saved.client) {
      if (Date.parse(saved.expiry_date) - Date.now() > 120_000) return saved.access_token
      const res = await googlePost('/token', {
        client_id: saved.client.client_id,
        client_secret: saved.client.client_secret,
        refresh_token: saved.refresh_token,
        grant_type: 'refresh_token',
      })
      const t = (await res.json()) as GoogleTokenResponse
      if (!t.access_token) {
        throw new Error(`Your YouTube sign-in expired (${t.error_description || t.error}). Sign in again.`)
      }
      const next: SavedLogin = {
        ...saved,
        access_token: t.access_token,
        refresh_token: t.refresh_token ?? saved.refresh_token,
        expiry_date: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
      }
      await this.save(next)
      this.authedClient = null // youtubei picks up the new token next time
      return next.access_token
    }
    const yt = await this.authed()
    const oauth = yt.session.oauth
    if (oauth.shouldRefreshToken()) await oauth.refreshAccessToken()
    const token = oauth.oauth2_tokens?.access_token
    if (!token) throw new Error('not signed in')
    return token
  }

  async logout() {
    await this.save(undefined)
    this.authedClient = null
    this.userName = null
  }

  private signedIn() {
    return this.authed()
  }

  private get usesDataApi() {
    return this.saved()?.mode === 'dataapi'
  }

  /** Official YouTube Data API v3 call with the signed-in user's token. */
  private async dataApi<T>(path: string, params: Record<string, string>): Promise<T> {
    const token = await this.bearer()
    const res = await fetch(`https://www.googleapis.com/youtube/v3${path}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = (await res.json()) as T & { error?: { message?: string } }
    if (!res.ok) throw new Error(json.error?.message?.replace(/<[^>]+>/g, '') || `HTTP ${res.status}`)
    return json
  }

  /** Every item of a playlist through the Data API, with durations filled in. */
  private async dataPlaylistTracks(id: string): Promise<Track[]> {
    const items: DataApiItem[] = []
    let pageToken = ''
    do {
      const page = await this.dataApi<{ items: DataApiItem[]; nextPageToken?: string }>('/playlistItems', {
        part: 'snippet,contentDetails',
        playlistId: id,
        maxResults: '50',
        ...(pageToken ? { pageToken } : {}),
      })
      items.push(...page.items)
      pageToken = page.nextPageToken ?? ''
    } while (pageToken && items.length < 2000)

    const playable = items.filter((i) => {
      const title = i.snippet?.title ?? ''
      return (i.contentDetails?.videoId || i.snippet?.resourceId?.videoId) && !/^(deleted|private) video$/i.test(title)
    })
    const durations = new Map<string, number>()
    for (let i = 0; i < playable.length; i += 50) {
      const ids = playable.slice(i, i + 50).map((p) => p.contentDetails?.videoId ?? p.snippet!.resourceId!.videoId!)
      const res = await this.dataApi<{ items: { id: string; contentDetails?: { duration?: string } }[] }>('/videos', {
        part: 'contentDetails',
        id: ids.join(','),
      })
      for (const v of res.items) durations.set(v.id, isoSeconds(v.contentDetails?.duration))
    }
    return playable.map((p) => {
      const videoId = p.contentDetails?.videoId ?? p.snippet!.resourceId!.videoId!
      return {
        uid: `youtube:${videoId}`,
        source: 'youtube' as const,
        id: videoId,
        title: p.snippet?.title ?? 'Untitled',
        // music uploads come from "Artist - Topic" channels
        artist: (p.snippet?.videoOwnerChannelTitle ?? 'Unknown Artist').replace(/\s+-\s+Topic$/, ''),
        album: 'YouTube Music',
        duration: durations.get(videoId) ?? 0,
        artwork: bestThumb(p.snippet?.thumbnails),
      }
    })
  }

  async liked(): Promise<Track[]> {
    if (!this.usesDataApi) return this.playlistTracks('LM') // YouTube Music's special "Liked music" playlist
    // "LM" is liked music; older accounts may only expose "LL" (all liked videos)
    return this.dataPlaylistTracks('LM').catch(() => this.dataPlaylistTracks('LL'))
  }

  async playlists(): Promise<RemotePlaylist[]> {
    if (this.usesDataApi) {
      const out: RemotePlaylist[] = []
      let pageToken = ''
      do {
        const page = await this.dataApi<{ items: DataApiItem[]; nextPageToken?: string }>('/playlists', {
          part: 'snippet,contentDetails',
          mine: 'true',
          maxResults: '50',
          ...(pageToken ? { pageToken } : {}),
        })
        for (const p of page.items) {
          out.push({
            id: p.id!,
            name: p.snippet?.title ?? 'Playlist',
            artwork: bestThumb(p.snippet?.thumbnails),
            owner: p.snippet?.channelTitle ?? '',
            total: p.contentDetails?.itemCount ?? 0,
          })
        }
        pageToken = page.nextPageToken ?? ''
      } while (pageToken && out.length < 500)
      return out
    }
    const yt = await this.signedIn()
    let library = await yt.music.getLibrary()
    const filter = library.filters.find((f) => /playlist/i.test(f))
    if (filter) library = await library.applyFilter(filter)

    const out: RemotePlaylist[] = []
    const collect = (section: unknown) => {
      const s = section as { items?: CardItem[]; contents?: CardItem[] }
      for (const it of s.items ?? s.contents ?? []) {
        if (it.item_type !== 'playlist' || !it.id) continue
        const id = it.id.replace(/^VL/, '')
        if (id === 'LM' || out.some((p) => p.id === id)) continue // liked songs has its own tab
        const sub = it.subtitle?.toString() ?? ''
        out.push({
          id,
          name: it.title?.toString() ?? 'Playlist',
          artwork: bigThumb(it.thumbnail?.[0]?.url),
          owner: sub.split('•')[0]?.trim() ?? '',
          total: Number(sub.match(/([\d.,]+)\s+\S+\s*$/)?.[1]?.replace(/[.,]/g, '')) || 0,
        })
      }
    }
    for (const section of library.contents ?? []) collect(section)
    if (library.has_continuation) {
      let page = await library.getContinuation()
      collect(page.contents)
      for (let i = 0; i < 10 && page.has_continuation; i++) {
        page = await page.getContinuation()
        collect(page.contents)
      }
    }
    return out
  }

  async playlistTracks(id: string): Promise<Track[]> {
    if (this.usesDataApi) return this.dataPlaylistTracks(id)
    const yt = await this.signedIn()
    let page = await yt.music.getPlaylist(id)
    const items: ListItem[] = [...(page.items as unknown as ListItem[])]
    for (let i = 0; i < 100 && page.has_continuation; i++) {
      page = await page.getContinuation()
      items.push(...(page.items as unknown as ListItem[]))
    }
    return items.map(toTrack).filter((t): t is Track => !!t)
  }

  // ---------- search / matching ----------

  async search(query: string, limit = 30): Promise<Track[]> {
    const yt = await this.yt()
    const res = await yt.music.search(query, { type: 'song' })
    const songs = (res.songs?.contents ?? []) as unknown as ListItem[]
    return songs
      .map(toTrack)
      .filter((t): t is Track => !!t)
      .slice(0, limit)
  }

  /** Finds the same song on YouTube Music (used when a Spotify song can't play through Spotify). */
  async match(t: MatchTarget): Promise<Track | null> {
    return bestMatch(t, await this.search(`${t.artist.split(',')[0].trim()} ${t.title}`, 10))
  }

  // ---------- streaming ----------

  /** Audio goes through our media:// proxy so we control ranges and can refresh expired URLs. */
  async resolve(id: string): Promise<StreamInfo> {
    const stream = await this.stream(id) // resolve now so errors reach the player immediately
    return { url: `media://youtube/${encodeURIComponent(id)}`, kind: 'direct', gainDb: stream.gainDb }
  }

  async stream(id: string, fresh = false): Promise<ResolvedStream> {
    const cached = this.streams.get(id)
    if (cached && !fresh && cached.expires > Date.now()) return cached

    const yt = await this.yt()
    let poToken: string | undefined
    try {
      poToken = await this.poTokens.mint(id)
    } catch (err) {
      console.warn('[youtube] PO token unavailable, playback may stop after ~1 MB:', err)
    }
    let lastError: unknown
    for (const client of CLIENTS) {
      try {
        const info = await yt.getBasicInfo(id, { client, po_token: poToken })
        const format = info.chooseFormat({ type: 'audio', quality: 'best', format: 'any' })
        const deciphered = new URL(await format.decipher(yt.session.player))
        if (poToken) deciphered.searchParams.set('pot', poToken)
        const url = deciphered.toString()
        const expireParam = Number(deciphered.searchParams.get('expire'))
        const stream: ResolvedStream = {
          url,
          mime: format.mime_type.split(';')[0],
          length: Number(format.content_length) || 0,
          // refresh a few minutes before YouTube's own expiry (default: 1 hour)
          expires: expireParam ? expireParam * 1000 - 5 * 60_000 : Date.now() + 60 * 60_000,
          gainDb:
            format.track_absolute_loudness_lkfs != null
              ? -14 - format.track_absolute_loudness_lkfs
              : format.loudness_db != null
                ? -format.loudness_db // relative to YouTube's own -14 LUFS reference
                : undefined,
        }
        if (!stream.length) {
          const head = await fetch(url, { headers: { Range: 'bytes=0-0' } })
          stream.length = Number(head.headers.get('content-range')?.split('/')[1]) || 0
        }
        this.streams.set(id, stream)
        return stream
      } catch (err) {
        lastError = err
      }
    }
    throw new Error(`YouTube wouldn't give us this song (${(lastError as Error)?.message ?? 'unknown error'})`)
  }

  /** Serves a byte range of a YouTube audio stream to the <audio> element. */
  async serve(id: string, range: string | null): Promise<Response> {
    let stream = await this.stream(id)
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
    let start = m?.[1] ? Number(m[1]) : 0
    let end = m?.[2] ? Number(m[2]) : start + CHUNK - 1
    if (m && !m[1] && m[2]) start = Math.max(0, stream.length - Number(m[2])) // suffix range
    if (stream.length) end = Math.min(end, stream.length - 1)
    if (stream.length && start >= stream.length) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stream.length}` } })
    }

    let upstream = await fetch(stream.url, { headers: { Range: `bytes=${start}-${end}` } })
    if (upstream.status === 403 || upstream.status === 410) {
      // URL expired or got revoked: fetch a new one and try once more
      stream = await this.stream(id, true)
      upstream = await fetch(stream.url, { headers: { Range: `bytes=${start}-${end}` } })
    }
    if (!upstream.ok) return new Response(`YouTube returned ${upstream.status}`, { status: 502 })

    const got = upstream.headers.get('content-range')
    return new Response(upstream.body, {
      status: 206,
      headers: {
        'Content-Type': stream.mime,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Content-Range': got ?? `bytes ${start}-${end}/${stream.length || '*'}`,
        'Content-Length': upstream.headers.get('content-length') ?? String(end - start + 1),
      },
    })
  }
}
