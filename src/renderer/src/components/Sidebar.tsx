import type { ReactNode } from 'react'
import { cls } from '../lib/format'
import { createPlaylist, deletePlaylist, lib } from '../lib/library'
import { useNav } from '../lib/nav'
import { playTracks } from '../lib/player'
import { accountStore } from '../lib/accounts'
import { isConnected, SOURCE_ORDER, SOURCES, useConnections } from '../lib/sources'
import { useStore } from '../lib/store'
import { openMenu } from '../lib/ui'
import { PlaylistArt } from './common'
import { DiscIcon, HomeIcon, MusicIcon, PlusIcon, SearchIcon, SourceBadge } from './Icons'

export function Sidebar() {
  const nav = useNav()
  const v = nav.view
  const playlists = useStore(lib, (s) => s.playlists)
  const count = useStore(lib, (s) => s.tracks.length)
  const scan = useStore(lib, (s) => s.scan)
  useConnections()
  const accounts = useStore(accountStore, (s) => s.accounts)

  const item = (active: boolean, icon: ReactNode, label: string, onClick: () => void, extra?: ReactNode) => (
    <button className={cls('side-item', active && 'active')} onClick={onClick}>
      {icon}
      <span className="label">{label}</span>
      {extra}
    </button>
  )

  return (
    <nav className="sidebar">
      <div className="side-section">
        {item(v.kind === 'home', <HomeIcon />, 'Home', () => nav.go({ kind: 'home' }))}
        {item(v.kind === 'search', <SearchIcon />, 'Search', () => nav.go({ kind: 'search' }))}
        {item(v.kind === 'songs', <MusicIcon />, 'Songs', () => nav.go({ kind: 'songs' }))}
        {item(v.kind === 'albums' || v.kind === 'album', <DiscIcon />, 'Albums', () => nav.go({ kind: 'albums' }))}
      </div>

      <div className="side-section">
        <h4>Sources</h4>
        {SOURCE_ORDER.map((s) => (
          <div key={s}>
            {item(
              v.kind === 'source' && v.source === s,
              <SourceBadge source={s} size={20} />,
              SOURCES[s].name,
              () => nav.go({ kind: 'source', source: s }),
              s === 'local' ? (
                <span className="count">{count.toLocaleString()}</span>
              ) : accounts[s] && !isConnected(s) ? (
                <span className="pill">Set up</span>
              ) : accounts[s]?.connected ? (
                <span className="connected-dot" title={`Connected${accounts[s]?.userName ? ` as ${accounts[s]?.userName}` : ''}`} />
              ) : undefined,
            )}
          </div>
        ))}
      </div>

      <div className="side-section grow">
        <h4>
          Playlists
          <button
            className="icon-btn tiny"
            title="New playlist"
            onClick={() => nav.go({ kind: 'playlist', id: createPlaylist() })}
          >
            <PlusIcon size={16} />
          </button>
        </h4>
        {playlists.length === 0 && <div className="side-hint">Playlists can mix songs from every source.</div>}
        {playlists.map((p) => (
          <div
            key={p.id}
            onContextMenu={(e) =>
              openMenu(e, [
                { label: 'Play', disabled: !p.tracks.length, onClick: () => playTracks(p.tracks) },
                { label: 'Open', onClick: () => nav.go({ kind: 'playlist', id: p.id }) },
                { separator: true },
                { label: 'Delete playlist', danger: true, onClick: () => deletePlaylist(p.id) },
              ])
            }
          >
            {item(
              v.kind === 'playlist' && v.id === p.id,
              <PlaylistArt playlist={p} size={32} />,
              p.name,
              () => nav.go({ kind: 'playlist', id: p.id }),
              <span className="count">{p.tracks.length}</span>,
            )}
          </div>
        ))}
      </div>

      {scan && (
        <div className="side-scan">
          <div>{scan.phase === 'listing' || !scan.total ? 'Looking for music…' : `Scanning ${scan.done} / ${scan.total}`}</div>
          <div className={cls('progress', !scan.total && 'indeterminate')}>
            <div style={{ width: scan.total ? `${(scan.done / scan.total) * 100}%` : undefined }} />
          </div>
        </div>
      )}
    </nav>
  )
}
