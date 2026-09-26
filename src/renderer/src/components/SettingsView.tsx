import { useEffect, useState, type ReactNode } from 'react'
import type { Settings, SourceId } from '../../../shared/types'
import { ACCOUNT_SOURCES, disconnectAccount, useAccount } from '../lib/accounts'
import { cls, plural } from '../lib/format'
import { clearHistory, historyStore } from '../lib/history'
import { addFolder, hiddenClipCount, lib, rescan } from '../lib/library'
import { clearLoudnessMemory } from '../lib/loudness'
import { useNav } from '../lib/nav'
import { toggleNormalize, usePlayer } from '../lib/player'
import { updateSettings, useSettings } from '../lib/settings'
import { SOURCES } from '../lib/sources'
import { useStore } from '../lib/store'
import { toast } from '../lib/ui'
import { SourceBadge } from './Icons'
import { EqualizerPanel } from './Equalizer'
import { ThemesPanel } from './ThemesPanel'

/** Spotify-style settings: sections of rows, each with a label, a short explanation and a control. */
export function SettingsView({ tab = 'general' }: { tab?: 'general' | 'eq' | 'themes' }) {
  const nav = useNav()
  const s = useSettings()
  const set = (patch: Partial<Settings>) => updateSettings(patch)
  const normalize = usePlayer((p) => p.normalize)
  const folders = useStore(lib, (l) => l.folders)
  const trackCount = useStore(lib, (l) => l.tracks.length)
  const scanning = useStore(lib, (l) => !!l.scan)
  const history = useStore(historyStore, (h) => h.entries.length)
  const [info, setInfo] = useState<{ version: string; dataDir: string; electron: string } | null>(null)
  useEffect(() => {
    window.api.app.info().then(setInfo)
  }, [])

  return (
    <div className="settings">
      <h1>Settings</h1>
      <div className="chips tabs settings-tabs">
        <button className={cls('chip', tab === 'general' && 'on')} onClick={() => nav.go({ kind: 'settings', tab: 'general' })}>
          General
        </button>
        <button className={cls('chip', tab === 'eq' && 'on')} onClick={() => nav.go({ kind: 'settings', tab: 'eq' })}>
          Equalizer
        </button>
        <button className={cls('chip', tab === 'themes' && 'on')} onClick={() => nav.go({ kind: 'settings', tab: 'themes' })}>
          Themes
        </button>
      </div>
      {tab === 'eq' ? (
        <EqualizerPanel />
      ) : tab === 'themes' ? (
        <ThemesPanel />
      ) : (
      <>

      <Section title="Playback">
        <Row label="Volume leveling" hint="Play every song at the same loudness, whichever service it comes from.">
          <Switch on={normalize} onChange={toggleNormalize} />
        </Row>
        <Row
          label="Loudness level"
          hint="How loud leveled songs are. Normal matches YouTube and Spotify's default."
          disabled={!normalize}
        >
          <Select
            value={s.loudnessLevel}
            disabled={!normalize}
            onChange={(v) => set({ loudnessLevel: v as Settings['loudnessLevel'] })}
            options={[
              ['quiet', 'Quiet'],
              ['normal', 'Normal'],
              ['loud', 'Loud'],
            ]}
          />
        </Row>
        <Row
          label="Play Spotify songs through"
          hint="If the Spotify app isn't open, Spotify songs always play from YouTube Music or SoundCloud. ProjectM never opens Spotify by itself."
        >
          <Select
            value={s.spotifyPlayback}
            onChange={(v) => set({ spotifyPlayback: v as Settings['spotifyPlayback'] })}
            options={[
              ['app', 'Spotify app when open'],
              ['alternatives', 'Always YouTube Music / SoundCloud'],
            ]}
          />
        </Row>
        <Row
          label="Spotify level adjustment"
          hint="Spotify plays in its own app. If its songs sound louder or quieter than the rest, nudge them here. For matching levels, keep Spotify's own 'Normalize volume' on."
          disabled={s.spotifyPlayback === 'alternatives'}
        >
          <div className="range-row">
            <input
              type="range"
              min={-6}
              max={6}
              step={1}
              value={s.spotifyLevelDb}
              disabled={s.spotifyPlayback === 'alternatives'}
              onChange={(e) => set({ spotifyLevelDb: Number(e.target.value) })}
            />
            <span className="range-value">
              {s.spotifyLevelDb > 0 ? '+' : ''}
              {s.spotifyLevelDb} dB
            </span>
          </div>
        </Row>
      </Section>

      <Section title="Audio quality">
        <Row
          label="Streaming quality"
          hint="Always the best stream each service offers: YouTube Music in Opus (its highest free quality), SoundCloud in AAC 160 kbps when available, local files untouched (FLAC stays lossless). The Now Playing panel shows what's playing."
        >
          <span className="settings-value">Highest available</span>
        </Row>
        <Row
          label="Spotify quality"
          hint="Spotify songs play through the Spotify app, so its own setting decides. For the best sound: Spotify → Settings → Audio quality → Streaming quality → Lossless (Premium), or Very high."
        />
        <Row
          label="Sound processing"
          hint="With volume leveling off, audio isn't processed at all. With it on, songs that are turned down pass through untouched apart from the volume change; the peak limiter only engages on songs that are turned up."
        />
      </Section>

      <Section title="Display">
        <Row label="Start page" hint="What ProjectM shows when it opens.">
          <Select
            value={s.startPage}
            onChange={(v) => set({ startPage: v as Settings['startPage'] })}
            options={[
              ['home', 'Home'],
              ['songs', 'Songs'],
              ['search', 'Search'],
              ['last', 'Where I left off'],
            ]}
          />
        </Row>
        <Row label="Show lyrics" hint="Synced lyrics in the Now Playing panel, when available.">
          <Switch on={s.showLyrics} onChange={() => set({ showLyrics: !s.showLyrics })} />
        </Row>
      </Section>

      <Section title="Local files">
        <Row
          label="Music folders"
          hint={
            folders.length
              ? `${plural(folders.length, 'folder')} · ${plural(trackCount, 'song')}`
              : 'No folders yet. Add one to play music stored on this PC.'
          }
        >
          <div className="row">
            <button className="btn small" onClick={() => addFolder()}>
              Add folder
            </button>
            <FolderLink />
          </div>
        </Row>
        <Row
          label="Hide short clips"
          hint={`Hides audio under 30 seconds, like drum kit samples and sound effects. ${
            s.hideShortClips && hiddenClipCount() ? `${plural(hiddenClipCount(), 'clip')} hidden right now.` : ''
          }`}
        >
          <Switch on={s.hideShortClips} onChange={() => set({ hideShortClips: !s.hideShortClips })} />
        </Row>
        <Row label="Scan for new music on startup" hint="Picks up files you added or changed while ProjectM was closed.">
          <Switch on={s.rescanOnStartup} onChange={() => set({ rescanOnStartup: !s.rescanOnStartup })} />
        </Row>
        <Row label="Rescan now" hint="Look through your folders again right away.">
          <button className="btn small" disabled={scanning || !folders.length} onClick={() => rescan()}>
            {scanning ? 'Scanning…' : 'Rescan'}
          </button>
        </Row>
      </Section>

      <Section title="Accounts">
        {ACCOUNT_SOURCES.map((src) => (
          <AccountRow key={src} source={src} />
        ))}
      </Section>

      <Section title="System">
        <Row label="Open ProjectM when Windows starts" hint="Starts with Windows, like Spotify does. Off by default.">
          <Switch on={s.openAtLogin} onChange={() => set({ openAtLogin: !s.openAtLogin })} />
        </Row>
      </Section>

      <Section title="Privacy and storage">
        <Row label="Play history" hint={`${plural(history, 'song')} remembered. Used for "Jump back in" and "Most played" on Home.`}>
          <ConfirmButton
            label="Clear history"
            disabled={!history}
            onConfirm={() => {
              clearHistory()
              toast('Play history cleared')
            }}
          />
        </Row>
        <Row label="Remembered loudness levels" hint="ProjectM remembers how loud each song is so it starts at the right level. Reset if something sounds off.">
          <ConfirmButton
            label="Reset levels"
            onConfirm={() => {
              clearLoudnessMemory()
              toast('Loudness levels will be measured again')
            }}
          />
        </Row>
        <Row label="App data folder" hint={info?.dataDir ?? ''}>
          <button className="btn small" onClick={() => window.api.app.openDataFolder()}>
            Open folder
          </button>
        </Row>
      </Section>

      <Section title="About">
        <Row label="ProjectM" hint={info ? `Version ${info.version} · Electron ${info.electron}` : ''} />
        <Row label="Keyboard shortcuts" hint="">
          <div className="shortcuts">
            {[
              ['Space', 'Play / pause'],
              ['Ctrl + → / ←', 'Next / previous'],
              ['Ctrl + ↑ / ↓', 'Volume'],
              ['Ctrl + F', 'Search'],
              ['Alt + ←', 'Back'],
              ['F12', 'Developer tools'],
            ].map(([k, v]) => (
              <div key={k}>
                <kbd>{k}</kbd> <span>{v}</span>
              </div>
            ))}
          </div>
        </Row>
      </Section>
      </>
      )}
    </div>
  )
}

