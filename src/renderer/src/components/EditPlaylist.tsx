import { useEffect, useState } from 'react'
import { editPlaylistStore, lib, updatePlaylistDetails } from '../lib/library'
import { useStore } from '../lib/store'
import { toast } from '../lib/ui'
import { PlaylistArt } from './common'
import { PlaylistIcon, XIcon } from './Icons'

const NAME_MAX = 100
const DESCRIPTION_MAX = 300

/** Spotify-style "Edit details" dialog: cover picture, name and description. */
export function EditPlaylistHost() {
  const id = useStore(editPlaylistStore, (s) => s.id)
  const playlist = useStore(lib, (s) => s.playlists.find((p) => p.id === id))
  if (!id || !playlist) return null
  return <EditPlaylistDialog key={id} id={id} />
}

function EditPlaylistDialog({ id }: { id: string }) {
  const playlist = useStore(lib, (s) => s.playlists.find((p) => p.id === id))!
  const [name, setName] = useState(playlist.name)
  const [description, setDescription] = useState(playlist.description ?? '')
  const [cover, setCover] = useState(playlist.cover)
  const [picking, setPicking] = useState(false)
  const close = () => editPlaylistStore.set({ id: null })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pick = async () => {
    setPicking(true)
    try {
      const url = await window.api.playlists.pickCover()
      if (url) setCover(url)
    } catch (err) {
      toast((err as Error).message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, ''))
    } finally {
      setPicking(false)
    }
  }

  const save = () => {
    if (!name.trim()) return
    updatePlaylistDetails(id, { name, description, cover })
    close()
  }

  // preview uses the unsaved cover choice
  const preview = { ...playlist, cover }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Edit details">
        <div className="modal-head">
          <h2>Edit details</h2>
          <button className="icon-btn" title="Close" onClick={close}>
            <XIcon size={18} />
          </button>
        </div>
        <div className="edit-grid">
          <div className="edit-cover">
            <button className="edit-cover-btn" onClick={pick} disabled={picking} title="Choose photo">
              {cover || playlist.tracks.some((t) => t.artwork) ? (
                <PlaylistArt playlist={preview} className="fill" />
              ) : (
                <div className="art fill edit-cover-empty">
                  <PlaylistIcon size={48} />
                </div>
              )}
              <span className="edit-cover-overlay">{picking ? 'Choosing…' : 'Choose photo'}</span>
            </button>
            {cover && (
              <button className="link-btn" onClick={() => setCover(undefined)}>
                Remove photo
              </button>
            )}
          </div>
          <div className="edit-fields">
            <label className="field">
              <span>Name</span>
              <input
                className="text-input plain"
                value={name}
                maxLength={NAME_MAX}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
              />
            </label>
            <label className="field grow">
              <span>Description</span>
              <textarea
                className="text-input plain textarea"
                value={description}
                maxLength={DESCRIPTION_MAX}
                placeholder="Add an optional description"
                onChange={(e) => setDescription(e.target.value)}
              />
              <small>
                {description.length}/{DESCRIPTION_MAX}
              </small>
            </label>
          </div>
        </div>
        <div className="modal-foot">
          <p className="hint">The picture is copied into ProjectM, so the original file can be moved or deleted.</p>
          <button className="btn primary" disabled={!name.trim()} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
