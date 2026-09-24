import { useEffect, useMemo, useState } from 'react'
import type { SourceId } from '../../../shared/types'
import { cls, fmtTotal, norm, plural } from '../lib/format'
import {
  addFolder,
  deletePlaylist,
  groupAlbums,
  lib,
  matches,
  removeFolder,
  renamePlaylist,
  rescan,
  sortedLibrary,
  useAlbums,
  type Album,
} from '../lib/library'
import { useNav } from '../lib/nav'
import { playTracks } from '../lib/player'
import { isConnected, SOURCE_ORDER, SOURCES } from '../lib/sources'
import { useStore } from '../lib/store'
import { Artwork, Empty, Hero, PlayActions, PlaylistArt } from './common'
import { DiscIcon, FolderIcon, MusicIcon, PlayIcon, PlaylistIcon, PlusIcon, RefreshIcon, SearchIcon, SourceBadge, TrashIcon, XIcon } from './Icons'
import { TrackList } from './TrackList'

const sumDuration = (tracks: { duration: number }[]) => tracks.reduce((a, t) => a + t.duration, 0)

// ---------- Songs ----------

export function SongsView() {
  const tracks = useStore(lib, (s) => s.tracks)
  const ready = useStore(lib, (s) => s.ready)
  const sorted = sortedLibrary(tracks)
  const total = useMemo(() => sumDuration(tracks), [tracks])

  if (ready && !tracks.length) return <EmptyLibrary />
  return (
    <>
      <Hero
        kicker="Library"
        title="Songs"
        meta={`${plural(tracks.length, 'song')} · ${fmtTotal(total)}`}
        art={
          <div className="art hero-art hero-icon">
            <MusicIcon size={72} />
          </div>
        }
      />
      <PlayActions tracks={sorted} />
      <TrackList tracks={sorted} />
    </>
  )
}

function EmptyLibrary() {
  const scan = useStore(lib, (s) => s.scan)
  if (scan) {
    return (
      <Empty icon={<RefreshIcon size={30} className="spin" />} title="Scanning your music…">
        <p>{scan.total ? `${scan.done} of ${scan.total} files` : 'Looking for audio files'}</p>
      </Empty>
    )
  }
  return (
    <Empty icon={<FolderIcon size={30} />} title="Your library is empty">
      <p>Add a folder with music in it. MP3, FLAC, M4A, AAC, OGG, OPUS and WAV all work.</p>
      <button className="btn primary" onClick={addFolder}>
        <PlusIcon size={16} /> Add music folder
      </button>
      <p className="hint">YouTube Music, SoundCloud and Spotify are coming next.</p>
    </Empty>
  )
}

// ---------- Albums ----------

export function AlbumsView() {
  const albums = useAlbums()
  const ready = useStore(lib, (s) => s.ready)
  if (ready && !albums.length) return <EmptyLibrary />
  return (
    <>
      <div className="page-title">
        <h1>Albums</h1>
        <span>{plural(albums.length, 'album')}</span>
      </div>
      <div className="grid">
        {albums.map((a) => (
          <AlbumCard key={a.key} album={a} />
        ))}
      </div>
    </>
  )
}

function AlbumCard({ album }: { album: Album }) {
  const nav = useNav()
  return (
    <div className="card" onClick={() => nav.go({ kind: 'album', key: album.key })}>
      <div className="card-art">
        <Artwork src={album.artwork} className="fill" />
        <button
          className="card-play"
          title="Play"
          onClick={(e) => {
            e.stopPropagation()
            playTracks(album.tracks)
          }}
        >
          <PlayIcon size={20} />
        </button>
      </div>
      <div className="name" title={album.name}>
        {album.name}
      </div>
      <div className="sub">
        {album.artist}
        {album.year ? ` · ${album.year}` : ''}
      </div>
    </div>
  )
}

