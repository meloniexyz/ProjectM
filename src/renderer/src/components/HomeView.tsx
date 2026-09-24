import { useMemo, useState } from 'react'
import type { RemotePlaylist, SourceId, Track } from '../../../shared/types'
import { ACCOUNT_SOURCES, accountStore, likedSongs, remotePlaylists, topSongs } from '../lib/accounts'
import { cls, plural } from '../lib/format'
import { historyStore, mostPlayed, recentTracks } from '../lib/history'
import { lib, useAlbums } from '../lib/library'
import { useNav } from '../lib/nav'
import { playTracks, usePlayer } from '../lib/player'
import { SOURCES, useConnections } from '../lib/sources'
import { useStore } from '../lib/store'
import { openMenu } from '../lib/ui'
import { LoadError, RemotePlaylistCard, useAsync } from './AccountViews'
import { Artwork, Bars, PlaylistArt } from './common'
import { PlayIcon, SourceBadge } from './Icons'
import { trackMenu } from './trackMenu'

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function HomeView() {
  useConnections()
  const entries = useStore(historyStore, (s) => s.entries)
  const statuses = useStore(accountStore, (s) => s.accounts)
  const accounts = ACCOUNT_SOURCES.map((s) => ({ source: s, status: statuses[s] }))
  const connected = accounts.filter((a) => a.status?.connected).map((a) => a.source)
  const missing = accounts.filter((a) => a.status && !a.status.connected).map((a) => a.source)
  const recent = useMemo(() => recentTracks(entries, 8), [entries])

  return (
    <div className="home">
      <header className="home-head">
        <h1>{greeting()}</h1>
        <div className="home-sources">
          {(['local', ...connected] as SourceId[]).map((s) => (
            <span key={s} className="source-pill">
              <SourceBadge source={s} size={14} /> {SOURCES[s].name}
            </span>
          ))}
        </div>
      </header>

      {recent.length > 0 && (
        <section className="home-section">
          <h2 className="home-title">Jump back in</h2>
          <div className="quick-grid">
            {recent.map((t, i) => (
              <QuickTile key={t.uid} track={t} list={recent} index={i} />
            ))}
          </div>
        </section>
      )}

      <TopSongs connected={connected} />
      <AllPlaylists connected={connected} />
      <LocalAlbums />

      {missing.length > 0 && (
        <section className="home-section">
          <div className="connect-strip">
            <div>
              <h3>Bring in more of your music</h3>
              <p>Connect an account to see its liked songs and playlists here.</p>
            </div>
            <ConnectButtons sources={missing} />
          </div>
        </section>
      )}
    </div>
  )
}

function ConnectButtons({ sources }: { sources: SourceId[] }) {
  const nav = useNav()
  return (
    <div className="row wrap">
      {sources.map((s) => (
        <button key={s} className="btn" onClick={() => nav.go({ kind: 'source', source: s })}>
          <SourceBadge source={s} size={16} /> Connect {SOURCES[s].name}
        </button>
      ))}
    </div>
  )
}

/** Compact "recently played" tile: cover on the left, title, play on hover. */
function QuickTile({ track, list, index }: { track: Track; list: Track[]; index: number }) {
  const nav = useNav()
  const active = usePlayer((s) => s.queue[s.index]?.track.uid === track.uid)
  const playing = usePlayer((s) => s.playing)
  return (
    <div
      className={cls('quick-tile', active && 'active')}
      onClick={() => playTracks(list, index)}
      onContextMenu={(e) => openMenu(e, trackMenu([track], nav))}
    >
      <Artwork src={track.artwork} size={56} />
      <div className="quick-text">
        <div className="t">{track.title}</div>
        <div className="a">{track.artist}</div>
      </div>
      {active ? <Bars paused={!playing} /> : <SourceBadge source={track.source} size={14} />}
      <span className="quick-play">
        <PlayIcon size={16} />
      </span>
    </div>
  )
}

// ---------- top songs, one tab per platform ----------

type TopTab = 'most' | SourceId

function TopSongs({ connected }: { connected: SourceId[] }) {
  const entries = useStore(historyStore, (s) => s.entries)
  const most = useMemo(() => mostPlayed(entries, 12), [entries])
  const tabs: TopTab[] = [...(most.length ? (['most'] as TopTab[]) : []), ...connected]
  const [picked, setPicked] = useState<TopTab | null>(null)
  const tab = picked && tabs.includes(picked) ? picked : tabs[0]
  if (!tab) return null

  return (
    <section className="home-section">
      <div className="home-title-row">
        <h2 className="home-title">Top songs</h2>
        <div className="chips">
          {tabs.map((t) => (
            <button key={t} className={cls('chip', tab === t && 'on')} onClick={() => setPicked(t)}>
              {t === 'most' ? (
                'Most played here'
              ) : (
                <>
                  <SourceBadge source={t} size={14} /> {SOURCES[t].name}
                </>
              )}
            </button>
          ))}
        </div>
      </div>
      {tab === 'most' ? (
        <TrackTiles tracks={most.map((e) => e.track)} counts={most.map((e) => e.count)} />
      ) : (
        <SourceTop key={tab} source={tab} />
      )}
    </section>
  )
}

function SourceTop({ source }: { source: SourceId }) {
  // Spotify has real "top tracks"; the others use your most recent likes
  const { data, error, loading, reload } = useAsync(
    () => (source === 'spotify' ? topSongs(source).catch(() => likedSongs(source)) : likedSongs(source)),
    [source],
  )
  if (loading) return <TileSkeleton />
  if (error) return <LoadError error={error} onRetry={reload} />
  if (!data?.length) return <div className="home-empty">Nothing here yet.</div>
  return <TrackTiles tracks={data.slice(0, 12)} />
}

