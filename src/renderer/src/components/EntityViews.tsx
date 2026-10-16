import { useEffect, useState } from 'react'
import type { Entity, EntityKind, SourceId } from '../../../shared/types'
import { cls, fmtTotal, plural } from '../lib/format'
import { createPlaylist } from '../lib/library'
import { useNav } from '../lib/nav'
import { playTracks } from '../lib/player'
import { cleanError, SOURCES } from '../lib/sources'
import { toast } from '../lib/ui'
import { useAsync } from './AccountViews'
import { Artwork, Empty, Hero, PlayActions } from './common'
import { PlayIcon, PlusIcon, RefreshIcon, SearchIcon, SourceBadge } from './Icons'
import { TrackList } from './TrackList'

/** Search tabs besides Songs. Spotify has no profile search; SoundCloud's artists are its profiles. */
export const ENTITY_TABS: { kind: EntityKind; label: string; sources: SourceId[] }[] = [
  { kind: 'artist', label: 'Artists', sources: ['spotify', 'youtube'] },
  { kind: 'playlist', label: 'Playlists', sources: ['spotify', 'youtube', 'soundcloud'] },
  { kind: 'profile', label: 'Profiles', sources: ['soundcloud', 'youtube'] },
]

const KIND_NAME: Record<EntityKind, string> = { artist: 'artists', playlist: 'playlists', profile: 'profiles' }

/** Artists, playlists or profiles for a search, one section per platform. */
export function EntityResults({ query, kind, sources }: { query: string; kind: EntityKind; sources: SourceId[] }) {
  const tab = ENTITY_TABS.find((t) => t.kind === kind)!
  const shown = sources.filter((s) => tab.sources.includes(s))
  const [results, setResults] = useState<Partial<Record<SourceId, { loading: boolean; items: Entity[]; error?: string }>>>({})
  const [retry, setRetry] = useState(0)
  const key = shown.join(',')

  useEffect(() => {
    setResults({})
    if (!query) return
    let live = true
    for (const s of shown) {
      setResults((r) => ({ ...r, [s]: { loading: true, items: [] } }))
      window.api.sources.entities(s, query, kind).then(
        (items) => live && setResults((r) => ({ ...r, [s]: { loading: false, items } })),
        (err) => live && setResults((r) => ({ ...r, [s]: { loading: false, items: [], error: cleanError(err).message } })),
      )
    }
    return () => {
      live = false
    }
  }, [query, kind, key, retry])

  if (!shown.length)
    return (
      <Empty icon={<SearchIcon size={30} />} title={`No ${KIND_NAME[kind]} here`}>
        <p>
          {kind === 'profile'
            ? "Spotify doesn't let apps search people's profiles. Try SoundCloud or YouTube Music."
            : kind === 'artist'
              ? "On SoundCloud, artists are under Profiles."
              : 'Connect a platform to search its playlists.'}
        </p>
      </Empty>
    )
  const empty = shown.every((s) => results[s] && !results[s]!.loading && !results[s]!.items.length && !results[s]!.error)
  if (empty)
    return (
      <Empty icon={<SearchIcon size={30} />} title={`No ${KIND_NAME[kind]} for "${query}"`}>
        <p>Check the spelling, or try fewer words.</p>
      </Empty>
    )
  return (
    <>
      {shown.map((s) => {
        const r = results[s]
        if (!r || (!r.loading && !r.items.length && !r.error)) return null
        return (
          <section key={s} className="results">
            <div className="section-title with-actions">
              <SourceBadge source={s} size={22} />
              <h2>{SOURCES[s].name}</h2>
              {r.loading && (
                <span className="row">
                  <RefreshIcon size={13} className="spin" /> Searching…
                </span>
              )}
            </div>
            {r.error ? (
              <p className="result-error">
                {r.error}{' '}
                <button className="link-btn inline" onClick={() => setRetry((n) => n + 1)}>
                  Try again
                </button>
              </p>
            ) : (
              <div className="grid">
                {r.items.map((e) => (
                  <EntityCard key={`${e.source}:${e.id}`} entity={e} />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </>
  )
}

export function EntityCard({ entity: e }: { entity: Entity }) {
  const nav = useNav()
  const round = e.kind !== 'playlist'
  return (
    <div className="card" onClick={() => nav.go({ kind: 'entity', entity: e })}>
      <div className={cls('card-art', round && 'round')}>
        <Artwork src={e.artwork} className="fill" px={300} />
        <span className="card-source">
          <SourceBadge source={e.source} size={18} />
        </span>
        <button
          className="card-play"
          title="Play"
          onClick={(ev) => {
            ev.stopPropagation()
            window.api.sources.entityPage(e).then(
              (p) => (p.tracks.length ? playTracks(p.tracks) : toast('Nothing to play here')),
              (err) => toast(cleanError(err).message),
            )
          }}
        >
          <PlayIcon size={20} />
        </button>
      </div>
      <div className="name" title={e.name}>
        {e.name}
      </div>
      <div className="sub">{e.subtitle ?? SOURCES[e.source].name}</div>
    </div>
  )
}

/** An artist, playlist or profile opened from search: its songs and (for people) their playlists. */
export function EntityView({ entity: e }: { entity: Entity }) {
  const { data, error, loading, reload } = useAsync(() => window.api.sources.entityPage(e), [e.source, e.kind, e.id])
  const tracks = data?.tracks ?? []
  const kicker = `${SOURCES[e.source].name} ${e.kind === 'artist' ? 'artist' : e.kind === 'playlist' ? 'playlist' : e.source === 'youtube' ? 'channel' : 'profile'}`
  return (
    <>
      <Hero
        kicker={kicker}
        title={e.name}
        color={SOURCES[e.source].color}
        meta={loading ? 'Loading…' : tracks.length ? `${plural(tracks.length, 'song')} · ${fmtTotal(tracks.reduce((a, t) => a + (t.duration || 0), 0))}` : e.subtitle}
        art={<Artwork src={e.artwork ?? tracks[0]?.artwork} className={cls('hero-art', e.kind !== 'playlist' && 'round')} px={640} />}
      />
      <PlayActions tracks={tracks}>
        {e.kind === 'playlist' && (
          <button className="btn ghost" disabled={!tracks.length} onClick={() => createPlaylist(tracks, e.name)}>
            <PlusIcon size={15} /> Save to my playlists
          </button>
        )}
      </PlayActions>
      {loading ? (
        <Empty icon={<RefreshIcon size={26} className="spin" />} title="Loading…" />
      ) : error ? (
        <Empty icon={<SearchIcon size={26} />} title="Couldn't open this">
          <p>{e.source === 'spotify' && /403|forbidden/i.test(error) ? "Spotify doesn't let apps read this (it's probably made by Spotify)." : error}</p>
          <button className="btn small" onClick={reload}>
            Try again
          </button>
        </Empty>
      ) : (
        <>
          {tracks.length > 0 && <TrackList tracks={tracks} />}
          {(data?.playlists.length ?? 0) > 0 && (
            <section className="results">
              <h2 className="section-title">{e.kind === 'artist' ? 'Albums and playlists' : 'Playlists'}</h2>
              <div className="grid">
                {data!.playlists.map((p) => (
                  <EntityCard key={`${p.source}:${p.id}`} entity={p} />
                ))}
              </div>
            </section>
          )}
          {!tracks.length && !data?.playlists.length && <Empty icon={<SearchIcon size={26} />} title="Nothing here yet" />}
        </>
      )}
    </>
  )
}
