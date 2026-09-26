import type { EqBands } from '../../../shared/types'

/** Band layout per mode: center frequency, filter type and width. */
export interface Band {
  freq: number
  type: BiquadFilterType
  q: number
}

export const BAND_LAYOUTS: Record<EqBands, Band[]> = {
  3: [
    { freq: 100, type: 'lowshelf', q: 0.7 },
    { freq: 1000, type: 'peaking', q: 0.6 },
    { freq: 10000, type: 'highshelf', q: 0.7 },
  ],
  5: [
    { freq: 60, type: 'lowshelf', q: 0.7 },
    { freq: 230, type: 'peaking', q: 0.75 },
    { freq: 910, type: 'peaking', q: 0.75 },
    { freq: 3600, type: 'peaking', q: 0.75 },
    { freq: 14000, type: 'highshelf', q: 0.7 },
  ],
  7: [
    { freq: 60, type: 'lowshelf', q: 0.7 },
    { freq: 150, type: 'peaking', q: 0.9 },
    { freq: 400, type: 'peaking', q: 0.9 },
    { freq: 1000, type: 'peaking', q: 0.9 },
    { freq: 2400, type: 'peaking', q: 0.9 },
    { freq: 6000, type: 'peaking', q: 0.9 },
    { freq: 15000, type: 'highshelf', q: 0.7 },
  ],
}

export const EQ_MAX_DB = 12

/** Presets are defined at the 7-band frequencies and adapted to 3 and 5 bands. */
const REFERENCE_FREQS = BAND_LAYOUTS[7].map((b) => b.freq)

export const PRESETS: { name: string; curve: number[] }[] = [
  { name: 'Flat', curve: [0, 0, 0, 0, 0, 0, 0] },
  { name: 'Acoustic', curve: [4.5, 4, 1.5, 1, 2.5, 3, 3] },
  { name: 'Bass Booster', curve: [6, 4.5, 2, 0, 0, 0, 0] },
  { name: 'Bass Reducer', curve: [-6, -4.5, -2, 0, 0, 0, 0] },
  { name: 'Classical', curve: [4, 3, 1.5, -0.5, 0, 2.5, 3.5] },
  { name: 'Dance', curve: [5, 6, 3, 0, 2, 4, 3.5] },
  { name: 'Deep', curve: [4.5, 3, 1.5, 0.5, 2.5, 1.5, -4] },
  { name: 'Electronic', curve: [4.5, 3.5, 0.5, -1, 1.5, 3, 4.5] },
  { name: 'Hip-Hop', curve: [5, 4, 1, 3, -1, 1, 3] },
  { name: 'Jazz', curve: [4, 3, 1, 2, -1.5, 1.5, 3.5] },
  { name: 'Latin', curve: [4.5, 3, 0, 0, -1.5, 1.5, 4.5] },
  { name: 'Loudness', curve: [5.5, 4, 0, -0.5, -2, 1, 5] },
  { name: 'Lounge', curve: [-3, -1.5, 0, 1, 3.5, 1, 0] },
  { name: 'Piano', curve: [3, 2, 0, 2.5, 3, 1.5, 3.5] },
  { name: 'Pop', curve: [-1.5, -1, 0, 2, 4, 4, 2] },
  { name: 'R&B', curve: [2.5, 6.5, 5.5, 1.5, -2, 1.5, 2.5] },
  { name: 'Rock', curve: [5, 4, 3, 1, -0.5, 2.5, 4] },
  { name: 'Small Speakers', curve: [5.5, 4.5, 3.5, 2, 0.5, -1, -2] },
  { name: 'Spoken Word', curve: [-3, -1, 0.5, 2.5, 3.5, 3, 1] },
  { name: 'Treble Booster', curve: [0, 0, 0, 0, 2, 4, 6] },
  { name: 'Treble Reducer', curve: [0, 0, 0, 0, -2, -4, -6] },
  { name: 'Vocal Booster', curve: [-1.5, -3, -3, 1.5, 3.5, 3.5, 2.5] },
]

/** Value of a curve (points at `freqs`) at frequency f, interpolated on a log scale. */
function curveAt(freqs: number[], gains: number[], f: number) {
  if (f <= freqs[0]) return gains[0]
  if (f >= freqs[freqs.length - 1]) return gains[gains.length - 1]
  for (let i = 0; i < freqs.length - 1; i++) {
    if (f <= freqs[i + 1]) {
      const t = (Math.log(f) - Math.log(freqs[i])) / (Math.log(freqs[i + 1]) - Math.log(freqs[i]))
      return gains[i] + t * (gains[i + 1] - gains[i])
    }
  }
  return 0
}

const round = (v: number) => Math.round(v * 2) / 2 // half-dB steps

/** A 7-point preset curve as gains for the given band count. */
export function curveToBands(curve: number[], bands: EqBands) {
  return BAND_LAYOUTS[bands].map((b) => round(curveAt(REFERENCE_FREQS, curve, b.freq)))
}

/** Current gains (in any mode) as a 7-point curve, for saving presets and switching modes. */
export function bandsToCurve(gains: number[], bands: EqBands) {
  const freqs = BAND_LAYOUTS[bands].map((b) => b.freq)
  return REFERENCE_FREQS.map((f) => round(curveAt(freqs, gains, f)))
}

/** Converts gains from one mode to another so the sound stays as close as possible. */
export function convertGains(gains: number[], from: EqBands, to: EqBands) {
  if (from === to) return gains
  const freqs = BAND_LAYOUTS[from].map((b) => b.freq)
  return BAND_LAYOUTS[to].map((b) => round(curveAt(freqs, gains, b.freq)))
}

export const formatFreq = (f: number) => (f >= 1000 ? `${f % 1000 === 0 ? f / 1000 : (f / 1000).toFixed(1)} kHz` : `${f} Hz`)
