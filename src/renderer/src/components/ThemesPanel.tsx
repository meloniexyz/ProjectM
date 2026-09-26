import type { CSSProperties } from 'react'
import { cls } from '../lib/format'
import { updateSettings, useSettings } from '../lib/settings'
import { ACCENT_SWATCHES, THEMES, themeById, type Theme } from '../lib/themes'

/** Settings → Themes: pick a colour theme, optionally with your own accent colour. */
export function ThemesPanel() {
  const s = useSettings()
  const current = themeById(s.theme)
  const accent = s.accent ?? current.accent

  return (
    <div className="themes">
      <section className="settings-section">
        <h2>Theme</h2>
        <p className="settings-hint">Changes the backgrounds, text and accent colour of the whole app.</p>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <ThemeCard key={t.id} theme={t} selected={t.id === current.id} accent={s.accent} onPick={() => updateSettings({ theme: t.id })} />
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>Accent colour</h2>
        <p className="settings-hint">
          Used for buttons, highlights, sliders and the equalizer curve. Pick one to use with any theme.
        </p>
        <div className="accent-row">
          <button
            className={cls('accent-default', !s.accent && 'on')}
            onClick={() => updateSettings({ accent: null })}
            title="Use the theme's own accent"
          >
            <span className="swatch" style={{ background: current.accent }} />
            Theme default
          </button>
          {ACCENT_SWATCHES.map((c) => (
            <button
              key={c}
              className={cls('swatch big', s.accent?.toLowerCase() === c && 'on')}
              style={{ background: c }}
              title={c}
              onClick={() => updateSettings({ accent: c })}
            />
          ))}
          <label className="accent-custom" title="Any colour">
            <input type="color" value={accent} onChange={(e) => updateSettings({ accent: e.target.value })} />
            <span>Custom…</span>
          </label>
        </div>
      </section>
    </div>
  )
}

/** A miniature of the app painted in the theme's colours. */
function ThemeCard({ theme: t, selected, accent, onPick }: { theme: Theme; selected: boolean; accent: string | null; onPick: () => void }) {
  const a = selected && accent ? accent : t.accent
  const style = { '--p-bg': t.bg, '--p-1': t.bg1, '--p-3': t.bg3, '--p-text': t.text, '--p-dim': t.text3, '--p-accent': a } as CSSProperties
  return (
    <button className={cls('theme-card', selected && 'on')} onClick={onPick} aria-pressed={selected}>
      <div className="theme-preview" style={style}>
        <div className="tp-side">
          <i />
          <i />
          <i className="short" />
        </div>
        <div className="tp-main">
          <div className="tp-hero" />
          <div className="tp-row">
            <span className="tp-play" />
            <i />
          </div>
          <div className="tp-line" />
          <div className="tp-line short" />
        </div>
        <div className="tp-bar">
          <span className="tp-dot" />
          <span className="tp-seek">
            <span />
          </span>
        </div>
      </div>
      <div className="theme-name">
        <span className="swatch" style={{ background: t.accent }} />
        {t.name}
        {selected && <span className="theme-check">✓</span>}
      </div>
    </button>
  )
}
