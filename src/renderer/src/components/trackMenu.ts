import type { Track } from '../../../shared/types'
import { plural } from '../lib/format'
import { addToPlaylist, albumKey, createPlaylist, lib, removeFromPlaylist } from '../lib/library'
import type { Nav } from '../lib/nav'
import { addToQueue, playNext, playTracks } from '../lib/player'
import { toast, type MenuItem } from '../lib/ui'

/** Right-click menu for one or more tracks. */
export function trackMenu(tracks: Track[], nav: Nav, inPlaylist?: { id: string; indices: number[] }): MenuItem[] {
  const one = tracks.length === 1 ? tracks[0] : null
  const playlists = lib.get().playlists
  const items: MenuItem[] = [
    { label: 'Play', onClick: () => playTracks(tracks, 0) },
    {
      label: 'Play next',
      onClick: () => {
        playNext(tracks)
        toast(one ? `"${one.title}" plays next` : `${plural(tracks.length, 'song')} play next`)
      },
    },
    {
      label: 'Add to queue',
      onClick: () => {
        addToQueue(tracks)
        toast(one ? `Added "${one.title}" to queue` : `Added ${plural(tracks.length, 'song')} to queue`)
      },
    },
    { separator: true },
    {
      label: 'Add to playlist',
      submenu: [
        { label: 'New playlist', onClick: () => nav.go({ kind: 'playlist', id: createPlaylist(tracks) }) },
        ...(playlists.length ? [{ separator: true }] : []),
        ...playlists
          .filter((p) => p.id !== inPlaylist?.id)
          .map((p) => ({ label: p.name, onClick: () => addToPlaylist(p.id, tracks) })),
      ],
    },
  ]
  if (inPlaylist) {
    items.push({
      label: 'Remove from this playlist',
      danger: true,
      onClick: () => removeFromPlaylist(inPlaylist.id, inPlaylist.indices),
    })
  }
  if (one) {
    items.push({ separator: true })
    items.push({ label: 'Go to album', onClick: () => nav.go({ kind: 'album', key: albumKey(one) }) })
    items.push({ label: 'Go to artist', onClick: () => nav.go({ kind: 'search', q: one.artist }) })
    if (one.source === 'local') {
      items.push({ label: 'Show in folder', onClick: () => window.api.library.showInFolder(one.id) })
    }
  }
  return items
}
