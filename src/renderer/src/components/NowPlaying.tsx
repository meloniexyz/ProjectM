import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Lyrics, Track } from '../../../shared/types'
import { cls } from '../lib/format'
import { albumKey } from '../lib/library'
import { useNav } from '../lib/nav'
import { jump, seek, usePlayer } from '../lib/player'
import { SOURCES } from '../lib/sources'
import { Artwork } from './common'
import { SourceBadge, XIcon } from './Icons'

/** Spotify-style right panel: big cover, song info, synced lyrics and what's next. */
export function NowPlaying({ onClose, onOpenQueue }: { onClose: () => void; onOpenQueue: () => void }) {
  const nav = useNav()
  const track = usePlayer((s) => s.queue[s.index]?.track)
  const via = usePlayer((s) => s.via)
  const nextItem = usePlayer((s) => s.queue[s.index + 1])
  const index = usePlayer((s) => s.index)

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
            {via && (
              <div className="np-via">
                <SourceBadge source={via} size={13} /> Playing from {SOURCES[via].name} because the Spotify app isn't
                available on this PC
              </div>
            )}
          </div>

          <LyricsCard track={track} />

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

const lyricsCache = new Map<string, Promise<Lyrics | null>>()
function fetchLyrics(t: Track) {
  let hit = lyricsCache.get(t.uid)
  if (!hit) {
    hit = window.api.lyrics({ title: t.title, artist: t.artist, album: t.album, duration: t.duration }).catch(() => null)
    lyricsCache.set(t.uid, hit)
  }
  return hit
}

function LyricsCard({ track }: { track: Track }) {
  const [state, setState] = useState<{ uid: string; lyrics: Lyrics | null; loading: boolean }>({
    uid: track.uid,
    lyrics: null,
    loading: true,
  })
  const [expanded, setExpanded] = useState(false)
  const position = usePlayer((s) => s.position)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    setState({ uid: track.uid, lyrics: null, loading: true })
    fetchLyrics(track).then((lyrics) => live && setState({ uid: track.uid, lyrics, loading: false }))
    return () => {
      live = false
    }
  }, [track])

  const synced = state.lyrics?.synced ?? null
  // index of the line being sung right now
  const current = useMemo(() => {
    if (!synced) return -1
    let lo = -1
    for (let i = 0; i < synced.length; i++) {
      if (synced[i].time <= position + 0.15) lo = i
      else break
    }
    return lo
  }, [synced, position])

  // keep the current line in view (scrolls the card, not the page)
  useEffect(() => {
    const box = boxRef.current
    const line = box?.querySelector<HTMLElement>(`[data-line="${current}"]`)
    if (!box || !line) return
    box.scrollTo({ top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2, behavior: 'smooth' })
  }, [current])

  let body: ReactNode
  if (state.loading) body = <div className="lyrics-empty">Looking for lyrics…</div>
  else if (!state.lyrics) body = <div className="lyrics-empty">No lyrics found for this song.</div>
  else if (state.lyrics.instrumental) body = <div className="lyrics-empty">Instrumental ♪</div>
  else if (synced)
    body = synced.map((l, i) => (
      <p
        key={i}
        data-line={i}
        className={cls('lyric', i === current && 'on', i < current && 'past')}
        onClick={() => seek(l.time)}
      >
        {l.text || '♪'}
      </p>
    ))
  else
    body = state.lyrics.plain!.split('\n').map((l, i) => (
      <p key={i} className="lyric plain">
        {l || ' '}
      </p>
    ))

  return (
    <div className={cls('np-card lyrics-card', expanded && 'expanded')}>
      <div className="np-card-head">
        <span>Lyrics{synced ? '' : state.lyrics?.plain ? ' (not synced)' : ''}</span>
        {state.lyrics && !state.lyrics.instrumental && (
          <button className="link-btn" onClick={() => setExpanded((e) => !e)}>
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
      <div className="lyrics-box" ref={boxRef}>
        {body}
      </div>
      <div className="lyrics-credit">Lyrics from LRCLIB</div>
    </div>
  )
}
