import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { EqBands, EqSettings } from '../../../shared/types'
import { BAND_LAYOUTS, bandsToCurve, convertGains, curveToBands, EQ_MAX_DB, formatFreq, PRESETS } from '../lib/eq'
import { cls } from '../lib/format'
import { eqResponse } from '../lib/loudness'
import { getSettings, updateSettings, useSettings } from '../lib/settings'
import { toast } from '../lib/ui'

// graph geometry (SVG units)
const W = 800
const H = 260
const PAD_X = 24
const PAD_Y = 18
const F_MIN = 20
const F_MAX = 20000
const x = (f: number) => PAD_X + ((Math.log(f) - Math.log(F_MIN)) / (Math.log(F_MAX) - Math.log(F_MIN))) * (W - 2 * PAD_X)
const y = (db: number) => PAD_Y + ((EQ_MAX_DB - db) / (2 * EQ_MAX_DB)) * (H - 2 * PAD_Y)
const CURVE_FREQS = new Float32Array(Array.from({ length: 200 }, (_, i) => F_MIN * Math.pow(F_MAX / F_MIN, i / 199)))

const eqNow = () => getSettings().eq
const setEq = (patch: Partial<EqSettings>) => updateSettings({ eq: { ...eqNow(), ...patch } })
const clampDb = (v: number) => Math.max(-EQ_MAX_DB, Math.min(EQ_MAX_DB, Math.round(v * 2) / 2))

