import { useEffect, useState } from 'react'
import type { UpdateInfo } from '../../../main/updater'
import { toast } from '../lib/ui'

/** The release notes' first points, without markdown marks or the install line. */
const summary = (notes: string) =>
  notes
    .split(/\r?\n/)
    .map((l) => l.replace(/\*\*|`/g, '').replace(/^[-*]\s+/, '').trim())
    .filter((l) => l && !/^(windows installer|install)/i.test(l))
    .slice(0, 5)

/** On start: if GitHub has a newer ProjectM, offer Update or Skip. Shows nothing otherwise. */
export function UpdateDialogHost() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<number | null>(null)

  useEffect(() => {
    // a moment after start so the first screen isn't slowed; offline just means no prompt
    const t = setTimeout(() => {
      window.api.update.check().then(setUpdate, () => {})
    }, 2500)
    const off = window.api.update.onProgress(setProgress)
    return () => {
      clearTimeout(t)
      off()
    }
  }, [])

  if (!update) return null
  const busy = progress !== null
  const skip = () => !busy && setUpdate(null)
  const install = () => {
    setProgress(0)
    window.api.update.install(update).catch((e) => {
      setProgress(null)
      toast(`Couldn't update: ${String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`)
    })
  }
  const pct = Math.round((progress ?? 0) * 100)
  return (
    <div className="modal-backdrop" onMouseDown={skip}>
      <div className="modal account-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog">
        <div className="modal-head">
          <h2>ProjectM {update.version} is out</h2>
        </div>
        <p className="account-intro">
          You have {update.current}. Updating takes about a minute: ProjectM closes and opens again by itself, and your
          music, playlists and settings stay.
        </p>
        <ul className="update-notes">
          {summary(update.notes).map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <button className="update-more" onClick={() => window.open(update.page)}>
          All changes on GitHub
        </button>
        {busy && (
          <div className="progress update-progress">
            <div style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="update-actions">
          <button className="btn ghost" disabled={busy} onClick={skip}>
            Skip
          </button>
          <button className="btn primary" disabled={busy} onClick={install}>
            {!busy ? 'Update' : pct < 100 ? `Downloading ${pct}%` : 'Installing…'}
          </button>
        </div>
      </div>
    </div>
  )
}
