import { ClientType, Innertube, Log, Platform, type OAuth2Tokens } from 'youtubei.js'
import { File } from 'expo-file-system'
import type { AccountStatus, RemotePlaylist, Track } from '../../../../src/shared/types'
import { bestMatch, scoredMatch, type MatchTarget } from '../../../../src/main/sources/match'
import { JsonFile, miscCacheDir, secrets } from '../storage'
import type { Quality } from '../settings'
import { mintSessionToken, runInPage } from './botguard'
import type { StreamPlan } from './types'

Log.setLevel(Log.Level.ERROR)

const OAUTH_KEY = 'youtube.oauth'

/**
 * YouTube's stream URLs are scrambled by its player script; youtubei.js extracts the functions
 * and we run them. Hermes can compile code at runtime; if that ever fails, the hidden web page
 * runs them instead.
 */
let useWebEval = false
Platform.shim.eval = async (data, env) => {
  const args = JSON.stringify([env.n ?? '', env.sp ?? '', env.sig ?? ''])
  const body = `${data.output}\nreturn process(...${args});`
  if (!useWebEval) {
    try {
      // eslint-disable-next-line no-new-func
      return new Function(body)()
    } catch (err) {
      if (!(err instanceof SyntaxError) && !/eval|Function|compile/i.test(String(err))) throw err
      useWebEval = true
    }
  }
  return runInPage(`(function(){${body}})()`)
}

/** youtubei.js cache on disk: keeps YouTube's player script (~2 MB) so it isn't downloaded every launch. */
const diskCache = {
  cache_dir: miscCacheDir.uri,
  async get(key: string) {
    try {
      const f = new File(miscCacheDir, `yt-${key.replace(/[^\w.-]/g, '_')}`)
      return f.exists ? (await f.bytes()).buffer : undefined
    } catch {
      return undefined
    }
  },
  async set(key: string, value: ArrayBuffer) {
    try {
      new File(miscCacheDir, `yt-${key.replace(/[^\w.-]/g, '_')}`).write(new Uint8Array(value))
    } catch {
      // not critical
    }
  },
  async remove(key: string) {
    try {
      new File(miscCacheDir, `yt-${key.replace(/[^\w.-]/g, '_')}`).delete()
    } catch {
      // not critical
    }
  },
}

/** The streaming session: a visitor id and the PO token bound to it (valid for hours). */
interface PotSession {
  visitorData: string
  token: string
  expiresAt: number
}
const potFile = new JsonFile<PotSession | null>('youtube-session.json', null)

// ---------- shapes ----------

interface ListItem {
  id?: string
  title?: string
  artists?: { name: string }[]
  author?: { name: string }
  album?: { name?: string }
  duration?: { seconds: number }
  thumbnails?: { url: string }[]
}