/** Spotify-style equalizer: presets, 3/5/7-band modes and a draggable response curve. */
export function EqualizerPanel() {
  const eq = useSettings().eq
  const layout = BAND_LAYOUTS[eq.bands]
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const custom = eq.custom.find((p) => p.name === eq.preset)

  const setGain = (i: number, db: number) => {
    const gains = eqNow().gains.slice()
    gains[i] = clampDb(db)
    setEq({ gains, preset: 'Custom', enabled: true })
  }

  const pickPreset = (presetName: string) => {
    const p = [...PRESETS, ...eqNow().custom].find((x) => x.name === presetName)
    if (!p) return
    setEq({ gains: curveToBands(p.curve, eqNow().bands), preset: p.name, enabled: true })
  }

  const setBands = (bands: EqBands) => {
    const cur = eqNow()
    if (bands === cur.bands) return
    const preset = [...PRESETS, ...cur.custom].find((p) => p.name === cur.preset)
    // a named preset is re-derived exactly; custom tweaks are converted to keep the sound
    setEq({ bands, gains: preset ? curveToBands(preset.curve, bands) : convertGains(cur.gains, cur.bands, bands) })
  }

  const savePreset = () => {
    const n = name.trim()
    if (!n) return
    if (PRESETS.some((p) => p.name.toLowerCase() === n.toLowerCase())) return toast('That name is taken by a built-in preset')
    const cur = eqNow()
    const curve = bandsToCurve(cur.gains, cur.bands)
    setEq({ custom: [...cur.custom.filter((p) => p.name !== n), { name: n, curve }], preset: n })
    setNaming(false)
    setName('')
    toast(`Saved preset "${n}"`)
  }

  const deletePreset = () => {
    if (!custom) return
    setEq({ custom: eqNow().custom.filter((p) => p !== custom), preset: 'Custom' })
    toast(`Deleted preset "${custom.name}"`)
  }

  return (
    <div className="eq">
      <div className="settings-row">
        <div className="settings-text">
          <div className="settings-label">Equalizer</div>
          <div className="settings-hint">
            Shapes the sound of local files, YouTube Music and SoundCloud. Spotify songs play in the Spotify app, so use
            its own equalizer (Spotify → Settings → Playback → Equalizer).
          </div>
        </div>
        <div className="settings-control">
          <button
            className={cls('switch', eq.enabled && 'on')}
            role="switch"
            aria-checked={eq.enabled}
            onClick={() => setEq({ enabled: !eq.enabled })}
          >
            <span />
          </button>
        </div>
      </div>

      <div className={cls('eq-controls', !eq.enabled && 'off')}>
        <div className="segmented" role="radiogroup" aria-label="Bands">
          {([3, 5, 7] as EqBands[]).map((b) => (
            <button key={b} className={cls(eq.bands === b && 'on')} role="radio" aria-checked={eq.bands === b} onClick={() => setBands(b)}>
              {b} bands
            </button>
          ))}
        </div>

        <select className="select" value={eq.preset} onChange={(e) => pickPreset(e.target.value)}>
          {eq.preset === 'Custom' && <option value="Custom">Custom</option>}
          <optgroup label="Presets">
            {PRESETS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </optgroup>
          {eq.custom.length > 0 && (
            <optgroup label="My presets">
              {eq.custom.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        <div className="grow" />
        {naming ? (
          <div className="row">
            <input
              className="text-input plain eq-name"
              autoFocus
              maxLength={30}
              value={name}
              placeholder="Preset name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') savePreset()
                if (e.key === 'Escape') setNaming(false)
              }}
            />
            <button className="btn small primary" disabled={!name.trim()} onClick={savePreset}>
              Save
            </button>
            <button className="btn small ghost" onClick={() => setNaming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <button className="btn small" onClick={() => setNaming(true)}>
              Save as preset
            </button>
            {custom && (
              <button className="btn small ghost" onClick={deletePreset}>
                Delete preset
              </button>
            )}
            <button className="btn small ghost" onClick={() => pickPreset('Flat')}>
              Reset
            </button>
          </>
        )}
      </div>

      <EqGraph gains={eq.gains} bands={eq.bands} enabled={eq.enabled} onChange={setGain} />

      <div className="eq-labels">
        {layout.map((b, i) => (
          <div key={b.freq} className="eq-label" style={{ left: `${(x(b.freq) / W) * 100}%` }}>
            <b>{formatFreq(b.freq)}</b>
            <span>
              {eq.gains[i] > 0 ? '+' : ''}
              {(eq.gains[i] ?? 0).toFixed(1)} dB
            </span>
          </div>
        ))}
      </div>
      <p className="hint eq-tip">
        Drag the dots up or down. Double-click a dot to reset it; with a dot selected, use the arrow keys for fine steps.
        When bands are boosted, ProjectM lowers the overall level just enough to avoid distortion.
      </p>
    </div>
  )
}

function EqGraph(props: { gains: number[]; bands: EqBands; enabled: boolean; onChange: (i: number, db: number) => void }) {
  const { gains, bands, enabled, onChange } = props
  const layout = BAND_LAYOUTS[bands]
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)

  // the real combined response of the filters, so the drawn curve is what you hear
  const path = useMemo(() => {
    const r = eqResponse(CURVE_FREQS, gains)
    return Array.from(CURVE_FREQS, (f, i) => `${i ? 'L' : 'M'}${x(f).toFixed(1)},${y(Math.max(-EQ_MAX_DB, Math.min(EQ_MAX_DB, r[i]))).toFixed(1)}`).join(' ')
  }, [gains, bands])

  const dbAt = (e: PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    const svgY = ((e.clientY - r.top) / r.height) * H
    return EQ_MAX_DB - ((svgY - PAD_Y) / (H - 2 * PAD_Y)) * 2 * EQ_MAX_DB
  }

  const onKey = (i: number) => (e: KeyboardEvent) => {
    const step = e.key === 'PageUp' || e.key === 'PageDown' ? 3 : 0.5
    const now = eqNow().gains[i] ?? 0 // fresh value: several key presses can land before a re-render
    if (e.key === 'ArrowUp' || e.key === 'PageUp') onChange(i, now + step)
    else if (e.key === 'ArrowDown' || e.key === 'PageDown') onChange(i, now - step)
    else if (e.key === '0' || e.key === 'Delete') onChange(i, 0)
    else return
    e.preventDefault()
  }

  return (
    <svg
      ref={svgRef}
      className={cls('eq-graph', !enabled && 'off', dragging !== null && 'dragging')}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onPointerMove={(e) => dragging !== null && onChange(dragging, dbAt(e))}
      onPointerUp={() => setDragging(null)}
      onPointerCancel={() => setDragging(null)}
    >
      {/* grid: 0 dB, ±6, ±12 and the octave marks */}
      {[-12, -6, 0, 6, 12].map((db) => (
        <g key={db}>
          <line className={cls('eq-grid', db === 0 && 'zero')} x1={PAD_X} x2={W - PAD_X} y1={y(db)} y2={y(db)} />
          <text className="eq-axis" x={4} y={y(db) + 4}>
            {db > 0 ? `+${db}` : db}
          </text>
        </g>
      ))}
      {layout.map((b) => (
        <line key={b.freq} className="eq-grid band" x1={x(b.freq)} x2={x(b.freq)} y1={PAD_Y} y2={H - PAD_Y} />
      ))}
      <path className="eq-fill" d={`${path} L${x(F_MAX)},${y(0)} L${x(F_MIN)},${y(0)} Z`} />
      <path className="eq-curve" d={path} />
      {layout.map((b, i) => (
        <circle
          key={b.freq}
          className="eq-handle"
          cx={x(b.freq)}
          cy={y(gains[i] ?? 0)}
          r={9}
          tabIndex={0}
          role="slider"
          aria-label={`${b.freq} Hz`}
          aria-valuenow={gains[i]}
          aria-valuemin={-EQ_MAX_DB}
          aria-valuemax={EQ_MAX_DB}
          onPointerDown={(e) => {
            e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId)
            setDragging(i)
          }}
          onDoubleClick={() => onChange(i, 0)}
          onKeyDown={onKey(i)}
        />
      ))}
    </svg>
  )
}
