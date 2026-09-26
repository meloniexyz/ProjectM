import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import type { ListenEntry, SourceId, Track } from '../../../shared/types'
import { cls, fmtTime, norm, plural } from '../lib/format'
import { formatRanges, listenLogStore } from '../lib/listenLog'
import { useNav } from '../lib/nav'
import { playTracks } from '../lib/player'
import { SOURCES } from '../lib/sources'
import { useStore } from '../lib/store'
import { openMenu, toast } from '../lib/ui'
import { Artwork, Empty } from './common'
import { ClockIcon, SearchIcon, SourceBadge } from './Icons'
import { trackMenu } from './trackMenu'

/** A play counts toward stats once you've heard 30 s of it (or most of a short song). */
const counts = (e: ListenEntry) => e.listened >= 30 || (e.duration > 0 && e.listened >= e.duration * 0.5)

const dayKey = (t: number) => new Date(t).toDateString()
function dayLabel(t: number) {
  const d = new Date(t)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  })
}
const timeOf = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

function fmtListened(sec: number) {
  const m = Math.round(sec / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h} hr ${m % 60} min` : `${Math.round(h / 24)} days ${h % 24} hr`
}

export function HistoryView({ tab = 'timeline' }: { tab?: 'timeline' | 'stats' }) {
  const nav = useNav()
  return (
    <div className="history">
      <div className="page-title">
        <h1>History</h1>
      </div>
      <div className="chips tabs history-tabs">
        <button className={cls('chip', tab === 'timeline' && 'on')} onClick={() => nav.go({ kind: 'history', tab: 'timeline' })}>
          Timeline
        </button>
        <button className={cls('chip', tab === 'stats' && 'on')} onClick={() => nav.go({ kind: 'history', tab: 'stats' })}>
          Stats
        </button>
      </div>
      {tab === 'stats' ? <StatsPanel /> : <Timeline />}
    </div>
  )
}

// ---------- timeline ----------

const PAGE = 400

function Timeline() {
  const nav = useNav()
  const version = useStore(listenLogStore, (s) => s.version)
  const [entries, setEntries] = useState<ListenEntry[] | null>(null)
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(PAGE)
  const [query, setQuery] = useState('')
  const [hideSkips, setHideSkips] = useState(false)

  useEffect(() => {
    window.api.history.list(0, limit).then((r) => {
      setEntries(r.entries)
      setTotal(r.total)
    })
  }, [limit, version])

  const shown = useMemo(() => {
    if (!entries) return []
    const q = norm(query.trim())
    return entries.filter(
      (e) =>
        (!hideSkips || counts(e)) &&
        (!q || norm(`${e.track.title} ${e.track.artist} ${e.track.album}`).includes(q)),
    )
  }, [entries, query, hideSkips])

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: ListenEntry[]; seconds: number }[] = []
    for (const e of shown) {
      const key = dayKey(e.startedAt)
      let g = out[out.length - 1]
      if (!g || g.key !== key) out.push((g = { key, label: dayLabel(e.startedAt), items: [], seconds: 0 }))
      g.items.push(e)
      g.seconds += e.listened
    }
    return out
  }, [shown])

  if (!entries) return null
  if (!entries.length) {
    return (
      <Empty icon={<ClockIcon size={30} />} title="Nothing played yet">
        <p>Everything you play from now on shows up here: which song, when, and which parts you heard.</p>
      </Empty>
    )
  }

  const remove = async (e: ListenEntry) => {
    await window.api.history.remove(e.id)
    setEntries((list) => list?.filter((x) => x.id !== e.id) ?? null)
  }

  return (
    <>
      <div className="history-toolbar">
        <label className="search-input small">
          <SearchIcon size={16} />
          <input value={query} placeholder="Search your history" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className={cls('chip', hideSkips && 'on')} onClick={() => setHideSkips((h) => !h)} title="Hide plays under 30 seconds">
          Hide skips
        </button>
        <span className="hint">{plural(total, 'play')} recorded</span>
      </div>
      {groups.map((g) => (
        <section key={g.key} className="history-day">
          <h2>
            {g.label}
            <span>
              {plural(g.items.length, 'play')} · {fmtListened(g.seconds)} listened
            </span>
          </h2>
          {g.items.map((e) => (
            <HistoryRow
              key={e.id}
              entry={e}
              onPlay={() => playTracks([e.track])}
              onMenu={(ev) =>
                openMenu(ev, [
                  ...trackMenu([e.track], nav),
                  { separator: true },
                  { label: 'Remove from history', danger: true, onClick: () => remove(e) },
                ])
              }
            />
          ))}
        </section>
      ))}
      {entries.length < total && (
        <div className="history-more">
          <button className="btn" onClick={() => setLimit((l) => l + PAGE)}>
            Show older plays
          </button>
        </div>
      )}
    </>
  )
}

function HistoryRow({ entry: e, onPlay, onMenu }: { entry: ListenEntry; onPlay: () => void; onMenu: (ev: MouseEvent) => void }) {
  const ranges = formatRanges(e.segments, fmtTime)
  const skipped = !counts(e)
  return (
    <div className={cls('history-row', skipped && 'skipped')} onDoubleClick={onPlay} onContextMenu={onMenu}>
      <span className="history-time">{timeOf(e.startedAt)}</span>
      <Artwork src={e.track.artwork} size={42} />
      <div className="history-text">
        <div className="t">{e.track.title}</div>
        <div className="a">{e.track.artist}</div>
      </div>
      <span className="history-src" title={e.via ? `${SOURCES[e.track.source].name} song, played from ${SOURCES[e.via].name}` : SOURCES[e.track.source].name}>
        <SourceBadge source={e.track.source} size={14} />
        {e.via && (
          <>
            <span className="via-arrow">→</span>
            <SourceBadge source={e.via} size={14} />
          </>
        )}
      </span>
      <div className="history-listen">
        <div className="history-ranges">{ranges ? `Listened ${ranges}` : 'Started, not heard'}</div>
        <div className="history-bar" title={ranges}>
          {e.duration > 0 &&
            e.segments.map(([a, b], i) => (
              <span key={i} style={{ left: `${(a / e.duration) * 100}%`, width: `${Math.max(0.5, ((b - a) / e.duration) * 100)}%` }} />
            ))}
        </div>
      </div>
      <span className="history-amount">
        {fmtTime(e.listened)} / {fmtTime(e.duration)}
        {skipped && <small>skipped</small>}
      </span>
    </div>
  )
}

// ---------- stats (your "wrapped") ----------

type Period = 7 | 30 | 365 | 0
const PERIODS: [Period, string][] = [
  [7, 'Past week'],
  [30, 'Past month'],
  [365, 'Past year'],
  [0, 'All time'],
]
const PLACEHOLDER_ALBUMS = /^(youtube music|soundcloud|spotify|unknown album)$/i

interface Tally {
  key: string
  label: string
  sub: string
  artwork?: string
  plays: number
  seconds: number
  track?: Track
}

function StatsPanel() {
  const version = useStore(listenLogStore, (s) => s.version)
  const [all, setAll] = useState<ListenEntry[] | null>(null)
  const [period, setPeriod] = useState<Period>(7)

  useEffect(() => {
    window.api.history.all().then(setAll)
  }, [version])

  const stats = useMemo(() => {
    if (!all) return null
    const since = period ? Date.now() - period * 86_400_000 : 0
    const inRange = all.filter((e) => e.startedAt >= since)
    const played = inRange.filter(counts)
    const tracks = new Map<string, Tally>()
    const artists = new Map<string, Tally>()
    const albums = new Map<string, Tally>()
    const sources = new Map<SourceId, number>()
    const hours = new Array(24).fill(0)
    const weekdays = new Array(7).fill(0)
    let seconds = 0
    const bump = (map: Map<string, Tally>, key: string, init: () => Omit<Tally, 'plays' | 'seconds'>, e: ListenEntry) => {
      const t = map.get(key) ?? { ...init(), plays: 0, seconds: 0 }
      t.plays += 1
      t.seconds += e.listened
      map.set(key, t)
    }
    for (const e of inRange) {
      seconds += e.listened
      const src = e.via ?? e.track.source
      sources.set(src, (sources.get(src) ?? 0) + e.listened)
      const d = new Date(e.startedAt)
      hours[d.getHours()] += e.listened
      weekdays[(d.getDay() + 6) % 7] += e.listened // Monday first
    }
    for (const e of played) {
      const t = e.track
      bump(tracks, t.uid, () => ({ key: t.uid, label: t.title, sub: t.artist, artwork: t.artwork, track: t }), e)
      for (const a of t.artist.split(/,|&| feat\.? | x /i).map((x) => x.trim()).filter(Boolean)) {
        bump(artists, a.toLowerCase(), () => ({ key: a, label: a, sub: '', artwork: t.artwork }), e)
      }
      if (!PLACEHOLDER_ALBUMS.test(t.album)) {
        const albumArtist = t.albumArtist || t.artist
        bump(albums, `${t.album}|${albumArtist}`.toLowerCase(), () => ({ key: t.album, label: t.album, sub: albumArtist, artwork: t.artwork }), e)
      }
    }
    const top = (map: Map<string, Tally>) => [...map.values()].sort((a, b) => b.plays - a.plays || b.seconds - a.seconds).slice(0, 10)
    const days = new Set(inRange.map((e) => dayKey(e.startedAt))).size
    return {
      seconds,
      plays: played.length,
      songs: tracks.size,
      artists: artists.size,
      days,
      topTracks: top(tracks),
      topArtists: top(artists),
      topAlbums: top(albums),
      sources: [...sources.entries()].sort((a, b) => b[1] - a[1]),
      hours,
      weekdays,
    }
  }, [all, period])

  if (!stats) return null
  const peakHour = stats.hours.indexOf(Math.max(...stats.hours))
  const peakDay = stats.weekdays.indexOf(Math.max(...stats.weekdays))
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const dayNamesLong = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']

  return (
    <div className="stats">
      <div className="chips">
        {PERIODS.map(([p, label]) => (
          <button key={p} className={cls('chip', period === p && 'on')} onClick={() => setPeriod(p)}>
            {label}
          </button>
        ))}
      </div>

      {!stats.plays ? (
        <Empty icon={<ClockIcon size={30} />} title="Not enough listening yet">
          <p>Play some music and your top songs, artists and albums for this period show up here.</p>
        </Empty>
      ) : (
        <>
          <div className="stat-cards">
            <Stat value={fmtListened(stats.seconds)} label="listened" />
            <Stat value={stats.plays.toLocaleString()} label="plays" />
            <Stat value={stats.songs.toLocaleString()} label="different songs" />
            <Stat value={stats.artists.toLocaleString()} label="artists" />
            <Stat value={`${String(peakHour).padStart(2, '0')}:00`} label={`your peak hour · ${dayNamesLong[peakDay]} most`} />
          </div>

          <div className="stats-grid">
            <TopList title="Top tracks" items={stats.topTracks} playable />
            <TopList title="Top artists" items={stats.topArtists} round />
            <TopList title="Top albums" items={stats.topAlbums} />
            <div className="stats-card">
              <h3>Where you listened</h3>
              {stats.sources.map(([src, sec]) => (
                <div key={src} className="source-share">
                  <SourceBadge source={src} size={16} />
                  <span className="share-name">{SOURCES[src].name}</span>
                  <span className="share-bar">
                    <span style={{ width: `${(sec / stats.seconds) * 100}%`, background: SOURCES[src].color }} />
                  </span>
                  <span className="share-value">{Math.round((sec / stats.seconds) * 100)}%</span>
                </div>
              ))}
              <h3 className="spaced">When you listen</h3>
              <BarChart values={stats.hours} labels={stats.hours.map((_, h) => (h % 6 === 0 ? `${h}:00` : ''))} />
              <BarChart values={stats.weekdays} labels={dayNames} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const Stat = ({ value, label }: { value: string; label: string }) => (
  <div className="stat-card">
    <b>{value}</b>
    <span>{label}</span>
  </div>
)

function TopList({ title, items, playable, round }: { title: string; items: Tally[]; playable?: boolean; round?: boolean }) {
  const nav = useNav()
  return (
    <div className="stats-card">
      <h3>{title}</h3>
      {!items.length && <div className="hint">Nothing yet</div>}
      {items.map((t, i) => (
        <div
          key={t.key + i}
          className={cls('top-row', playable && 'playable')}
          onDoubleClick={() => (t.track ? playTracks([t.track]) : nav.go({ kind: 'search', q: t.label }))}
          onClick={() => !t.track && nav.go({ kind: 'search', q: t.label })}
          title={t.track ? 'Double-click to play' : `Search ${t.label}`}
        >
          <span className="rank">{i + 1}</span>
          <Artwork src={t.artwork} size={40} className={round ? 'round' : undefined} />
          <div className="quick-text">
            <div className="t">{t.label}</div>
            {t.sub && <div className="a">{t.sub}</div>}
          </div>
          <span className="top-count">
            {plural(t.plays, 'play')}
            <small>{fmtListened(t.seconds)}</small>
          </span>
        </div>
      ))}
    </div>
  )
}

function BarChart({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(...values, 1)
  return (
    <div className="bar-chart">
      {values.map((v, i) => (
        <div key={i} className="bar-col" title={`${labels[i] || i}: ${fmtListened(v)}`}>
          <span style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
          <small>{labels[i]}</small>
        </div>
      ))}
    </div>
  )
}

export function clearListenHistory() {
  return window.api.history.clear().then(() => {
    listenLogStore.set((s) => ({ version: s.version + 1 }))
    toast('Listening history cleared')
  })
}
