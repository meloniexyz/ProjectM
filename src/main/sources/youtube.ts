import vm from 'node:vm'
import { join } from 'node:path'
import { Innertube, Log, Platform, UniversalCache } from 'youtubei.js'
import type { AccountStatus, RemotePlaylist, Track } from '../../shared/types'
import type { Secrets } from '../secrets'
import { PoTokenMinter } from './potoken'
import { UA, type AccountSource, type StreamInfo, type StreamingSource } from './types'

// Clients tried in order when fetching audio. YouTube changes which ones work every so often;
// if playback breaks, reordering this list (or `npm update youtubei.js`) is usually the fix.
const CLIENTS = ['YTMUSIC', 'IOS', 'MWEB'] as const
/** Max bytes fetched per range request; YouTube throttles/refuses huge open-ended ranges. */
const CHUNK = 8 * 1024 * 1024
const LOGIN_COOKIES = ['SAPISID', '__Secure-3PAPISID']

/**
 * Accepts what people paste: the cookie value, a "cookie: ..." header line, or a whole block
 * of copied request headers. Returns the bare cookie string.
 */
function extractCookie(input: string) {
  const text = input.trim()
  const line = text.split(/\r?\n/).find((l) => /^\s*cookie\s*:/i.test(l))
  const value = (line ? line.replace(/^\s*cookie\s*:\s*/i, '') : text).trim().replace(/^["']|["']$/g, '')
  return value
}

interface ResolvedStream {
  url: string
  mime: string
  length: number
  expires: number
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
function overlap(a: string, b: string) {
  const wa = new Set(words(a))
  const wb = words(b)
  if (!wa.size || !wb.length) return 0
  return wb.filter((w) => wa.has(w)).length / Math.max(wa.size, wb.length)
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

  /** The signed-in cookie header, if the user connected their account. */
  private async cookie(): Promise<string | undefined> {
    return this.secrets.get('youtube.cookie')
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
      const cookie = await this.cookie()
      if (!cookie) throw new Error('YouTube Music account is not connected')
      return Innertube.create({ cookie, user_agent: UA, retrieve_player: false })
    })().catch((err) => {
      this.authedClient = null
      throw err
    })
    return this.authedClient
  }

  // ---------- account ----------

  async status(): Promise<AccountStatus> {
    return { connected: !!(await this.cookie()), userName: this.userName }
  }

  /** Signs in with the cookie copied from a browser where the user is logged in to YouTube Music. */
  async login(pasted = ''): Promise<AccountStatus> {
    const cookie = extractCookie(pasted)
    if (!LOGIN_COOKIES.some((name) => new RegExp(`(^|;\\s*)${name}=`).test(cookie))) {
      throw new Error(
        "That doesn't look like a signed-in YouTube cookie (it has no SAPISID). Make sure you're logged in on music.youtube.com and copy the whole cookie value.",
      )
    }
    await this.secrets.set('youtube.cookie', cookie)
    this.authedClient = null // rebuild with the new cookie
    try {
      const info = await (await this.authed()).account.getInfo()
      const first = (info.contents?.contents as unknown as { account_name?: { toString(): string } }[] | undefined)?.[0]
      this.userName = first?.account_name?.toString() ?? null
    } catch (err) {
      await this.logout()
      throw new Error(`YouTube didn't accept that login (${(err as Error).message}). Copy a fresh cookie and try again.`)
    }
    return this.status()
  }

  async logout() {
    await this.secrets.set('youtube.cookie', undefined)
    this.authedClient = null
    this.userName = null
  }

  private signedIn() {
    return this.authed()
  }

  liked() {
    return this.playlistTracks('LM') // YouTube Music's special "Liked music" playlist
  }

  async playlists(): Promise<RemotePlaylist[]> {
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
  async match(t: { title: string; artist: string; duration: number }): Promise<Track | null> {
    const artist = t.artist.split(',')[0].trim()
    const candidates = await this.search(`${artist} ${t.title}`, 10)
    let best: { track: Track; score: number } | null = null
    for (const c of candidates) {
      const dur = t.duration && c.duration ? Math.abs(t.duration - c.duration) : 0
      if (dur > 15) continue
      const score = overlap(t.title, c.title) * 2 + overlap(t.artist, c.artist) - dur / 10
      if (!best || score > best.score) best = { track: c, score }
    }
    return best && best.score > 1 ? best.track : null
  }

  // ---------- streaming ----------

  /** Audio goes through our media:// proxy so we control ranges and can refresh expired URLs. */
  async resolve(id: string): Promise<StreamInfo> {
    await this.stream(id) // resolve now so errors reach the player immediately
    return { url: `media://youtube/${encodeURIComponent(id)}`, kind: 'direct' }
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
        'Content-Range': got ?? `bytes ${start}-${end}/${stream.length || '*'}`,
        'Content-Length': upstream.headers.get('content-length') ?? String(end - start + 1),
      },
    })
  }
}
