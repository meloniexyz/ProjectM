import { useEffect, useState } from 'react'
import type { SpotifyPlaylist, Track } from '../../../shared/types'
import { cls, fmtTotal, plural } from '../lib/format'
import { createPlaylist } from '../lib/library'
import { useNav } from '../lib/nav'
import { playTracks } from '../lib/player'
import {
  connectSpotify,
  disconnectSpotify,
  likedSongs,
  refreshSpotify,
  spotifyPlaylists,
  spotifyPlaylistTracks,
  spotifyStore,
} from '../lib/spotify'
import { SOURCES } from '../lib/sources'
import { useStore } from '../lib/store'
import { toast } from '../lib/ui'
import { Artwork, Empty, Hero, PlayActions } from './common'
import { PlayIcon, PlaylistIcon, PlusIcon, RefreshIcon, SourceBadge } from './Icons'
import { TrackList } from './TrackList'
import { SearchView } from './Views'

const COLOR = SOURCES.spotify.color
const sum = (tracks: Track[]) => tracks.reduce((a, t) => a + t.duration, 0)

/** Loads async data with loading/error states; `reload` re-runs it. */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true })
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    setState((s) => ({ ...s, loading: true, error: undefined }))
    fn().then(
      (data) => live && setState({ data, loading: false }),
      (err: Error) => live && setState({ error: err.message, loading: false }),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n])
  return { ...state, reload: () => setN((x) => x + 1) }
}

function importPlaylist(tracks: Track[], name: string) {
  createPlaylist(tracks, name)
}

export function SpotifyView() {
  const status = useStore(spotifyStore, (s) => s.status)
  if (!status) return null
  return status.connected ? <SpotifyHome /> : <SpotifySetup />
}

// ---------- setup ----------

function SpotifySetup() {
  const status = useStore(spotifyStore, (s) => s.status)!
  const [clientId, setClientId] = useState(status.clientId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      await connectSpotify(clientId)
      toast('Spotify connected')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast('Copied'),
      () => toast('Copy failed, select it and press Ctrl+C'),
    )

  return (
    <>
      <Hero
        kicker="Source"
        title="Connect Spotify"
        color={COLOR}
        meta="One-time setup, about 2 minutes. Needs Spotify Premium."
        art={
          <div className="art hero-art hero-icon">
            <SourceBadge source="spotify" size={96} />
          </div>
        }
      />
      <ol className="setup">
        <li>
          <h3>Open the Spotify developer dashboard</h3>
          <p>Log in with the same Spotify account you listen with, and accept the developer terms if asked.</p>
          <button className="btn" onClick={() => window.open('https://developer.spotify.com/dashboard')}>
            Open dashboard
          </button>
        </li>
        <li>
          <h3>Create an app</h3>
          <p>
            Click <b>Create app</b>. Name and description can be anything (e.g. "ProjectM"). Under <b>Redirect URIs</b>{' '}
            paste this exactly and click <b>Add</b>:
          </p>
          <div className="copy-row">
            <code>{status.redirectUri}</code>
            <button className="btn small" onClick={() => copy(status.redirectUri)}>
              Copy
            </button>
          </div>
          <p>
            Tick <b>Web API</b>, agree to the terms, then click <b>Save</b>.
          </p>
        </li>
        <li>
          <h3>Paste your Client ID</h3>
          <p>
            Open the app's <b>Settings</b>, copy the <b>Client ID</b> and paste it here. A browser tab will open so you
            can approve access.
          </p>
          <div className="copy-row">
            <input
              className="text-input"
              value={clientId}
              placeholder="e.g. 3f2a9c…"
              spellCheck={false}
              onChange={(e) => setClientId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && connect()}
            />
            <button className="btn primary" disabled={busy || !clientId.trim()} onClick={connect}>
              {busy ? (
                <>
                  <RefreshIcon size={14} className="spin" /> Waiting for browser…
                </>
              ) : (
                'Connect'
              )}
            </button>
          </div>
          {error && <div className="result-error flat">{error}</div>}
          <p className="hint">
            ProjectM only asks to read your library and control playback. Your login stays on this PC.
          </p>
        </li>
      </ol>
    </>
  )
}

// ---------- connected ----------

type Tab = 'liked' | 'playlists' | 'search'

