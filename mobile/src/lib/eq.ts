import type { NativeFilter } from '../../modules/projectm-audio'
import { BAND_LAYOUTS } from '../../../src/renderer/src/lib/eq'
import type { EqSettings } from '../../../src/shared/types'

/**
 * Same equalizer as the desktop app: the 3/5/7 dots define a smooth curve (monotone cubic in
 * log-frequency), and a bank of ~24 filters is solved to follow it, so neighbouring dots join
 * smoothly instead of making separate bumps. Here the filter responses are computed directly
 * (Web Audio formulas), and the native engine runs the same filters.
 */

const SAMPLE_RATE = 44100

type FilterType = NativeFilter['type']
const BANK: { type: FilterType; freq: number; q: number; solveAt: number }[] = [
  { type: 'lowshelf', freq: 32, q: 0.7, solveAt: 25 },
  ...[28, ...Array.from({ length: 17 }, (_, k) => 40 * Math.pow(2, k / 2)), 12177, 14482, 17222, 20480].map((freq) => ({
    type: 'peaking' as FilterType,
    freq,
    q: 1.4,
    solveAt: freq,
  })),
  { type: 'highshelf', freq: 18000, q: 0.7, solveAt: 19500 },
]

type Dot = { freq: number; gain: number }

/** Smooth curve through the dots: monotone cubic (Fritsch-Carlson) in log-frequency, flat outside. */
export function curveThrough(dots: Dot[], freq: number) {
  const n = dots.length
  if (!n) return 0
  const xs = dots.map((d) => Math.log(d.freq))
  const ys = dots.map((d) => d.gain)
  const x = Math.log(freq)
  if (x <= xs[0]) return ys[0]
  if (x >= xs[n - 1]) return ys[n - 1]
  const h = xs.slice(1).map((v, i) => v - xs[i])
  const delta = h.map((hi, i) => (ys[i + 1] - ys[i]) / hi)
  const m = ys.map((_, i) => (i === 0 ? delta[0] : i === n - 1 ? delta[n - 2] : (delta[i - 1] + delta[i]) / 2))
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
    } else {
      const a = m[i] / delta[i]
      const b = m[i + 1] / delta[i]
      const s = a * a + b * b
      if (s > 9) {
        const t = 3 / Math.sqrt(s)
        m[i] = t * a * delta[i]
        m[i + 1] = t * b * delta[i]
      }
    }
  }
  let i = 0
  while (x > xs[i + 1]) i++
  const t = (x - xs[i]) / h[i]
  const t2 = t * t
  const t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1]
}

/** Biquad coefficients exactly as Web Audio computes them (shelves: slope 1, Q unused). */
function coefficients(type: FilterType, freq: number, q: number, gainDb: number) {
  const A = Math.pow(10, gainDb / 40)
  const w0 = (2 * Math.PI * Math.min(freq, SAMPLE_RATE * 0.4995)) / SAMPLE_RATE
  const cw = Math.cos(w0)
  const sw = Math.sin(w0)
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
  if (type === 'peaking') {
    const alpha = sw / (2 * q)
    b0 = 1 + alpha * A
    b1 = -2 * cw
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * cw
    a2 = 1 - alpha / A
  } else {
    const alpha = (sw / 2) * Math.SQRT2
    const k = 2 * Math.sqrt(A) * alpha
    if (type === 'lowshelf') {
      b0 = A * (A + 1 - (A - 1) * cw + k)
      b1 = 2 * A * (A - 1 - (A + 1) * cw)
      b2 = A * (A + 1 - (A - 1) * cw - k)
      a0 = A + 1 + (A - 1) * cw + k
      a1 = -2 * (A - 1 + (A + 1) * cw)
      a2 = A + 1 + (A - 1) * cw - k
    } else {
      b0 = A * (A + 1 + (A - 1) * cw + k)
      b1 = -2 * A * (A - 1 + (A + 1) * cw)
      b2 = A * (A + 1 + (A - 1) * cw - k)
      a0 = A + 1 - (A - 1) * cw + k
      a1 = 2 * (A - 1 - (A + 1) * cw)
      a2 = A + 1 - (A - 1) * cw - k
    }
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0] as const
}

/** Magnitude response (dB) of one filter at a frequency. */
function responseDb(type: FilterType, freq: number, q: number, gainDb: number, at: number) {
  if (!gainDb) return 0
  const [b0, b1, b2, a1, a2] = coefficients(type, freq, q, gainDb)
  const w = (2 * Math.PI * at) / SAMPLE_RATE
  const c1 = Math.cos(w)
  const s1 = Math.sin(w)
  const c2 = Math.cos(2 * w)
  const s2 = Math.sin(2 * w)
  const nr = b0 + b1 * c1 + b2 * c2
  const ni = -(b1 * s1 + b2 * s2)
  const dr = 1 + a1 * c1 + a2 * c2
  const di = -(a1 * s1 + a2 * s2)
  const mag2 = (nr * nr + ni * ni) / (dr * dr + di * di)
  return 10 * Math.log10(mag2 || 1e-12)
}

