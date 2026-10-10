/** How to download one song's audio. */
export interface StreamPlan {
  source: 'youtube' | 'soundcloud'
  id: string
  /** 'file': one download; 'hls': a playlist of segments joined into one file */
  kind: 'file' | 'hls'
  url: string
  /** file extension of the result */
  ext: 'm4a' | 'mp3' | 'mp4'
  codec: 'aac' | 'mp3'
  kbps: number
  /** for display, e.g. "AAC · 128 kbps" */
  quality: string
  /** expected size, when known */
  bytes?: number
  /** gain (dB) to reach -14 LUFS, when the source publishes loudness info */
  gainDb?: number
}