function SpotifyHome() {
  const status = useStore(spotifyStore, (s) => s.status)!
  const [tab, setTab] = useState<Tab>('liked')
  const [version, setVersion] = useState(0)

  return (
    <>
      <Hero
        kicker="Source"
        title="Spotify"
        color={COLOR}
        meta={
          <span className="meta-row">
            Connected{status.userName ? ` as ${status.userName}` : ''} · plays through your Spotify app
          </span>
        }
        art={
          <div className="art hero-art hero-icon">
            <SourceBadge source="spotify" size={96} />
          </div>
        }
      />
      <div className="actions">
        <div className="chips tabs">
          {(['liked', 'playlists', 'search'] as Tab[]).map((t) => (
            <button key={t} className={cls('chip', tab === t && 'on')} onClick={() => setTab(t)}>
              {t === 'liked' ? 'Liked Songs' : t === 'playlists' ? 'Playlists' : 'Search'}
            </button>
          ))}
        </div>
        <div className="grow" />
        <button
          className="btn small ghost"
          onClick={() => {
            refreshSpotify()
            setVersion((v) => v + 1)
          }}
        >
          <RefreshIcon size={13} /> Refresh
        </button>
        <button className="btn small ghost" onClick={() => disconnectSpotify()}>
          Disconnect
        </button>
      </div>
      {tab === 'liked' && <Liked key={version} />}
      {tab === 'playlists' && <Playlists key={version} />}
      {tab === 'search' && <SearchView source="spotify" />}
    </>
  )
}

function Liked() {
  const { data, error, loading, reload } = useAsync(likedSongs, [])
  if (loading) return <Loading what="your liked songs" />
  if (error) return <LoadError error={error} onRetry={reload} />
  if (!data?.length) return <Empty icon={<PlaylistIcon size={30} />} title="No liked songs yet" />
  return (
    <>
      <div className="section-title with-actions">
        <h2>Liked Songs</h2>
        <span>
          {plural(data.length, 'song')} · {fmtTotal(sum(data))}
        </span>
        <div className="grow" />
        <button className="btn small ghost" onClick={() => importPlaylist(data, 'Liked Songs (Spotify)')}>
          <PlusIcon size={13} /> Save as playlist
        </button>
        <button className="btn small" onClick={() => playTracks(data)}>
          <PlayIcon size={12} /> Play all
        </button>
      </div>
      <TrackList tracks={data} />
    </>
  )
}

function Playlists() {
  const nav = useNav()
  const { data, error, loading, reload } = useAsync(spotifyPlaylists, [])
  if (loading) return <Loading what="your playlists" />
  if (error) return <LoadError error={error} onRetry={reload} />
  if (!data?.length) return <Empty icon={<PlaylistIcon size={30} />} title="No playlists on this account" />
  return (
    <div className="grid">
      {data.map((p) => (
        <PlaylistCard key={p.id} playlist={p} onOpen={() => nav.go({ kind: 'spotifyPlaylist', id: p.id, name: p.name })} />
      ))}
    </div>
  )
}

function PlaylistCard({ playlist, onOpen }: { playlist: SpotifyPlaylist; onOpen: () => void }) {
  return (
    <div className="card" onClick={onOpen}>
      <div className="card-art">
        <Artwork src={playlist.artwork} className="fill" />
        <button
          className="card-play"
          title="Play"
          onClick={(e) => {
            e.stopPropagation()
            spotifyPlaylistTracks(playlist.id).then(
              (tracks) => playTracks(tracks),
              (err: Error) => toast(err.message),
            )
          }}
        >
          <PlayIcon size={20} />
        </button>
      </div>
      <div className="name" title={playlist.name}>
        {playlist.name}
      </div>
      <div className="sub">
        {playlist.owner ? `${playlist.owner} · ` : ''}
        {plural(playlist.total, 'song')}
      </div>
    </div>
  )
}

export function SpotifyPlaylistView({ id, name }: { id: string; name: string }) {
  const { data, error, loading, reload } = useAsync(() => spotifyPlaylistTracks(id), [id])
  const tracks = data ?? []
  return (
    <>
      <Hero
        kicker="Spotify playlist"
        title={name}
        color={COLOR}
        meta={loading ? 'Loading…' : `${plural(tracks.length, 'song')} · ${fmtTotal(sum(tracks))}`}
        art={<Artwork src={tracks[0]?.artwork} className="hero-art" />}
      />
      <PlayActions tracks={tracks}>
        <button className="btn ghost" disabled={!tracks.length} onClick={() => importPlaylist(tracks, name)}>
          <PlusIcon size={15} /> Save to my playlists
        </button>
      </PlayActions>
      {loading ? (
        <Loading what="songs" />
      ) : error ? (
        <LoadError
          error={
            /403|forbidden/i.test(error)
              ? "Spotify doesn't let apps read this playlist (it's probably owned by Spotify or someone else). Your own playlists work."
              : error
          }
          onRetry={reload}
        />
      ) : (
        <TrackList tracks={tracks} />
      )}
    </>
  )
}

const Loading = ({ what }: { what: string }) => (
  <Empty icon={<RefreshIcon size={30} className="spin" />} title={`Loading ${what}…`} />
)

const LoadError = ({ error, onRetry }: { error: string; onRetry: () => void }) => (
  <div className="result-error">
    <span>{error}</span>
    <button className="btn small" onClick={onRetry}>
      Try again
    </button>
  </div>
)
