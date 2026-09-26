import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Lyrics, SongInfo, Track } from '../../../shared/types'
import { cls } from '../lib/format'
import { albumKey } from '../lib/library'
import { useNav } from '../lib/nav'
import { jump, seek, usePlayer } from '../lib/player'
import { SOURCES } from '../lib/sources'
import { useSettings } from '../lib/settings'
import { Artwork } from './common'
import { SourceBadge, XIcon } from './Icons'

/** Spotify-style right panel: big cover, song info, synced lyrics and what's next. */
export function NowPlaying({ onClose, onOpenQueue }: { onClose: () => void; onOpenQueue: () => void }) {
  const nav = useNav()
  const track = usePlayer((s) => s.queue[s.index]?.track)
  const via = usePlayer((s) => s.via)
  const quality = usePlayer((s) => s.quality)
  const nextItem = usePlayer((s) => s.queue[s.index + 1])
  const index = usePlayer((s) => s.index)
  const { showLyrics } = useSettings()

  return (
    <aside className="queue now-playing">
      <div className="queue-head">
        <h3>Now Playing</h3>
        <button className="icon-btn" title="Close" onClick={onClose}>
          <XIcon size={18} />
        </button>
      </div>
      {!track ? (
        <div className="q-empty">Nothing playing. Pick a song and it shows up here with its lyrics.</div>
      ) : (
        <div className="np-body">
          <Artwork src={track.artwork} className="np-cover fill" px={640} />
          <div className="np-info">
            <div className="np-title-row">
              <div className="np-title-text">
                <h2
                  className="link"
                  title={track.title}
                  onClick={() =>
                    nav.go(
                      track.source === 'local'
                        ? { kind: 'album', key: albumKey(track) }
                        : { kind: 'search', q: `${track.artist} ${track.album}` },
                    )
                  }
                >
                  {track.title}
                </h2>
                <div className="a">
                  <span className="link" onClick={() => nav.go({ kind: 'search', q: track.artist })}>
                    {track.artist}
                  </span>
                </div>
              </div>
              <SourceBadge source={track.source} size={22} />
            </div>
            {quality && <div className="quality-chip">{quality}</div>}
            {via && (
              <div className="np-via">
                <SourceBadge source={via} size={13} /> Playing from {SOURCES[via].name} because the Spotify app isn't
                available on this PC
              </div>
            )}
          </div>

          {showLyrics && <LyricsCard track={track} />}
          <SongInfoCard track={track} />

          {nextItem && (
            <div className="np-card">
              <div className="np-card-head">
                <span>Next in queue</span>
                <button className="link-btn" onClick={onOpenQueue}>
                  Open queue
                </button>
              </div>
              <div className="q-item" onClick={() => jump(index + 1)}>
                <Artwork src={nextItem.track.artwork} size={44} />
                <div className="q-text">
                  <div className="t">{nextItem.track.title}</div>
                  <div className="a">{nextItem.track.artist}</div>
                </div>
                <SourceBadge source={nextItem.track.source} size={14} />
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

// ---------- lyrics ----------

const lyricsCache = new Map<string, Promise<Lyrics[]>>()
function fetchLyrics(t: Track) {
  let hit = lyricsCache.get(t.uid)
  if (!hit) {
    hit = window.api.lyrics({ title: t.title, artist: t.artist, album: t.album, duration: t.duration }).catch(() => [])
    lyricsCache.set(t.uid, hit)
  }
  return hit
}

/** Per-song choices the user made: which lyric version, and how far to shift its timing. */
type LyricsPrefs = Record<string, { id?: number; offset?: number }>
const PREFS_KEY = 'projectm.lyricsPrefs'
function readPrefs(): LyricsPrefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
  } catch {
    return {}
  }
}
function writePref(uid: string, patch: { id?: number; offset?: number }) {
  const all = readPrefs()
  all[uid] = { ...all[uid], ...patch }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(all))
  } catch {
    // not critical
  }
}

function LyricsCard({ track }: { track: Track }) {
  const [options, setOptions] = useState<Lyrics[] | null>(null)
  const [picked, setPicked] = useState<number | null>(null) // version the user switched to
  const [offset, setOffset] = useState(0) // seconds added to the lyrics' timing
  const [expanded, setExpanded] = useState(false)
  const position = usePlayer((s) => s.position)
  // length of the audio actually playing (e.g. the YouTube version of a Spotify song)
  const playingDuration = usePlayer((s) => s.duration)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    setOptions(null)
    setPicked(null)
    setOffset(readPrefs()[track.uid]?.offset ?? 0)
    fetchLyrics(track).then((found) => live && setOptions(found))
    return () => {
      live = false
    }
  }, [track])

  // Which version: the one you picked, else your earlier pick for this song, else the one whose
  // length matches the audio playing right now (re-evaluated once the real length is known).
  const choice = useMemo(() => {
    if (!options?.length) return null
    if (picked !== null) return picked
    const saved = readPrefs()[track.uid]?.id
    const savedIdx = saved != null ? options.findIndex((o) => o.id === saved) : -1
    if (savedIdx >= 0) return savedIdx
    const target = playingDuration || track.duration
    const indexed = options.map((o, i) => ({ o, i }))
    const synced = indexed.filter(({ o }) => o.synced)
    const pool = synced.length ? synced : indexed
    return pool.reduce((best, cur) =>
      Math.abs((cur.o.duration ?? target) - target) < Math.abs((best.o.duration ?? target) - target) ? cur : best,
    ).i
  }, [options, picked, playingDuration, track])

  const lyrics = options && choice !== null ? options[choice] : null
  const synced = lyrics?.synced ?? null
  const at = position + offset
  const current = useMemo(() => {
    if (!synced) return -1
    let lo = -1
    for (let i = 0; i < synced.length; i++) {
      if (synced[i].time <= at + 0.15) lo = i
      else break
    }
    return lo
  }, [synced, at])

  // keep the current line in view (scrolls the card, not the page)
  useEffect(() => {
    const box = boxRef.current
    const line = box?.querySelector<HTMLElement>(`[data-line="${current}"]`)
    if (!box || !line) return
    box.scrollTo({ top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2, behavior: 'smooth' })
  }, [current])

  const nudge = (delta: number) => {
    const next = Math.round((offset + delta) * 10) / 10
    setOffset(next)
    writePref(track.uid, { offset: next })
  }
  const nextVersion = () => {
    if (!options || options.length < 2 || choice === null) return
    const idx = (choice + 1) % options.length
    setPicked(idx)
    writePref(track.uid, { id: options[idx].id })
  }

  const lengthGap = lyrics?.duration && playingDuration ? Math.round(Math.abs(lyrics.duration - playingDuration)) : 0

  let body: ReactNode
  if (!options) body = <div className="lyrics-empty">Looking for lyrics…</div>
  else if (!lyrics) body = <div className="lyrics-empty">No lyrics found for this song.</div>
  else if (lyrics.instrumental) body = <div className="lyrics-empty">Instrumental ♪</div>
  else if (synced) {
    const isGap = (t: string) => !t.trim() || /^[♪♫s]+$/.test(t)
    const intro = synced.length > 0 && synced[0].time > 3
    body = (
      <>
        {intro && (
          <p data-line={-1} className={cls('lyric gap', current === -1 && 'on')} onClick={() => seek(0)}>
            <Dots />
          </p>
        )}
        {synced.map((l, i) => {
          const on = i === current
          if (isGap(l.text)) {
            return (
              <p key={i} data-line={i} className={cls('lyric gap', on && 'on', i < current && 'past')} onClick={() => seek(Math.max(0, l.time - offset))}>
                <Dots />
              </p>
            )
          }
          return (
            <p
              key={i}
              data-line={i}
              className={cls('lyric', on && 'on', i < current && 'past')}
              // clicking a line jumps the song to it (respecting the sync shift)
              onClick={() => seek(Math.max(0, l.time - offset))}
            >
              {l.text}
            </p>
          )
        })}
      </>
    )
  }
  else
    body = lyrics.plain!.split('\n').map((l, i) => (
      <p key={i} className="lyric plain">
        {l || ' '}
      </p>
    ))

  return (
    <div className={cls('np-card lyrics-card', expanded && 'expanded')}>
      <div className="np-card-head">
        <span>Lyrics{synced ? '' : lyrics?.plain ? ' (not synced)' : ''}</span>
        {lyrics && !lyrics.instrumental && (
          <button className="link-btn" onClick={() => setExpanded((e) => !e)}>
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
      <div className="lyrics-box" ref={boxRef}>
        {body}
      </div>
      {lyrics && (synced || (options?.length ?? 0) > 1) && (
        <div className="lyrics-tools">
          {synced && (
            <div className="sync-nudge" title="If the highlighted line is ahead of or behind the singing">
              <button className="chip-btn" onClick={() => nudge(-0.5)} title="Lyrics run ahead of the singing: delay them">
                −0.5s
              </button>
              <span
                className={cls('sync-value', offset !== 0 && 'set')}
                title="Double-click to reset"
                onDoubleClick={() => nudge(-offset)}
              >
                {offset === 0 ? 'In sync' : `${offset > 0 ? '+' : ''}${offset.toFixed(1)}s`}
              </span>
              <button className="chip-btn" onClick={() => nudge(0.5)} title="Lyrics lag behind the singing: advance them">
                +0.5s
              </button>
            </div>
          )}
          {options && options.length > 1 && (
            <button className="chip-btn" onClick={nextVersion} title="Try lyrics timed to a different version of this song">
              Other version {(choice ?? 0) + 1}/{options.length}
            </button>
          )}
        </div>
      )}
      {synced && lengthGap >= 3 && (
        <div className="lyrics-hint">
          These lyrics are timed to a version {lengthGap}s different in length from what is playing. If they drift, try
          another version or nudge the timing.
        </div>
      )}
      <div className="lyrics-credit">Lyrics from LRCLIB{lyrics?.label ? ` · ${lyrics.label}` : ''}</div>
    </div>
  )
}

// ---------- song info (MusicBrainz) ----------

const infoCache = new Map<string, Promise<SongInfo | null>>()
function fetchInfo(t: Track) {
  let hit = infoCache.get(t.uid)
  if (!hit) {
    hit = window.api.songInfo({ title: t.title, artist: t.artist, duration: t.duration }).catch(() => null)
    infoCache.set(t.uid, hit)
  }
  return hit
}

/** "2013-05-17" -> "17 May 2013", "2013-05" -> "May 2013", "2013" -> "2013" */
function fmtDate(d?: string) {
  if (!d) return ''
  const [y, m, day] = d.split('-').map(Number)
  if (!m) return String(y)
  const date = new Date(y, m - 1, day || 1)
  return date.toLocaleDateString(undefined, day ? { day: 'numeric', month: 'long', year: 'numeric' } : { month: 'long', year: 'numeric' })
}

function SongInfoCard({ track }: { track: Track }) {
  const [state, setState] = useState<{ uid: string; info: SongInfo | null; loading: boolean }>({ uid: track.uid, info: null, loading: true })
  const [all, setAll] = useState(false)

  useEffect(() => {
    let live = true
    setState({ uid: track.uid, info: null, loading: true })
    setAll(false)
    // local files and SoundCloud uploads are often unreleased: still worth a try
    fetchInfo(track).then((info) => live && setState({ uid: track.uid, info, loading: false }))
    return () => {
      live = false
    }
  }, [track])

  const { info, loading } = state
  if (loading) {
    return (
      <div className="np-card">
        <div className="np-card-head">
          <span>About this song</span>
        </div>
        <div className="lyrics-empty">Looking it up…</div>
      </div>
    )
  }
  if (!info) return null

  const credits = all ? info.credits : info.credits.slice(0, 5)
  return (
    <div className="np-card song-info">
      <div className="np-card-head">
        <span>About this song</span>
        <button className="link-btn" onClick={() => window.open(info.url)}>
          MusicBrainz ↗
        </button>
      </div>
      {info.released && (
        <InfoRow label="Released">
          {fmtDate(info.released)}
          {info.album && (
            <>
              {' · '}
              <i>{info.album}</i>
              {info.albumType && info.albumType !== 'Album' ? ` (${info.albumType.toLowerCase()})` : ''}
            </>
          )}
        </InfoRow>
      )}
      {info.recordedAt.map((r, i) => (
        <InfoRow key={i} label={r.what}>
          {r.place}
          {r.area ? `, ${r.area}` : ''}
          {r.date && (
            <>
              {' · '}
              {fmtDate(r.date)}
              {r.until ? ` – ${fmtDate(r.until)}` : ''}
            </>
          )}
        </InfoRow>
      ))}
      {credits.map((c) => (
        <InfoRow key={c.role} label={c.role}>
          {c.names.join(', ')}
        </InfoRow>
      ))}
      {info.credits.length > 5 && (
        <button className="link-btn" onClick={() => setAll((a) => !a)}>
          {all ? 'Fewer credits' : `All credits (${info.credits.length})`}
        </button>
      )}
      {!info.recordedAt.length && !info.credits.length && (
        <div className="lyrics-hint">No studio or credit details on MusicBrainz for this one yet.</div>
      )}
    </div>
  )
}

const InfoRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="info-row">
    <span className="info-label">{label}</span>
    <span className="info-value">{children}</span>
  </div>
)

/** Instrumental break / intro marker; pulses while it's the current "line". */
const Dots = () => (
  <span className="lyric-dots" aria-label="instrumental">
    <i />
    <i />
    <i />
  </span>
)