function FolderLink() {
  const nav = useNav()
  return (
    <button className="btn small ghost" onClick={() => nav.go({ kind: 'source', source: 'local' })}>
      Manage
    </button>
  )
}

function AccountRow({ source }: { source: SourceId }) {
  const nav = useNav()
  const status = useAccount(source)
  const name = SOURCES[source].name
  return (
    <Row
      label={
        <span className="row">
          <SourceBadge source={source} size={18} /> {name}
        </span>
      }
      hint={
        status?.connected
          ? `Connected${status.userName ? ` as ${status.userName}` : ''}`
          : source === 'soundcloud'
            ? 'Not connected. Search still works.'
            : source === 'youtube'
              ? 'Not signed in. Search and playback still work.'
              : 'Not connected'
      }
    >
      {status?.connected ? (
        <div className="row">
          <button className="btn small ghost" onClick={() => nav.go({ kind: 'source', source })}>
            Open
          </button>
          <ConfirmButton
            label="Disconnect"
            onConfirm={() => {
              disconnectAccount(source)
              toast(`${name} disconnected`)
            }}
          />
        </div>
      ) : (
        <button className="btn small primary" onClick={() => nav.go({ kind: 'source', source })}>
          Connect
        </button>
      )}
    </Row>
  )
}

// ---------- building blocks ----------

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      <div className="settings-rows">{children}</div>
    </section>
  )
}

function Row({
  label,
  hint,
  disabled,
  children,
}: {
  label: ReactNode
  hint?: string
  disabled?: boolean
  children?: ReactNode
}) {
  return (
    <div className={cls('settings-row', disabled && 'disabled')}>
      <div className="settings-text">
        <div className="settings-label">{label}</div>
        {hint && <div className="settings-hint">{hint}</div>}
      </div>
      {children && <div className="settings-control">{children}</div>}
    </div>
  )
}

function Switch({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button className={cls('switch', on && 'on')} role="switch" aria-checked={on} onClick={onChange}>
      <span />
    </button>
  )
}

function Select({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string
  options: [string, string][]
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <select className="select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  )
}

/** Destructive actions ask once more ("Sure?") before running. */
function ConfirmButton({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      className={cls('btn small ghost', armed && 'danger')}
      disabled={disabled}
      onClick={() => {
        if (!armed) return setArmed(true)
        setArmed(false)
        onConfirm()
      }}
    >
      {armed ? 'Sure?' : label}
    </button>
  )
}