function TrackTiles({ tracks, counts }: { tracks: Track[]; counts?: number[] }) {
  const nav = useNav()
  const currentUid = usePlayer((s) => s.queue[s.index]?.track.uid)
  const playing = usePlayer((s) => s.playing)
  return (
    <div className="track-tiles">
      {tracks.map((t, i) => {
        const active = t.uid === currentUid
        return (
          <div
            key={t.uid}
            className={cls('track-tile', active && 'active')}
            onClick={() => playTracks(tracks, i)}
            onContextMenu={(e) => openMenu(e, trackMenu([t], nav))}
          >
            <span className="rank">{active ? <Bars paused={!playing} /> : i + 1}</span>
            <Artwork src={t.artwork} size={44} />
            <div className="quick-text">
              <div className="t">{t.title}</div>
              <div className="a">
                {t.artist}
                {counts ? ` · ${plural(counts[i], 'play')}` : ''}
              </div>
            </div>
            <SourceBadge source={t.source} size={14} />
          </div>
        )
      })}
    </div>
  )
}

const TileSkeleton = () => (
  <div className="track-tiles">
    {Array.from({ length: 6 }, (_, i) => (
      <div key={i} className="track-tile skeleton">
        <span className="rank" />
        <div className="art" style={{ width: 44, height: 44 }} />
        <div className="quick-text">
          <div className="bar" />
          <div className="bar short" />
        </div>
      </div>
    ))}
  </div>
)

// ---------- playlists from everywhere ----------

function AllPlaylists({ connected }: { connected: SourceId[] }) {
  const nav = useNav()
  const own = useStore(lib, (s) => s.playlists)
  const [filter, setFilter] = useState<'all' | 'projectm' | SourceId>('all')
  const key = connected.join(',')
  const remote = useAsync(
    () =>
      Promise.all(
        connected.map((s) =>
          remotePlaylists(s).then(
            (list) => list.map((playlist) => ({ source: s, playlist })),
            () => [] as { source: SourceId; playlist: RemotePlaylist }[],
          ),
        ),
      ).then((lists) => lists.flat()),
    [key],
  )

  const cards = [
    ...own.map((p) => ({ group: 'projectm' as const, key: `pm:${p.id}`, p })),
    ...(remote.data ?? []).map((r) => ({ group: r.source, key: `${r.source}:${r.playlist.id}`, r })),
  ]
  const groups = ['projectm', ...connected].filter((g) => cards.some((c) => c.group === g))
  const shown = cards.filter((c) => filter === 'all' || c.group === filter)
  if (!cards.length && !remote.loading) return null

  return (
    <section className="home-section">
      <div className="home-title-row">
        <h2 className="home-title">Your playlists</h2>
        {groups.length > 1 && (
          <div className="chips">
            <button className={cls('chip', filter === 'all' && 'on')} onClick={() => setFilter('all')}>
              All
            </button>
            {groups.map((g) => (
              <button key={g} className={cls('chip', filter === g && 'on')} onClick={() => setFilter(g as SourceId)}>
                {g === 'projectm' ? (
                  'ProjectM'
                ) : (
                  <>
                    <SourceBadge source={g as SourceId} size={14} /> {SOURCES[g as SourceId].name}
                  </>
                )}
              </button>
            ))}
          </div>
        )}
        {remote.loading && <span className="home-loading">Loading playlists…</span>}
      </div>
      <div className="rail">
        {shown.map((c) =>
          'p' in c && c.p ? (
            <div key={c.key} className="card" onClick={() => nav.go({ kind: 'playlist', id: c.p.id })}>
              <div className="card-art">
                <PlaylistArt playlist={c.p} className="fill" />
                <span className="card-source pm">PM</span>
                <button
                  className="card-play"
                  title="Play"
                  disabled={!c.p.tracks.length}
                  onClick={(e) => {
                    e.stopPropagation()
                    playTracks(c.p.tracks)
                  }}
                >
                  <PlayIcon size={20} />
                </button>
              </div>
              <div className="name">{c.p.name}</div>
              <div className="sub">ProjectM · {plural(c.p.tracks.length, 'song')}</div>
            </div>
          ) : 'r' in c && c.r ? (
            <RemotePlaylistCard key={c.key} source={c.r.source} playlist={c.r.playlist} />
          ) : null,
        )}
      </div>
    </section>
  )
}

function LocalAlbums() {
  const nav = useNav()
  const albums = useAlbums()
  const tracks = useStore(lib, (s) => s.tracks)
  // most recently added files first
  const recent = useMemo(() => {
    const newest = new Map<string, number>()
    for (const t of tracks as (Track & { mtime?: number })[]) {
      newest.set(t.album + t.artist, Math.max(newest.get(t.album + t.artist) ?? 0, t.mtime ?? 0))
    }
    return albums
      .slice()
      .sort((a, b) => (newest.get(b.name + b.artist) ?? 0) - (newest.get(a.name + a.artist) ?? 0))
      .slice(0, 12)
  }, [albums, tracks])
  if (!recent.length) return null
  return (
    <section className="home-section">
      <div className="home-title-row">
        <h2 className="home-title">Albums in your library</h2>
        <button className="link-btn" onClick={() => nav.go({ kind: 'albums' })}>
          Show all
        </button>
      </div>
      <div className="rail">
        {recent.map((a) => (
          <div key={a.key} className="card" onClick={() => nav.go({ kind: 'album', key: a.key })}>
            <div className="card-art">
              <Artwork src={a.artwork} className="fill" />
              <button
                className="card-play"
                title="Play"
                onClick={(e) => {
                  e.stopPropagation()
                  playTracks(a.tracks)
                }}
              >
                <PlayIcon size={20} />
              </button>
            </div>
            <div className="name">{a.name}</div>
            <div className="sub">{a.artist}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
