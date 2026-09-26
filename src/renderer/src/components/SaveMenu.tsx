import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RemotePlaylist, SourceId, Track } from '../../../shared/types'
import { accountStore, forgetRemotePlaylist, refreshAccount, remotePlaylists } from '../lib/accounts'
import { cls, norm } from '../lib/format'
import { addToPlaylist, createPlaylist, lib, removeTrackFromPlaylist } from '../lib/library'
import { forgetLikedCount, preloadLiked } from '../lib/liked'
import { cleanError, SOURCES } from '../lib/sources'
import { createStore, useStore } from '../lib/store'
import { toast } from '../lib/ui'
import { LikedArt } from './AccountViews'
import { Artwork, PlaylistArt } from './common'
import { PlusIcon, SearchIcon } from './Icons'

/** Whether songs are in your liked songs on their platform (uid -> liked), filled in as we check. */
export const likedStateStore = createStore<{ liked: Record<string, boolean> }>({ liked: {} })

const LIKE_SOURCES: SourceId[] = ['spotify', 'youtube']
const canLikeOn = (s: SourceId) => LIKE_SOURCES.includes(s) && !!accountStore.get().accounts[s]?.connected

/** Looks up (once) whether the song is liked on its own platform. */
export function checkLiked(track: Track | undefined) {
  if (!track || !canLikeOn(track.source) || track.uid in likedStateStore.get().liked) return
  window.api.accounts.isLiked(track.source, [track.id]).then(
    ([liked]) => likedStateStore.set((s) => ({ liked: { ...s.liked, [track.uid]: !!liked } })),
    () => {},
  )
}

function likeUnavailableReason(source: SourceId) {
  if (source === 'local') return 'Local files have no online liked songs; use a playlist instead.'
  if (source === 'soundcloud') return "SoundCloud doesn't let other apps save likes (it needs a paid Artist Pro login)."
  if (!accountStore.get().accounts[source]?.connected) return `Sign in to ${SOURCES[source].name} to save likes there.`
  return null
}