function bigThumb(url?: string) {
  if (!url) return undefined
  return url.replace(/=w\d+-h\d+/, '=w400-h400').replace(/\/(default|mqdefault|hqdefault)\.jpg/, '/hqdefault.jpg')
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

type TvText = { simpleText?: string; runs?: { text: string }[] }
interface TvTile {
  contentId?: string
  contentType?: string
  header?: {
    tileHeaderRenderer?: {
      thumbnail?: { thumbnails?: { url: string }[] }
      thumbnailOverlays?: { thumbnailOverlayTimeStatusRenderer?: { text?: TvText } }[]
    }
  }
  metadata?: { tileMetadataRenderer?: { title?: TvText; lines?: { lineRenderer?: { items?: { lineItemRenderer?: { text?: TvText } }[] } }[] } }
}
const tvText = (t?: TvText) => t?.simpleText ?? t?.runs?.map((r) => r.text).join('') ?? ''

function findAll<T>(o: unknown, key: string, out: T[] = []): T[] {
  if (o && typeof o === 'object') {
    const rec = o as Record<string, unknown>
    if (key in rec) out.push(rec[key] as T)
    for (const v of Object.values(rec)) findAll(v, key, out)
  }
  return out
}

const clockSeconds = (s = '') => s.split(':').reduce((acc, p) => acc * 60 + (Number(p) || 0), 0)

function tvTrack(t: TvTile): Track | null {
  const id = t.contentId
  const meta = t.metadata?.tileMetadataRenderer
  const title = tvText(meta?.title)
  if (!id || !title || t.contentType !== 'TILE_CONTENT_TYPE_VIDEO') return null
  const artist = tvText(meta?.lines?.[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text).replace(/\s+-\s+Topic$/, '')
  const time = t.header?.tileHeaderRenderer?.thumbnailOverlays?.find((o) => o.thumbnailOverlayTimeStatusRenderer)
  return {
    uid: `youtube:${id}`,
    source: 'youtube',
    id,
    title,
    artist: artist || 'Unknown Artist',
    album: 'YouTube Music',
    duration: clockSeconds(tvText(time?.thumbnailOverlayTimeStatusRenderer?.text)),
    artwork: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  }
}

export interface DeviceCode {
  code: string
  url: string
}

class YouTube {
  /** search (no login, no player script needed) */
  private searchClient: Promise<Innertube> | null = null
  /** streaming: TV_SIMPLY client on the PO-token session */
  private streamClient: Promise<Innertube> | null = null
  private streamClientVisitor: string | null = null
  /** your library (TV app sign-in) */
  private authedClient: Promise<Innertube> | null = null
  private userName: string | null = null
  private minting: Promise<PotSession> | null = null
  private loginAttempt = 0
  onDeviceCode: (code: DeviceCode | null) => void = () => {}

  private search_() {
    this.searchClient ??= Innertube.create({ retrieve_player: false, generate_session_locally: true, cache: diskCache }).catch(
      (err) => {
        this.searchClient = null
        throw err
      },
    )
    return this.searchClient
  }

  // ---------- PO token session ----------

  /** A valid session token, minting a new one if it's missing or about to expire. */
  async potSession(force = false): Promise<PotSession> {
    const cur = potFile.get()
    if (!force && cur && cur.expiresAt - Date.now() > 10 * 60_000) return cur
    this.minting ??= (async () => {
      const yt = await Innertube.create({ retrieve_player: false, generate_session_locally: true, cache: diskCache })
      const visitorData = yt.session.context.client.visitorData
      if (!visitorData) throw new Error('YouTube gave no session id')
      const res = await yt.getAttestationChallenge('ENGAGEMENT_TYPE_UNBOUND')
      const bg = res.bg_challenge
      const interpreterUrl = bg?.interpreter_url.private_do_not_access_or_else_trusted_resource_url_wrapped_value
      if (!bg || !interpreterUrl) throw new Error('YouTube sent no BotGuard challenge')
      const { token, ttl } = await mintSessionToken(visitorData, { program: bg.program, globalName: bg.global_name, interpreterUrl })
      // the integrity token usually lasts 12 h; renew well before
      const session: PotSession = { visitorData, token, expiresAt: Date.now() + Math.max(1800, Math.min(ttl, 6 * 3600)) * 1000 }
      potFile.set(session, true)
      return session
    })().finally(() => (this.minting = null))
    return this.minting
  }

  /** Refreshes the token in the foreground when it's getting old, so locked-screen playback never needs the web page. */
  warmUp() {
    const cur = potFile.get()
    if (!cur || cur.expiresAt - Date.now() < 2 * 3600_000) this.potSession(!!cur).catch((e) => console.warn('[youtube] token', e))
  }

  private async stream_() {
    const session = await this.potSession()
    if (!this.streamClient || this.streamClientVisitor !== session.visitorData) {
      this.streamClientVisitor = session.visitorData
      this.streamClient = Innertube.create({
        retrieve_player: true,
        generate_session_locally: true,
        visitor_data: session.visitorData,
        po_token: session.token,
        cache: diskCache,
      }).catch((err) => {
        this.streamClient = null
        throw err
      })
    }
    return { yt: await this.streamClient, session }
  }

  // ---------- search ----------

  async search(query: string, limit = 30): Promise<Track[]> {
    const yt = await this.search_()
    const res = await yt.music.search(query, { type: 'song' })
    const songs = (res.songs?.contents ?? []) as unknown as ListItem[]
    return songs
      .map(toTrack)
      .filter((t): t is Track => !!t)
      .slice(0, limit)
  }

  async match(t: MatchTarget) {
    return bestMatch(t, await this.search(`${t.artist.split(',')[0].trim()} ${t.title}`, 10))
  }

  async matchScored(t: MatchTarget) {
    return scoredMatch(t, await this.search(`${t.artist.split(',')[0].trim()} ${t.title}`, 10))
  }

  // ---------- streaming ----------

  /**
   * Where to download a song from. iPhones play AAC (not YouTube's Opus), so the choice is
   * itag 139 (~48 kbps), 140 (~128 kbps) or, rarely, 141 (256 kbps).
   */
  async plan(id: string, quality: Quality, retry = true): Promise<StreamPlan> {
    const { yt, session } = await this.stream_()
    try {
      const info = await yt.getBasicInfo(id, { client: 'TV_SIMPLY' })
      const status = info.playability_status?.status
      if (status && status !== 'OK') throw new Error(info.playability_status?.reason || `not playable (${status})`)
      const aac = [...(info.streaming_data?.adaptive_formats ?? [])]
        .filter((f) => f.has_audio && !f.has_video && f.mime_type.startsWith('audio/mp4'))
        .sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0))
      if (!aac.length) throw new Error('no iPhone-playable audio for this song')
      const pick =
        quality === 'low'
          ? aac[0]
          : quality === 'mid'
            ? (aac.find((f) => f.itag === 140) ?? aac[aac.length - 1])
            : aac[aac.length - 1]
      const url = new URL(await pick.decipher(yt.session.player))
      url.searchParams.set('pot', session.token)
      const bytes = Number(pick.content_length) || 0
      if (bytes) url.searchParams.set('range', `0-${bytes - 1}`)
      const kbps = Math.round((pick.average_bitrate ?? pick.bitrate ?? 128_000) / 1000)
      return {
        source: 'youtube',
        id,
        kind: 'file',
        url: url.toString(),
        ext: 'm4a',
        codec: 'aac',
        kbps,
        quality: `AAC · ${kbps} kbps`,
        bytes,
        gainDb:
          pick.track_absolute_loudness_lkfs != null
            ? -14 - pick.track_absolute_loudness_lkfs
            : pick.loudness_db != null
              ? -pick.loudness_db
              : undefined,
      }
    } catch (err) {
      // a rejected token or stale player script: start a fresh session once
      if (retry && /403|sign in|bot|token/i.test(String(err))) {
        this.streamClient = null
        await this.potSession(true)
        return this.plan(id, quality, false)
      }
      throw err
    }
  }

  /** The URL failed with 403 while downloading: next plan() starts a fresh session. */
  invalidateSession() {
    potFile.set(null, true)
    this.streamClient = null
  }

  // ---------- account (YouTube's TV sign-in: a code you approve at google.com/device) ----------

  private saved(): OAuth2Tokens | null {
    const raw = secrets.get(OAUTH_KEY)
    try {
      return raw ? (JSON.parse(raw) as OAuth2Tokens) : null
    } catch {
      return null
    }
  }

  private authed() {
    this.authedClient ??= (async () => {
      const saved = this.saved()
      if (!saved) throw new Error('YouTube Music account is not connected')
      const yt = await Innertube.create({ retrieve_player: false, client_type: ClientType.TV, cache: diskCache })
      yt.session.on('update-credentials', ({ credentials }) => {
        if (credentials?.access_token) void secrets.set(OAUTH_KEY, JSON.stringify(credentials))
      })
      await yt.session.signIn(saved)
      return yt
    })().catch((err) => {
      this.authedClient = null
      throw err
    })
    return this.authedClient
  }

  status(): AccountStatus {
    const saved = this.saved()
    if (saved && this.userName === null) this.lookupName()
    return { connected: !!saved, userName: this.userName }
  }

  private nameLookup: Promise<void> | null = null
  private lookupName() {
    this.nameLookup ??= this.authed()
      .then((yt) => yt.account.getInfo())
      .then((info) => {
        const first = (info.contents?.contents as unknown as { account_name?: { toString(): string } }[] | undefined)?.[0]
        this.userName = first?.account_name?.toString() ?? null
      })
      .catch(() => {})
  }

  async login(): Promise<AccountStatus> {
    const attempt = ++this.loginAttempt
    const yt = await Innertube.create({ retrieve_player: false, generate_session_locally: true })
    const tokens = await new Promise<OAuth2Tokens>((resolve, reject) => {
      const noCode = setTimeout(() => reject(new Error("Google didn't send a sign-in code (timed out)")), 30_000)
      yt.session.on('auth-pending', (d) => {
        clearTimeout(noCode)
        this.onDeviceCode({ code: d.user_code, url: d.verification_url })
      })
      yt.session.on('auth', ({ credentials }) => (credentials ? resolve(credentials) : reject(new Error('no credentials'))))
      yt.session.on('auth-error', (err) => reject(err))
      yt.session.signIn().catch(reject)
    })
    this.onDeviceCode(null)
    if (attempt !== this.loginAttempt) throw new Error('Sign-in was cancelled')
    await secrets.set(OAUTH_KEY, JSON.stringify(tokens))
    this.authedClient = null
    try {
      await this.tvBrowse({ browseId: 'VLLM' }) // prove the library is reachable
    } catch (err) {
      await this.logout()
      throw new Error(`YouTube didn't accept the sign-in (${(err as Error).message})`)
    }
    this.nameLookup = null
    this.lookupName()
    await this.nameLookup
    return this.status()
  }

  cancelLogin() {
    this.loginAttempt++
    this.onDeviceCode(null)
  }

  async logout() {
    await secrets.set(OAUTH_KEY, null)
    this.authedClient = null
    this.userName = null
    this.nameLookup = null
    this.likedIds = null
  }

  private async tvBrowse(body: Record<string, unknown>, endpoint = '/browse') {
    const yt = await this.authed()
    const res = await yt.actions.execute(endpoint, { ...body, client: 'TV' })
    return res.data as unknown
  }

  private async tvTiles(browseId: string, maxPages = 200): Promise<TvTile[]> {
    let page = await this.tvBrowse({ browseId })
    const tiles = findAll<TvTile>(page, 'tileRenderer')
    for (let i = 0; i < maxPages; i++) {
      const next = findAll<{ continuation?: string }>(page, 'nextContinuationData')[0]?.continuation
      if (!next) break
      page = await this.tvBrowse({ continuation: next })
      tiles.push(...findAll<TvTile>(page, 'tileRenderer'))
    }
    return tiles
  }

  private async tvTracks(browseId: string): Promise<Track[]> {
    const seen = new Set<string>()
    return (await this.tvTiles(browseId))
      .map(tvTrack)
      .filter((t): t is Track => !!t && !seen.has(t.id) && !!seen.add(t.id))
  }

  private likedIds: { at: number; ids: Set<string> } | null = null

  async liked(): Promise<Track[]> {
    const tracks = await this.tvTracks('VLLM')
    this.likedIds = { at: Date.now(), ids: new Set(tracks.map((t) => t.id)) }
    return tracks
  }

  /** Uses the liked list already loaded (no extra requests) when there is one. */
  rememberLiked(tracks: Track[]) {
    this.likedIds = { at: Date.now(), ids: new Set(tracks.map((t) => t.id)) }
  }

  async isLiked(ids: string[]): Promise<boolean[]> {
    if (!this.saved()) return ids.map(() => false)
    if (!this.likedIds) await this.liked()
    return ids.map((id) => !!this.likedIds?.ids.has(id))
  }

  async setLiked(id: string, liked: boolean) {
    await this.tvBrowse({ target: { videoId: id } }, liked ? '/like/like' : '/like/removelike')
    if (liked) this.likedIds?.ids.add(id)
    else this.likedIds?.ids.delete(id)
  }

  async playlists(): Promise<RemotePlaylist[]> {
    const out: RemotePlaylist[] = []
    for (const t of await this.tvTiles('FEplaylist_aggregation', 20)) {
      const id = t.contentId
      if (t.contentType !== 'TILE_CONTENT_TYPE_PLAYLIST' || !id || id === 'LL' || id === 'LM' || out.some((p) => p.id === id)) continue
      out.push({
        id,
        name: tvText(t.metadata?.tileMetadataRenderer?.title) || 'Playlist',
        artwork: t.header?.tileHeaderRenderer?.thumbnail?.thumbnails?.at(-1)?.url,
        owner: this.userName ?? '',
        total: 0,
        editable: id.startsWith('PL') || id === 'WL',
      })
    }
    return out
  }

  playlistTracks(id: string) {
    return this.tvTracks(`VL${id}`)
  }

  async addToPlaylist(playlistId: string, videoId: string) {
    await this.tvBrowse({ playlistId, actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId }] }, '/browse/edit_playlist')
  }
}

export const youtube = new YouTube()
