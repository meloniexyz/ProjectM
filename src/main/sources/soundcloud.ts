import type { Track } from '../../shared/types'
import { UA, type StreamInfo, type StreamingSource } from './types'

const API = 'https://api-v2.soundcloud.com'

interface Transcoding {
  url: string
  snipped?: boolean
  format: { protocol: string; mime_type: string }
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
export class SoundCloud implements StreamingSource {
  private clientId: Promise<string> | null = null

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
