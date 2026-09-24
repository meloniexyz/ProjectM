import { useEffect, useState } from 'react'
import type { RemotePlaylist, SoundCloudProfile, SourceId, Track } from '../../../shared/types'
import {
  cancelSignIn,
  connectAccount,
  deviceCodeStore,
  disconnectAccount,
  likedSongs,
  refreshAccount,
  remotePlaylists,
  remotePlaylistTracks,
  useAccount,
} from '../lib/accounts'
import { cls, fmtTotal, plural } from '../lib/format'
import { createPlaylist } from '../lib/library'
import { useNav } from '../lib/nav'
import { playTracks } from '../lib/player'
import { SOURCES } from '../lib/sources'
import { useStore } from '../lib/store'
import { toast } from '../lib/ui'
import { Artwork, Empty, Hero, PlayActions } from './common'
import { PlayIcon, PlaylistIcon, PlusIcon, RefreshIcon, SourceBadge } from './Icons'
import { TrackList } from './TrackList'
import { SearchView } from './Views'

const sum = (tracks: Track[]) => tracks.reduce((a, t) => a + t.duration, 0)

/** Loads async data with loading/error states; `reload` re-runs it. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
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

const SourceArt = ({ source }: { source: SourceId }) => (
  <div className="art hero-art hero-icon">
    <SourceBadge source={source} size={96} />
  </div>
)

/** Page for a streaming service: sign-in, your library, and search. */
export function AccountSourceView({ source }: { source: SourceId }) {
  const status = useAccount(source)
  const [tab, setTab] = useState<'liked' | 'playlists' | 'search'>('liked')
  const [version, setVersion] = useState(0)
  const info = SOURCES[source]
  if (!status) return null

  if (!status.connected) {
    return source === 'spotify' ? (
      <SpotifySetup />
    ) : (
      <>
        <Hero kicker="Source" title={info.name} color={info.color} meta={source === 'soundcloud' ? 'Search works right away. Add your profile to see your likes and playlists.' : 'Search works right away. Sign in to see your likes and playlists.'} art={<SourceArt source={source} />} />
        <ConnectCard source={source} />
        <SearchView source={source} />
      </>
    )
  }

  return (
    <>
      <Hero
        kicker="Source"
        title={info.name}
        color={info.color}
        meta={`Connected${status.userName ? ` as ${status.userName}` : ''}${source === 'spotify' ? ' · plays through your Spotify app' : ''}`}
        art={<SourceArt source={source} />}
      />
      <div className="actions">
        <div className="chips tabs">
          {(['liked', 'playlists', 'search'] as const).map((t) => (
            <button key={t} className={cls('chip', tab === t && 'on')} onClick={() => setTab(t)}>
              {t === 'liked' ? (source === 'youtube' ? 'Liked Music' : 'Liked Songs') : t === 'playlists' ? 'Playlists' : 'Search'}
            </button>
          ))}
        </div>
        <div className="grow" />
        <button
          className="btn small ghost"
          onClick={() => {
            refreshAccount(source)
            setVersion((v) => v + 1)
          }}
        >
          <RefreshIcon size={13} /> Refresh
        </button>
        <button className="btn small ghost" onClick={() => disconnectAccount(source)}>
          Disconnect
        </button>
      </div>
      {tab === 'liked' && <Liked key={version} source={source} />}
      {tab === 'playlists' && <Playlists key={version} source={source} />}
      {tab === 'search' && <SearchView source={source} />}
    </>
  )
}

function ConnectCard({ source }: { source: SourceId }) {
  return source === 'youtube' ? <YouTubeSignIn /> : <SoundCloudProfile />
}

/** Appears after a few seconds of waiting, so a stalled request doesn't look like a frozen app. */
function SlowHint() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 8000)
    return () => clearTimeout(t)
  }, [])
  return slow ? <span className="hint">taking longer than usual, it gives up by itself after 30s</span> : null
}

