import { useRef, useState, type CSSProperties, type ReactNode, type WheelEvent } from 'react'
import type { Playlist, Track } from '../../../shared/types'
import { cls } from '../lib/format'
import { playTracks } from '../lib/player'
import { MusicIcon, PlayIcon, ShuffleIcon } from './Icons'

/**
 * Streaming services encode the image size in the URL. Asking for one close to what we
 * display keeps lists fast (a 40 px row doesn't need a 640 px cover).
 */
export function artUrl(src: string | undefined, px: number) {
  if (!src) return src
  if (src.includes('i.scdn.co/image/')) {
    const code = px <= 64 ? '4851' : px <= 300 ? '1e02' : 'b273' // Spotify: 64 / 300 / 640 px
    // Same images on Spotify's Fastly mirror, which loads faster and more reliably here
    return src
      .replace('i.scdn.co/image/', 'image-cdn-fa.spotifycdn.com/image/')
      .replace(/ab67616d0000(b273|1e02|4851)/, `ab67616d0000${code}`)
  }
  if (/googleusercontent\.com|ggpht\.com/.test(src)) return src.replace(/=w\d+-h\d+/, `=w${px}-h${px}`)
  if (src.includes('sndcdn.com')) {
    const size = px <= 67 ? 't67x67' : px <= 100 ? 'large' : px <= 300 ? 't300x300' : 't500x500'
    return src.replace(/-(t500x500|t300x300|large|t67x67)\./, `-${size}.`)
  }
  return src
}

export function Artwork(props: { src?: string; size?: number; className?: string; px?: number }) {
  const { size, className } = props
  const primary = artUrl(props.src, props.px ?? (size ? size * 2 : 300))
  // if a Spotify mirror drops the connection, try the other one before giving up
  const backup = primary?.includes('image-cdn-fa.spotifycdn.com')
    ? primary.replace('image-cdn-fa.spotifycdn.com', 'image-cdn-ak.spotifycdn.com')
    : undefined
  const [failed, setFailed] = useState<string[]>([])
  const src = [primary, backup].find((u) => u && !failed.includes(u))
  const style = size ? { width: size, height: size } : undefined
  return (
    <div className={cls('art', className)} style={style}>
      {src ? (
        <img key={src} src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed((f) => [...f, src])} />
      ) : (
        <MusicIcon size={size ? Math.max(14, Math.round(size * 0.38)) : 40} />
      )}
    </div>
  )
}

/** 2x2 mosaic of the first four distinct covers, like most music apps do for playlists. */
export function PlaylistArt({ playlist, size, className }: { playlist: Playlist; size?: number; className?: string }) {
  if (playlist.cover) return <Artwork src={playlist.cover} size={size} className={className} />
  const covers = [...new Set(playlist.tracks.map((t) => t.artwork).filter(Boolean))] as string[]
  if (covers.length < 4) return <Artwork src={covers[0]} size={size} className={className} />
  return (
    <div className={cls('art mosaic', className)} style={size ? { width: size, height: size } : undefined}>
      {covers.slice(0, 4).map((c) => (
        <img key={c} src={artUrl(c, 160)} alt="" loading="lazy" draggable={false} />
      ))}
    </div>
  )
}

export function Hero(props: {
  kicker: string
  title?: string
  titleNode?: ReactNode
  meta?: ReactNode
  art: ReactNode
  color?: string
}) {
  const style = props.color ? ({ '--hero': props.color } as CSSProperties) : undefined
  return (
    <header className="hero" style={style}>
      {props.art}
      <div className="hero-text">
        <div className="kicker">{props.kicker}</div>
        {props.titleNode ?? <h1>{props.title}</h1>}
        {props.meta && <div className="meta">{props.meta}</div>}
      </div>
    </header>
  )
}

export function PlayActions({ tracks, children }: { tracks: Track[]; children?: ReactNode }) {
  const empty = !tracks.length
  return (
    <div className="actions">
      <button className="btn-play" title="Play" disabled={empty} onClick={() => playTracks(tracks, 0)}>
        <PlayIcon size={24} />
      </button>
      <button
        className="icon-btn big"
        title="Shuffle play"
        disabled={empty}
        onClick={() => playTracks(tracks, Math.floor(Math.random() * tracks.length), true)}
      >
        <ShuffleIcon size={24} />
      </button>
      <div className="grow" />
      {children}
    </div>
  )
}

/** Animated "now playing" equalizer bars. */
export const Bars = ({ paused }: { paused?: boolean }) => (
  <span className={cls('bars', paused && 'paused')}>
    <i />
    <i />
    <i />
  </span>
)

export function Slider(props: {
  value: number
  onChange?: (v: number) => void
  onCommit?: (v: number) => void
  onWheel?: (e: WheelEvent) => void
  disabled?: boolean
  className?: string
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
  }
  const shown = Math.max(0, Math.min(1, drag ?? props.value))

  return (
    <div
      ref={ref}
      className={cls('slider', drag !== null && 'dragging', props.disabled && 'disabled', props.className)}
      role="slider"
      aria-label={props.label}
      aria-valuenow={Math.round(shown * 100)}
      onWheel={props.onWheel}
      onPointerDown={(e) => {
        if (props.disabled || e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const v = at(e.clientX)
        setDrag(v)
        props.onChange?.(v)
      }}
      onPointerMove={(e) => {
        if (drag === null) return
        const v = at(e.clientX)
        setDrag(v)
        props.onChange?.(v)
      }}
      onPointerUp={(e) => {
        if (drag === null) return
        props.onCommit?.(at(e.clientX))
        setDrag(null)
      }}
      onPointerCancel={() => setDrag(null)}
    >
      <div className="slider-track">
        <div className="slider-fill" style={{ width: `${shown * 100}%`, '--fill': Math.max(shown, 0.001) } as CSSProperties} />
      </div>
      <div className="slider-thumb" style={{ left: `${shown * 100}%` }} />
    </div>
  )
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      {children}
    </div>
  )
}