export function AlbumView({ albumKey }: { albumKey: string }) {
  const album = useAlbums().find((a) => a.key === albumKey)
  if (!album) return <Empty icon={<DiscIcon size={30} />} title="Album not found" />
  return (
    <>
      <Hero
        kicker="Album"
        title={album.name}
        meta={
          <>
            <b>{album.artist}</b>
            {album.year ? ` · ${album.year}` : ''} · {plural(album.tracks.length, 'song')} · {fmtTotal(album.duration)}
          </>
        }
        art={<Artwork src={album.artwork} className="hero-art" />}
      />
      <PlayActions tracks={album.tracks} />
      <TrackList tracks={album.tracks} showAlbum={false} numbers="trackNo" />
    </>
  )
}

// ---------- Search ----------

export function SearchView({ initial }: { initial?: string }) {
  const [q, setQ] = useState(initial ?? '')
  const tracks = useStore(lib, (s) => s.tracks)
  const tokens = useMemo(() => norm(q).split(/\s+/).filter(Boolean), [q])

  const songs = useMemo(
    () => (tokens.length ? sortedLibrary(tracks).filter((t) => matches(t, tokens)) : []),
    [tracks, tokens],
  )
  const albums = useMemo(
    () =>
      tokens.length
        ? groupAlbums(tracks)
            .filter((a) => tokens.every((tok) => norm(`${a.name} ${a.artist}`).includes(tok)))
            .slice(0, 12)
        : [],
    [tracks, tokens],
  )

  return (
    <>
      <div className="search-bar">
        <label className="search-input">
          <SearchIcon size={20} />
          <input
            autoFocus
            value={q}
            placeholder="Songs, artists, albums"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQ('')
              if (e.key === 'Enter' && songs.length) playTracks(songs)
            }}
          />
          {q && (
            <button className="icon-btn" title="Clear" onClick={() => setQ('')}>
              <XIcon size={16} />
            </button>
          )}
        </label>
        <div className="chips">
          {SOURCE_ORDER.map((s) => (
            <button
              key={s}
              className={cls('chip', isConnected(s) && 'on')}
              disabled={!isConnected(s)}
              title={isConnected(s) ? undefined : 'Coming soon'}
            >
              <SourceBadge source={s} size={14} /> {SOURCES[s].name}
            </button>
          ))}
        </div>
      </div>

      {!tokens.length ? (
        <Empty icon={<SearchIcon size={30} />} title="Search your music">
          <p>Find songs, artists and albums. Press Enter to play everything that matches.</p>
        </Empty>
      ) : !songs.length && !albums.length ? (
        <Empty icon={<SearchIcon size={30} />} title={`No results for "${q}"`}>
          <p>Check the spelling, or try fewer words.</p>
        </Empty>
      ) : (
        <>
          {albums.length > 0 && (
            <>
              <h2 className="section-title">Albums</h2>
              <div className="grid">
                {albums.map((a) => (
                  <AlbumCard key={a.key} album={a} />
                ))}
              </div>
            </>
          )}
          {songs.length > 0 && (
            <>
              <div className="section-title with-actions">
                <h2>Songs</h2>
                <span>{plural(songs.length, 'result')}</span>
                <div className="grow" />
                <button className="btn" onClick={() => playTracks(songs)}>
                  <PlayIcon size={14} /> Play all
                </button>
              </div>
              <TrackList tracks={songs} />
            </>
          )}
        </>
      )}
    </>
  )
}

// ---------- Playlist ----------