/** SoundCloud likes and playlists are public: find your profile and pick it. No login needed. */
function SoundCloudProfile() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SoundCloudProfile[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      return
    }
    let live = true
    setSearching(true)
    const t = setTimeout(() => {
      window.api.soundcloud.findProfiles(q).then(
        (found) => live && (setResults(found), setSearching(false)),
        () => live && (setResults([]), setSearching(false)),
      )
    }, 400)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query])

  const pick = async (p: SoundCloudProfile) => {
    setBusyId(p.id)
    setError(null)
    try {
      await connectAccount('soundcloud', `id:${p.id}`)
      toast(`SoundCloud connected as ${p.username}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="connect-card paste">
      <div>
        <h3>Find your SoundCloud profile</h3>
        <p>
          SoundCloud only offers app sign-in to paid Artist Pro accounts, but your likes and playlists are public, so
          ProjectM just needs to know which profile is yours. Search your name or paste your profile link, then click
          your profile.
        </p>
      </div>
      <div className="copy-row">
        <input
          className="text-input plain"
          value={query}
          autoFocus
          placeholder="Your name on SoundCloud, or your profile link"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && <RefreshIcon size={16} className="spin" />}
      </div>
      {results && results.length === 0 && !searching && (
        <div className="hint">No profiles found. Try your profile link (soundcloud.com/…) instead.</div>
      )}
      {results && results.length > 0 && (
        <div className="profile-list">
          {results.map((p) => (
            <button key={p.id} className="profile-row" disabled={busyId !== null} onClick={() => pick(p)}>
              <Artwork src={p.avatar} size={44} className="round" />
              <div className="profile-text">
                <div className="t">{p.username}</div>
                <div className="a">
                  soundcloud.com/{p.permalink}
                  {p.city ? ` · ${p.city}` : ''} · {plural(p.followers, 'follower')} · {plural(p.likes, 'like')}
                </div>
              </div>
              {busyId === p.id ? <RefreshIcon size={16} className="spin" /> : <span className="pick">This is me</span>}
            </button>
          ))}
        </div>
      )}
      {error && <div className="result-error flat">{error}</div>}
    </div>
  )
}

/** "Sign in with a code" (like a smart TV): approve in your own browser at google.com/device. */
function YouTubeSignIn() {
  const code = useStore(deviceCodeStore, (s) => s.code)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsClient, setNeedsClient] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  const signIn = async (custom?: { clientId: string; clientSecret: string }) => {
    setBusy(true)
    setError(null)
    try {
      await connectAccount('youtube', custom ? JSON.stringify(custom) : undefined)
      toast('YouTube Music connected')
    } catch (err) {
      const msg = (err as Error).message
      if (msg.startsWith('NEEDS_CLIENT:')) {
        setNeedsClient(true)
        setShowAdvanced(true)
        setError(msg.replace('NEEDS_CLIENT: ', ''))
      } else if (!/cancelled/i.test(msg)) setError(msg)
    } finally {
      setBusy(false)
    }
  }

  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast('Code copied'),
      () => toast('Copy failed, type it in manually'),
    )

  return (
    <div className="connect-card paste">
      <div className="connect-head">
        <div>
          <h3>Connect your YouTube Music account</h3>
          <p>
            Sign in with Google like you would on a smart TV: ProjectM shows a code, you approve it in your own
            browser. Your password never touches ProjectM.
          </p>
        </div>
        {!busy && (
          <button className="btn primary" onClick={() => signIn()}>
            Sign in with Google
          </button>
        )}
      </div>

      {busy && (
        <div className="device-code">
          {code ? (
            <>
              <div className="device-steps">
                <span>
                  1. Open{' '}
                  <button className="link-btn inline" onClick={() => window.open(code.url)}>
                    {code.url.replace(/^https?:\/\/(www\.)?/, '')}
                  </button>{' '}
                  in your browser
                </span>
                <span>2. Enter this code and pick your account:</span>
              </div>
              <div className="code-row">
                <code className="big-code">{code.code}</code>
                <button className="btn small" onClick={() => copy(code.code)}>
                  Copy
                </button>
                <button className="btn small" onClick={() => window.open(code.url)}>
                  Open page
                </button>
              </div>
              <div className="waiting">
                <RefreshIcon size={13} className="spin" /> Waiting for you to approve… (the code works for 30 minutes)
                <button className="link-btn" onClick={() => cancelSignIn().then(() => setBusy(false))}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="waiting">
              <RefreshIcon size={13} className="spin" /> Getting a sign-in code from Google…
              <SlowHint />
              <button className="link-btn" onClick={() => cancelSignIn().then(() => setBusy(false))}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {error && <div className="result-error flat">{error}</div>}

      {!busy && (
        <button className="link-btn" onClick={() => setShowAdvanced((s) => !s)}>
          {showAdvanced ? 'Hide' : 'Advanced:'} use my own Google client
        </button>
      )}
      {showAdvanced && !busy && (
        <div className="advanced">
          {needsClient && (
            <p>
              YouTube doesn't let the standard TV sign-in read your library. A free Google project of your own fixes
              that (one-time, about 5 minutes). After that you sign in with a code, same as before.
            </p>
          )}
          <ol className="mini-steps">
            <li>
              <button className="link-btn inline" onClick={() => window.open('https://console.cloud.google.com/projectcreate')}>
                Create a Google Cloud project
              </button> (free, any
              name like "ProjectM"), using the same Google account as your YouTube.
            </li>
            <li>
              Open the <button className="link-btn inline" onClick={() => window.open('https://console.cloud.google.com/apis/library/youtube.googleapis.com')}>
                YouTube Data API v3
              </button>{' '}
              page and click <b>Enable</b>.
            </li>
            <li>
              Open <button className="link-btn inline" onClick={() => window.open('https://console.cloud.google.com/auth/overview')}>
                Google Auth Platform
              </button> → <b>Get started</b>. App
              name: ProjectM, pick your email, Audience: <b>External</b>, finish. Then under <b>Audience</b> → <b>Test
              users</b>, add your own Gmail.
            </li>
            <li>
              Open <button className="link-btn inline" onClick={() => window.open('https://console.cloud.google.com/auth/clients/create')}>
                Clients → Create client
              </button>, choose{' '}
              <b>TVs and Limited Input devices</b>, click <b>Create</b>, and copy the <b>Client ID</b> and{' '}
              <b>Client secret</b> into the boxes below.
            </li>
            <li>
              Click <b>Sign in</b> and approve the code. Google will warn that the app isn't verified: that's your own
              app, click <b>Continue</b>.
            </li>
          </ol>
          <div className="copy-row">
            <input
              className="text-input"
              value={clientId}
              placeholder="Client ID (…apps.googleusercontent.com)"
              spellCheck={false}
              onChange={(e) => setClientId(e.target.value)}
            />
            <input
              className="text-input"
              type="password"
              value={clientSecret}
              placeholder="Client secret"
              spellCheck={false}
              onChange={(e) => setClientSecret(e.target.value)}
            />
            <button
              className="btn primary"
              disabled={!clientId.trim() || !clientSecret.trim()}
              onClick={() => signIn({ clientId, clientSecret })}
            >
              Sign in
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SpotifySetup() {
  const status = useAccount('spotify')!
  const [clientId, setClientId] = useState(status.clientId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const redirect = status.redirectUri ?? ''

  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      await connectAccount('spotify', clientId)
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
        color={SOURCES.spotify.color}
        meta="One-time setup, about 2 minutes. Needs Spotify Premium."
        art={<SourceArt source="spotify" />}
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
            <code>{redirect}</code>
            <button className="btn small" onClick={() => copy(redirect)}>
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
            Open the app's <b>Settings</b>, copy the <b>Client ID</b> and paste it here. A browser tab opens so you can
            approve access.
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
          <p className="hint">ProjectM only asks to read your library and control playback. Your login stays on this PC.</p>
        </li>
      </ol>
    </>
  )
}

function Liked({ source }: { source: SourceId }) {
  const { data, error, loading, reload } = useAsync(() => likedSongs(source), [source])
  if (loading) return <Loading what="your liked songs" />
  if (error) return <LoadError error={error} onRetry={reload} />
  if (!data?.length) return <Empty icon={<PlaylistIcon size={30} />} title="No liked songs yet" />
  const name = `Liked Songs (${SOURCES[source].name})`
  return (
    <>
      <div className="section-title with-actions">
        <h2>{source === 'youtube' ? 'Liked Music' : 'Liked Songs'}</h2>
        <span>
          {plural(data.length, 'song')} · {fmtTotal(sum(data))}
        </span>
        <div className="grow" />
        <button className="btn small ghost" onClick={() => createPlaylist(data, name)}>
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

function Playlists({ source }: { source: SourceId }) {
  const { data, error, loading, reload } = useAsync(() => remotePlaylists(source), [source])
  if (loading) return <Loading what="your playlists" />
  if (error) return <LoadError error={error} onRetry={reload} />
  if (!data?.length) return <Empty icon={<PlaylistIcon size={30} />} title="No playlists on this account" />
  return (
    <div className="grid">
      {data.map((p) => (
        <RemotePlaylistCard key={p.id} source={source} playlist={p} />
      ))}
    </div>
  )
}

export function RemotePlaylistCard({ source, playlist }: { source: SourceId; playlist: RemotePlaylist }) {
  const nav = useNav()
  return (
    <div className="card" onClick={() => nav.go({ kind: 'remotePlaylist', source, id: playlist.id, name: playlist.name })}>
      <div className="card-art">
        <Artwork src={playlist.artwork} className="fill" px={300} />
        <span className="card-source">
          <SourceBadge source={source} size={18} />
        </span>
        <button
          className="card-play"
          title="Play"
          onClick={(e) => {
            e.stopPropagation()
            remotePlaylistTracks(source, playlist.id).then(
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
        {playlist.owner ? `${playlist.owner}` : SOURCES[source].name}
        {playlist.total ? ` · ${plural(playlist.total, 'song')}` : ''}
      </div>
    </div>
  )
}

export function RemotePlaylistView({ source, id, name }: { source: SourceId; id: string; name: string }) {
  const { data, error, loading, reload } = useAsync(() => remotePlaylistTracks(source, id), [source, id])
  const tracks = data ?? []
  return (
    <>
      <Hero
        kicker={`${SOURCES[source].name} playlist`}
        title={name}
        color={SOURCES[source].color}
        meta={loading ? 'Loading…' : `${plural(tracks.length, 'song')} · ${fmtTotal(sum(tracks))}`}
        art={<Artwork src={tracks[0]?.artwork} className="hero-art" px={640} />}
      />
      <PlayActions tracks={tracks}>
        <button className="btn ghost" disabled={!tracks.length} onClick={() => createPlaylist(tracks, name)}>
          <PlusIcon size={15} /> Save to my playlists
        </button>
      </PlayActions>
      {loading ? (
        <Loading what="songs" />
      ) : error ? (
        <LoadError
          error={
            source === 'spotify' && /403|forbidden/i.test(error)
              ? "Spotify doesn't let apps read this playlist (it's probably made by Spotify or someone else). Your own playlists work."
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

export const Loading = ({ what }: { what: string }) => (
  <Empty icon={<RefreshIcon size={30} className="spin" />} title={`Loading ${what}…`} />
)

export const LoadError = ({ error, onRetry }: { error: string; onRetry: () => void }) => (
  <div className="result-error">
    <span>{error}</span>
    <button className="btn small" onClick={onRetry}>
      Try again
    </button>
  </div>
)
