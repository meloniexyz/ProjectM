import vm from 'node:vm'
import { join } from 'node:path'
import { Innertube, Log, Platform, UniversalCache } from 'youtubei.js'
import type { Track } from '../../shared/types'
import { PoTokenMinter } from './potoken'
import { UA, type StreamInfo, type StreamingSource } from './types'

// Clients tried in order when fetching audio. YouTube changes which ones work every so often;
// if playback breaks, reordering this list (or `npm update youtubei.js`) is usually the fix.
const CLIENTS = ['YTMUSIC', 'IOS', 'MWEB'] as const
/** Max bytes fetched per range request; YouTube throttles/refuses huge open-ended ranges. */
const CHUNK = 8 * 1024 * 1024

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

export class YouTubeMusic implements StreamingSource {
  private client: Promise<Innertube> | null = null
  private streams = new Map<string, ResolvedStream>()
  private poTokens = new PoTokenMinter(async () => {
    const res = await (await this.yt()).getAttestationChallenge('ENGAGEMENT_TYPE_UNBOUND')
    const bg = res.bg_challenge
    const interpreterUrl = bg?.interpreter_url.private_do_not_access_or_else_trusted_resource_url_wrapped_value
    if (!bg || !interpreterUrl) throw new Error('YouTube sent no BotGuard challenge')
    return { program: bg.program, globalName: bg.global_name, interpreterUrl }
  })

  constructor(private readonly cacheDir: string) {}

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

  async search(query: string, limit = 30): Promise<Track[]> {
    const yt = await this.yt()
    const res = await yt.music.search(query, { type: 'song' })
    const songs = res.songs?.contents ?? []
    const tracks: Track[] = []
    for (const s of songs) {
      if (!s.id) continue
      const artist = s.artists?.map((a) => a.name).join(', ') || s.author?.name || 'Unknown Artist'
      tracks.push({
        uid: `youtube:${s.id}`,
        source: 'youtube',
        id: s.id,
        title: s.title ?? 'Untitled',
        artist,
        album: s.album?.name ?? 'YouTube Music',
        duration: s.duration?.seconds ?? 0,
        artwork: bigThumb(s.thumbnails?.[0]?.url),
      })
      if (tracks.length >= limit) break
    }
    return tracks
  }

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
        const expireParam = Number(new URL(url).searchParams.get('expire'))
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