/** Spotify-style "Save in" menu: liked songs on the song's platform + your ProjectM playlists. */
export function SaveMenu({ track, anchor, onClose }: { track: Track; anchor: DOMRect; onClose: () => void }) {
  const playlists = useStore(lib, (s) => s.playlists)
  const likedNow = useStore(likedStateStore, (s) => s.liked[track.uid])
  const [query, setQuery] = useState('')
  const [liked, setLiked] = useState<boolean | undefined>(likedNow)
  const [inPlaylists, setInPlaylists] = useState(
    () => new Set(playlists.filter((p) => p.tracks.some((t) => t.uid === track.uid)).map((p) => p.id)),
  )
  const [saving, setSaving] = useState(false)
  // your own playlists on the song's platform (songs can only go into playlists on their own service)
  const [remote, setRemote] = useState<RemotePlaylist[] | null>(null)
  const [added, setAdded] = useState<Record<string, 'adding' | 'done'>>({})
  useEffect(() => {
    if (!canLikeOn(track.source)) return
    let live = true
    remotePlaylists(track.source).then(
      (list) => live && setRemote(list.filter((p) => p.editable)),
      () => live && setRemote([]),
    )
    return () => {
      live = false
    }
  }, [track])
  const remoteShown = useMemo(() => {
    const q = norm(query.trim())
    return (remote ?? []).filter((p) => !q || norm(p.name).includes(q))
  }, [remote, query])

  const addRemote = async (p: RemotePlaylist) => {
    setAdded((a) => ({ ...a, [p.id]: 'adding' }))
    try {
      await window.api.accounts.addToPlaylist(track.source, p.id, track.id)
      forgetRemotePlaylist(track.source, p.id)
      setAdded((a) => ({ ...a, [p.id]: 'done' }))
      toast(`Added to "${p.name}" on ${SOURCES[track.source].name}`)
    } catch (err) {
      setAdded((a) => {
        const next = { ...a }
        delete next[p.id]
        return next
      })
      toast(cleanError(err).message)
    }
  }
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const reason = likeUnavailableReason(track.source)

  useEffect(() => setLiked((l) => l ?? likedNow), [likedNow])
  useEffect(() => checkLiked(track), [track])

  // open above the + button, kept inside the window
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(anchor.left, innerWidth - r.width - 8)),
      top: Math.max(8, anchor.top - r.height - 10),
    })
  }, [anchor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const shown = useMemo(() => {
    const q = norm(query.trim())
    return q ? playlists.filter((p) => norm(p.name).includes(q)) : playlists
  }, [playlists, query])

  const toggle = (id: string) =>
    setInPlaylists((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const done = async () => {
    setSaving(true)
    const before = new Set(playlists.filter((p) => p.tracks.some((t) => t.uid === track.uid)).map((p) => p.id))
    for (const p of playlists) {
      if (inPlaylists.has(p.id) && !before.has(p.id)) addToPlaylist(p.id, [track])
      if (!inPlaylists.has(p.id) && before.has(p.id)) removeTrackFromPlaylist(p.id, track.uid)
    }
    if (!reason && liked !== undefined && liked !== likedNow) {
      try {
        await window.api.accounts.setLiked(track.source, track.id, liked)
        likedStateStore.set((s) => ({ liked: { ...s.liked, [track.uid]: liked } }))
        refreshAccount(track.source)
        forgetLikedCount(track.source)
        preloadLiked()
        toast(liked ? `Added to Liked Songs on ${SOURCES[track.source].name}` : `Removed from Liked Songs on ${SOURCES[track.source].name}`)
      } catch (err) {
        toast(cleanError(err).message)
      }
    }
    setSaving(false)
    onClose()
  }

  const newPlaylist = () => {
    createPlaylist([track])
    onClose()
  }

  return (
    <div className="save-backdrop" onMouseDown={onClose}>
      <div
        ref={ref}
        className="save-menu"
        style={{ left: pos?.left ?? anchor.left, top: pos?.top ?? anchor.top, visibility: pos ? 'visible' : 'hidden' }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Save in"
      >
        <div className="save-title">Save in</div>
        <label className="save-search">
          <SearchIcon size={15} />
          <input autoFocus value={query} placeholder="Find a playlist" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className="save-row new" onClick={newPlaylist}>
          <span className="save-new-icon">
            <PlusIcon size={16} />
          </span>
          <span className="save-name">New playlist</span>
        </button>
        <div className="save-list">
          <label className={cls('save-row', reason && 'disabled')} title={reason ?? undefined}>
            {track.source === 'local' ? (
              <span className="save-new-icon">♥</span>
            ) : (
              <LikedArt source={track.source} size={34} />
            )}
            <span className="save-name">
              Liked Songs
              <small>{reason ?? SOURCES[track.source].name}</small>
            </span>
            <input
              type="checkbox"
              className="save-check"
              disabled={!!reason || liked === undefined}
              checked={!!liked}
              onChange={(e) => setLiked(e.target.checked)}
            />
          </label>
          {shown.map((p) => (
            <label key={p.id} className="save-row">
              <PlaylistArt playlist={p} size={34} />
              <span className="save-name">
                {p.name}
                <small>ProjectM playlist</small>
              </span>
              <input type="checkbox" className="save-check" checked={inPlaylists.has(p.id)} onChange={() => toggle(p.id)} />
            </label>
          ))}
          {!shown.length && !remoteShown.length && query && <div className="save-empty">No playlist matches "{query}"</div>}
          {remoteShown.length > 0 && (
            <>
              <div className="save-section">On {SOURCES[track.source].name}</div>
              {remoteShown.map((p) => (
                <div key={p.id} className="save-row">
                  <Artwork src={p.artwork} size={34} />
                  <span className="save-name">
                    {p.name}
                    <small>
                      {SOURCES[track.source].name} playlist{p.total ? ` · ${p.total} songs` : ''}
                    </small>
                  </span>
                  <button
                    className={cls('btn small', added[p.id] === 'done' ? 'ghost' : '')}
                    disabled={!!added[p.id]}
                    onClick={() => addRemote(p)}
                  >
                    {added[p.id] === 'done' ? 'Added ✓' : added[p.id] === 'adding' ? 'Adding…' : 'Add'}
                  </button>
                </div>
              ))}
            </>
          )}
          {remote === null && canLikeOn(track.source) && (
            <div className="save-empty">Loading your {SOURCES[track.source].name} playlists…</div>
          )}
        </div>
        <div className="save-foot">
          <button className="btn small ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn small primary" disabled={saving} onClick={done}>
            {saving ? 'Saving…' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}