export function PlaylistView({ id }: { id: string }) {
  const nav = useNav()
  const playlist = useStore(lib, (s) => s.playlists.find((p) => p.id === id))
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!confirmDelete) return
    const t = setTimeout(() => setConfirmDelete(false), 3000)
    return () => clearTimeout(t)
  }, [confirmDelete])

  if (!playlist) return <Empty icon={<PlaylistIcon size={30} />} title="Playlist not found" />

  const sources = new Set(playlist.tracks.map((t) => t.source))
  const titleNode = editing ? (
    <input
      className="h1-input"
      autoFocus
      defaultValue={playlist.name}
      onFocus={(e) => e.target.select()}
      onBlur={(e) => {
        renamePlaylist(id, e.target.value)
        setEditing(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setEditing(false)
      }}
    />
  ) : (
    <h1 className="editable" title="Click to rename" onClick={() => setEditing(true)}>
      {playlist.name}
    </h1>
  )

  return (
    <>
      <Hero
        kicker="Playlist"
        titleNode={titleNode}
        meta={
          <span className="meta-row">
            {plural(playlist.tracks.length, 'song')}
            {playlist.tracks.length > 0 && ` · ${fmtTotal(sumDuration(playlist.tracks))}`}
            {[...sources].map((s) => (
              <SourceBadge key={s} source={s} size={14} />
            ))}
          </span>
        }
        art={<PlaylistArt playlist={playlist} className="hero-art" />}
      />
      <PlayActions tracks={playlist.tracks}>
        <button
          className={cls('btn ghost', confirmDelete && 'danger')}
          onClick={() => {
            if (!confirmDelete) return setConfirmDelete(true)
            deletePlaylist(id)
            nav.back()
          }}
        >
          <TrashIcon size={15} /> {confirmDelete ? 'Click again to delete' : 'Delete'}
        </button>
      </PlayActions>
      {playlist.tracks.length ? (
        <TrackList tracks={playlist.tracks} playlistId={id} />
      ) : (
        <Empty icon={<PlaylistIcon size={30} />} title="This playlist is empty">
          <p>Right-click any song and choose Add to playlist.</p>
        </Empty>
      )}
    </>
  )
}

// ---------- Sources ----------

export function SourceView({ source }: { source: SourceId }) {
  return source === 'local' ? <LocalSource /> : <ComingSoon source={source} />
}

function LocalSource() {
  const folders = useStore(lib, (s) => s.folders)
  const tracks = useStore(lib, (s) => s.tracks)
  const scan = useStore(lib, (s) => s.scan)
  const albums = useAlbums()
  const [busy, setBusy] = useState(false)

  const perFolder = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of tracks) {
      const path = (t as { path?: string }).path?.toLowerCase() ?? ''
      const f = folders.find((f) => path.startsWith(f.toLowerCase()))
      if (f) counts.set(f, (counts.get(f) ?? 0) + 1)
    }
    return counts
  }, [tracks, folders])

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Hero
        kicker="Source"
        title="Local Files"
        color={SOURCES.local.color}
        meta={`${plural(tracks.length, 'song')} · ${plural(albums.length, 'album')} · ${plural(folders.length, 'folder')}`}
        art={
          <div className="art hero-art hero-icon">
            <FolderIcon size={72} />
          </div>
        }
      />
      <div className="actions">
        <button className="btn primary" onClick={run(addFolder)} disabled={busy}>
          <PlusIcon size={16} /> Add folder
        </button>
        <button className="btn" onClick={run(rescan)} disabled={busy || !folders.length}>
          <RefreshIcon size={15} className={cls(scan && 'spin')} /> Rescan
        </button>
      </div>

      {scan && (
        <div className="scan-status">
          <div>{scan.total ? `Reading tags: ${scan.done} of ${scan.total} files` : 'Looking for audio files…'}</div>
          <div className={cls('progress', !scan.total && 'indeterminate')}>
            <div style={{ width: scan.total ? `${(scan.done / scan.total) * 100}%` : undefined }} />
          </div>
        </div>
      )}

      <h2 className="section-title">Folders</h2>
      <div className="folders">
        {!folders.length && <div className="side-hint pad">No folders yet. Add one to start building your library.</div>}
        {folders.map((f) => (
          <div key={f} className="folder">
            <FolderIcon size={18} />
            <span className="path" title={f}>
              {f}
            </span>
            <span className="count">{plural(perFolder.get(f) ?? 0, 'song')}</span>
            <button className="icon-btn" title="Remove folder (files on disk are not touched)" onClick={run(() => removeFolder(f))} disabled={busy}>
              <XIcon size={16} />
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

function ComingSoon({ source }: { source: SourceId }) {
  const info = SOURCES[source]
  return (
    <>
      <Hero
        kicker="Source"
        title={info.name}
        color={info.color}
        meta="Not connected yet"
        art={
          <div className="art hero-art hero-icon">
            <SourceBadge source={source} size={96} />
          </div>
        }
      />
      <div className="soon">
        <p>{info.plan}</p>
        <p className="hint">Coming in a later phase. Once it's connected, its songs will show up in search, the queue and your playlists next to your local files.</p>
      </div>
    </>
  )
}
