import { useRef, useState, type CSSProperties, type ReactNode, type WheelEvent } from 'react'
import type { Playlist, Track } from '../../../shared/types'
import { cls } from '../lib/format'
import { playTracks } from '../lib/player'
import { MusicIcon, PlayIcon, ShuffleIcon } from './Icons'

export function Artwork({ src, size, className }: { src?: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const style = size ? { width: size, height: size } : undefined
  return (
    <div className={cls('art', className)} style={style}>
      {src && failed !== src ? (
        <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(src)} />
      ) : (
        <MusicIcon size={size ? Math.max(14, Math.round(size * 0.38)) : 40} />
      )}
    </div>
  )
}

/** 2x2 mosaic of the first four distinct covers, like most music apps do for playlists. */
export function PlaylistArt({ playlist, size, className }: { playlist: Playlist; size?: number; className?: string }) {
  const covers = [...new Set(playlist.tracks.map((t) => t.artwork).filter(Boolean))] as string[]
  if (covers.length < 4) return <Artwork src={covers[0]} size={size} className={className} />
  return (
    <div className={cls('art mosaic', className)} style={size ? { width: size, height: size } : undefined}>
      {covers.slice(0, 4).map((c) => (
        <img key={c} src={c} alt="" loading="lazy" draggable={false} />
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
        <div className="slider-fill" style={{ width: `${shown * 100}%` }} />
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
