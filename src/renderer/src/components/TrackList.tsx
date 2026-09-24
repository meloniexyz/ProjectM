import { useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Track } from '../../../shared/types'
import { cls, collator, fmtTime } from '../lib/format'
import { albumKey, isAvailable, lib } from '../lib/library'
import { ScrollContext, useNav } from '../lib/nav'
import { playTracks, toggle, usePlayer } from '../lib/player'
import { useStore } from '../lib/store'
import { openMenu } from '../lib/ui'
import { Artwork, Bars } from './common'
import { ClockIcon, PauseIcon, PlayIcon, SourceBadge } from './Icons'
import { trackMenu } from './trackMenu'

const ROW = 56
const OVERSCAN = 8

type SortKey = 'title' | 'artist' | 'album' | 'duration'

interface Props {
  tracks: Track[]
  /** set when showing a playlist, enables "Remove from this playlist" */
  playlistId?: string
  showAlbum?: boolean
  /** 'trackNo' shows album track numbers instead of list position */
  numbers?: 'index' | 'trackNo'
}

/** Virtualized track table: only rows near the viewport are rendered, so 20k-song libraries stay fast. */
export function TrackList({ tracks, playlistId, showAlbum = true, numbers = 'index' }: Props) {
  const nav = useNav()
  const scrollRef = useContext(ScrollContext)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [range, setRange] = useState({ start: 0, end: 30 })
  const localIds = useStore(lib, (s) => s.localIds)
  const currentUid = usePlayer((s) => s.queue[s.index]?.track.uid)
  const playing = usePlayer((s) => s.playing)

  // `i` is the index in the original list (playlist removal needs it); row order may be sorted.
  const rows = useMemo(() => {
    const r = tracks.map((track, i) => ({ track, i }))
    if (sort) {
      const { key, dir } = sort
      r.sort(
        (a, b) =>
          (key === 'duration'
            ? a.track.duration - b.track.duration
            : collator.compare(a.track[key], b.track[key])) * dir,
      )
    }
    return r
  }, [tracks, sort])

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    const body = bodyRef.current
    if (!scroller || !body) return
    const update = () => {
      const offset = scroller.getBoundingClientRect().top - body.getBoundingClientRect().top
      const start = Math.max(0, Math.floor(offset / ROW) - OVERSCAN)
      const end = Math.min(rows.length, Math.ceil((offset + scroller.clientHeight) / ROW) + OVERSCAN)
      setRange((r) => (r.start === start && r.end === end ? r : { start, end }))
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [scrollRef, rows.length])

  const play = (pos: number) =>
    playTracks(
      rows.map((r) => r.track),
      pos,
    )

  const sortBy = (key: SortKey) =>
    setSort((s) => (!s || s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null))

  const Head = ({ k, children, className }: { k: SortKey; children: ReactNode; className?: string }) => (
    <div
      className={cls('sortable', sort?.key === k && 'sorted', className)}
      onClick={() => sortBy(k)}
      title="Sort"
    >
      {children}
      {sort?.key === k && <span className="sort-arrow">{sort.dir === 1 ? '▲' : '▼'}</span>}
    </div>
  )

  const cols = cls('tl-cols', !showAlbum && 'no-album')

  return (
    <div className="tl">
      <div className={cls('tl-head', cols)}>
        <div className="c">#</div>
        <Head k="title">Title</Head>
        {showAlbum && <Head k="album">Album</Head>}
        <div />
        <Head k="duration" className="r">
          <ClockIcon size={15} />
        </Head>
      </div>
      <div ref={bodyRef} className="tl-body" style={{ height: rows.length * ROW }}>
        {rows.slice(range.start, range.end).map(({ track, i }, j) => {
          const pos = range.start + j
          const active = track.uid === currentUid
          const available = isAvailable(track, localIds)
          const num = numbers === 'trackNo' ? (track.trackNo ?? pos + 1) : pos + 1
          return (
            <div
              key={i}
              className={cls('tl-row', cols, active && 'active', selected === pos && 'selected', !available && 'unavailable')}
              style={{ top: pos * ROW }}
              onClick={() => setSelected(pos)}
              onDoubleClick={() => play(pos)}
              onContextMenu={(e) => {
                setSelected(pos)
                openMenu(e, trackMenu([track], nav, playlistId ? { id: playlistId, indices: [i] } : undefined))
              }}
            >
              <div className="tl-num">
                <span className="n">{active ? <Bars paused={!playing} /> : num}</span>
                <button
                  className="tl-play"
                  title={active && playing ? 'Pause' : 'Play'}
                  onClick={(e) => {
                    e.stopPropagation()
                    active ? toggle() : play(pos)
                  }}
                >
                  {active && playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
                </button>
              </div>
              <div className="tl-title">
                <Artwork src={track.artwork} size={40} />
                <div className="tl-text">
                  <div className="t" title={track.title}>
                    {track.title}
                  </div>
                  <div className="a">
                    <span
                      className="link"
                      onClick={(e) => {
                        e.stopPropagation()
                        nav.go({ kind: 'search', q: track.artist })
                      }}
                    >
                      {track.artist}
                    </span>
                  </div>
                </div>
              </div>
              {showAlbum && (
                <div className="tl-album">
                  <span
                    className="link"
                    onClick={(e) => {
                      e.stopPropagation()
                      nav.go({ kind: 'album', key: albumKey(track) })
                    }}
                  >
                    {track.album}
                  </span>
                </div>
              )}
              <div className="tl-src">
                <SourceBadge source={track.source} />
              </div>
              <div className="tl-dur">{fmtTime(track.duration)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