function bankResponse(freqs: number[], gains: number[]) {
  return freqs.map((f) => BANK.reduce((sum, b, i) => sum + responseDb(b.type, b.freq, b.q, gains[i], f), 0))
}

function solveLinear(M: number[][], v: number[]) {
  const n = v.length
  const A = M.map((row, i) => [...row, v[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    ;[A[c], A[p]] = [A[p], A[c]]
    const d = A[c][c] || 1e-12
    for (let r = c + 1; r < n; r++) {
      const k = A[r][c] / d
      for (let j = c; j <= n; j++) A[r][j] -= k * A[c][j]
    }
  }
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let sum = A[r][n]
    for (let j = r + 1; j < n; j++) sum -= A[r][j] * x[j]
    x[r] = sum / (A[r][r] || 1e-12)
  }
  return x
}

const FIT_FREQS = Array.from({ length: 200 }, (_, i) => 20 * Math.pow(1000, i / 199))
const basisAt = (freqs: number[]) => BANK.map((b) => freqs.map((f) => responseDb(b.type, b.freq, b.q, 6, f) / 6))
let fitBasis: number[][] | null = null
let solved: { key: string; gains: number[] } | null = null

/** Filter gains whose combined response follows the curve through the dots (weighted least squares). */
export function solveBank(dots: Dot[]) {
  const key = dots.map((d) => `${d.freq}:${d.gain}`).join(',')
  if (solved?.key === key) return solved.gains
  const n = BANK.length
  if (dots.every((d) => d.gain === 0)) {
    solved = { key, gains: new Array(n).fill(0) }
    return solved.gains
  }
  fitBasis ??= basisAt(FIT_FREQS)
  const dotFreqs = dots.map((d) => d.freq)
  const dotBasis = basisAt(dotFreqs)
  const freqs = [...FIT_FREQS, ...dotFreqs]
  const basis = fitBasis.map((col, i) => [...col, ...dotBasis[i]])
  const weights = [...new Array(FIT_FREQS.length).fill(1), ...new Array(dots.length).fill(40)]
  const target = freqs.map((f) => curveThrough(dots, f))
  const lambda = 0.005
  const M = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      let sum = i === j ? lambda : 0
      for (let k = 0; k < freqs.length; k++) sum += weights[k] * basis[i][k] * basis[j][k]
      return sum
    }),
  )
  const project = (err: number[]) =>
    Array.from({ length: n }, (_, i) => {
      let sum = 0
      for (let k = 0; k < freqs.length; k++) sum += weights[k] * basis[i][k] * err[k]
      return sum
    })
  let gains = solveLinear(M, project(target))
  for (let pass = 0; pass < 10; pass++) {
    const r = bankResponse(freqs, gains)
    const err = target.map((t, k) => t - r[k])
    if (Math.max(...err.map(Math.abs)) < 0.03) break
    const delta = solveLinear(M, project(err))
    gains = gains.map((g, i) => Math.max(-30, Math.min(30, g + delta[i])))
  }
  solved = { key, gains }
  return gains
}

const RESPONSE_FREQS = Array.from({ length: 160 }, (_, i) => 20 * Math.pow(1000, i / 159))

/** The EQ as filters for the native engine, plus how far it can raise any frequency (for the limiter). */
export function eqFilters(eq: EqSettings): { filters: NativeFilter[]; peakRiseDb: number } {
  if (!eq.enabled) return { filters: [], peakRiseDb: 0 }
  const layout = BAND_LAYOUTS[eq.bands]
  const dots = layout.map((b, i) => ({ freq: b.freq, gain: eq.gains[i] ?? 0 }))
  const gains = solveBank(dots)
  const filters = BANK.map((b, i) => ({ type: b.type, freq: b.freq, q: b.q, gain: gains[i] })).filter((f) => Math.abs(f.gain) > 0.01)
  const rise = Math.max(...bankResponse(RESPONSE_FREQS, gains))
  return { filters, peakRiseDb: rise }
}

/** What you hear (dB) at each frequency for the given dots: for drawing the curve. */
export function eqCurve(eq: EqSettings, freqs: number[]) {
  const layout = BAND_LAYOUTS[eq.bands]
  const gains = solveBank(layout.map((b, i) => ({ freq: b.freq, gain: eq.gains[i] ?? 0 })))
  return bankResponse(freqs, gains)
}
